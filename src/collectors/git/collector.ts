/**
 * Local git collector — explicit repos + discovery roots.
 *
 * Uses bounded Bun.spawn (`git`) with timeouts and no shell interpolation.
 * Handles invalid repos, permission failures, remote identity normalisation,
 * worktrees, recent commits/authors, and bounded command runtime. Critically
 * (contract #342): a local-git-discovered repository has UNKNOWN privacy
 * (`isPrivate: null`) — it cannot query GitHub, so the orchestrator resolves
 * null → private (fail-closed) at the persistence boundary.
 */

import { readdirSync, statSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { runCommand } from "../process";
import type { Collector, CollectorResult, LocalGitRecord, SourceData } from "../../shared/types";
import { emptySourceData } from "../../shared/types";
import { utcDaysAgo } from "../../shared/dates";
import type { RuntimeConfig } from "../../config/types";

interface GitRepoMeta {
  path: string;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  defaultBranch: string | null;
  repoName: string;
}

export class GitCollector implements Collector<SourceData> {
  readonly id = "git" as const;
  readonly tier = "core" as const;
  readonly title = "Local Git";

  constructor(private readonly config: { repos: string[]; roots: string[]; globs: string[]; maxDepth: number; excludes: string[]; lookbackDays: number }) {}

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    const warnings: string[] = [];
    const errors: CollectorResult["errors"] = [];

    if (this.config.repos.length === 0 && this.config.roots.length === 0) {
      return {
        source: "git",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: ["no explicit git repos or discovery roots configured — source unavailable"],
        errors: [],
        unavailable: true,
      };
    }

    const candidates = this.discoverRepos();

    const data = emptySourceData();
    const since = utcDaysAgo(this.config.lookbackDays);

    for (const candidate of candidates) {
      if (signal.aborted) {
        return {
          source: "git",
          ok: false,
          data: null,
          durationMs: Date.now() - start,
          warnings,
          errors: [...errors, { message: "cancelled", code: "cancelled", retryable: false }],
          unavailable: false,
        };
      }
      const metaResult = await this.inspectRepo(candidate);
      if (metaResult.record) {
        data.localGit.push(metaResult.record);
        if (metaResult.record.error) errors.push({ message: metaResult.record.error, code: "git_command", retryable: true });
      } else if (metaResult.unknown) {
        errors.push({ message: metaResult.unknown, code: "git_unavailable", retryable: false });
      }
    }

    // Compute per-day commit counts from bounded git log output.
    const commitsByDay = await this.commitsByDay(candidates, since, signal, errors);

    return {
      source: "git",
      ok: errors.length === 0,
      data: {
        repositories: data.repositories,
        issues: [],
        pullRequests: [],
        workflowRuns: [],
        sessions: [],
        localGit: data.localGit,
        usage: null,
        commitsByDay,
      },
      durationMs: Date.now() - start,
      warnings,
      errors,
      unavailable: false,
    };
  }

  /** Resolve explicit repos + discovery-root walk into an ordered unique list. */
  private discoverRepos(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (p: string) => {
      const abs = resolve(p);
      if (!seen.has(abs)) {
        seen.add(abs);
        out.push(abs);
      }
    };

    for (const r of this.config.repos) push(r);
    for (const root of this.config.roots) {
      const found = this.walkRoot(root);
      for (const f of found) push(f);
    }
    return out;
  }

  /** Walk a discovery root up to maxDepth, skipping excluded dirs. */
  private walkRoot(root: string): string[] {
    const found: string[] = [];
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    const maxDepth = this.config.maxDepth;

    while (stack.length > 0) {
      const { dir, depth } = stack.pop()!;
      if (maxDepth > 0 && depth >= maxDepth) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable/permission-denied root — skip, not fatal
      }
      for (const entry of entries) {
        if (this.config.excludes.includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (this.isGitRepo(full)) {
            if (this.matchesGlob(entry.name)) found.push(full);
            // don't recurse INTO a discovered repo (worktrees handled via remotes)
          } else {
            stack.push({ dir: full, depth: depth + 1 });
          }
        }
      }
    }
    return found;
  }

  private isGitRepo(path: string): boolean {
    try {
      return statSync(join(path, ".git")).isDirectory() || statSync(join(path, ".git")).isFile();
    } catch {
      return false;
    }
  }

  private matchesGlob(name: string): boolean {
    // Simple glob: `*` matches any run of chars; support `,`-separated list.
    return this.config.globs.some((g) => {
      if (g === "*") return true;
      const re = new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
      return re.test(name);
    });
  }

  private async inspectRepo(path: string): Promise<{ record: LocalGitRecord | null; unknown: string | null }> {
    const result = await runCommand({ args: ["git", "-C", path, "rev-parse", "--is-inside-work-tree"], timeoutMs: 10_000, cwd: path });

    if (result.timedOut) return { record: null, unknown: `git timed out inside ${path}` };
    if (!result.ok) {
      // Not a repo, or permission failure — record as an error record.
      return {
        record: {
          repoKey: `local:${path}`,
          path,
          repoName: basename(path),
          remoteUrl: null,
          githubOwner: null,
          githubRepo: null,
          defaultBranch: null,
          isGitRepo: false,
          recentCommits: 0,
          authors: [],
          latestCommitAt: null,
          error: sanitize(result.stderr.trim()) || "not a git repository or unreadable",
          present: false,
          lastSeenAt: null,
        },
        unknown: null,
      };
    }

    const remoteRes = await gitOut(path, "remote", "get-url", "origin");
    const remoteUrl = remoteRes.ok ? remoteRes.stdout.trim() : null;
    const branchRefRes = await gitOut(path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
    const headRes = await gitOut(path, "rev-parse", "--abbrev-ref", "HEAD");
    const defaultBranch = branchRefRes.ok
      ? branchRefRes.stdout.trim().replace(/^origin\//, "")
      : headRes.stdout.trim();

    const { owner, repo } = parseRemote(remoteUrl);
    const repoName = repo ?? basename(path);
    const safeRemote = sanitizeRemoteUrl(remoteUrl);

    return {
      record: {
        repoKey: safeRemote && owner && repo ? `github:${owner}/${repo}` : `local:${path}`,
        path,
        repoName,
        remoteUrl: safeRemote,
        githubOwner: owner,
        githubRepo: repo,
        defaultBranch: defaultBranch || null,
        isGitRepo: true,
        recentCommits: await this.commitCount(path, this.config.lookbackDays),
        authors: await this.authors(path, this.config.lookbackDays),
        latestCommitAt: await this.latestCommitAt(path),
        error: null,
        present: true,
        lastSeenAt: new Date().toISOString(),
      },
      unknown: null,
    };
  }

  private async commitCount(path: string, days: number): Promise<number> {
    const since = utcDaysAgo(days);
    const res = await runCommand({ args: ["git", "-C", path, "rev-list", "--count", `--since=${since}`, "HEAD"], timeoutMs: 15_000, cwd: path });
    const n = Number.parseInt(res.stdout.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private async authors(path: string, days: number): Promise<string[]> {
    const since = utcDaysAgo(days);
    const res = await runCommand({ args: ["git", "-C", path, "shortlog", "-sne", `--since=${since}`, "HEAD"], timeoutMs: 15_000, cwd: path });
    if (!res.ok) return [];
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\s*\d+\s+/, "").replace(/<.*>$/, "").trim());
  }

  private async latestCommitAt(path: string): Promise<string | null> {
    const res = await runCommand({ args: ["git", "-C", path, "log", "-1", "--format=%cI"], timeoutMs: 10_000, cwd: path });
    if (!res.ok || !res.stdout.trim()) return null;
    return res.stdout.trim();
  }

  /** Per-day commit counts (UTC) across the lookback window, bounded. */
  private async commitsByDay(
    paths: string[],
    since: string,
    signal: AbortSignal,
    errors: CollectorResult["errors"],
  ): Promise<Record<string, number>> {
    const days: Record<string, number> = {};
    for (const path of paths) {
      if (signal.aborted) break;
      if (!this.isGitRepo(path)) continue;
      // --since / --until filter by commit date; %ad %s gives short ISO dates.
      const res = await runCommand({
        args: [
          "git", "-C", path, "log", `--since=${since}`, "--until=now", "--format=%ad", "--date=short", "--all",
        ],
        timeoutMs: 20_000,
        cwd: path,
      });
      if (!res.ok) continue;
      for (const line of res.stdout.split("\n")) {
        const day = line.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        days[day] = (days[day] ?? 0) + 1;
      }
    }
    return days;
  }
}

async function gitOut(path: string, ...args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await runCommand({ args: ["git", "-C", path, ...args], timeoutMs: 10_000, cwd: path });
  return { ok: res.ok, stdout: res.stdout, stderr: res.stderr };
}

function sanitize(s: string): string {
  // Remove any leading "fatal:"/"error:" prefixes for cleaner, tamer logs, and
  // cap length so a hostile path can't spam journald.
  return s.replace(/^(fatal:|error:|warning:)\s*/i, "").slice(0, 300);
}

/** Normalise a remote URL into {owner, repo}, or nulls when not github-shaped. */
export function parseRemote(url: string | null): { owner: string | null; repo: string | null } {
  if (!url) return { owner: null, repo: null };
  const trimmed = url.trim();
  // git@github.com:owner/repo.git
  let m = trimmed.match(/^(?:git@|ssh:\/\/git@)github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: stripGitSuffix(m[2]) };
  // https://github.com/owner/repo.git — with optional credentials (token)
  // in the userinfo slot: https://x-access-token:TOKEN@github.com/owner/repo.git
  m = trimmed.match(/^https?:\/\/(?:[^/@\s]+@)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/);
  if (m) return { owner: m[1], repo: stripGitSuffix(m[2]) };
  return { owner: null, repo: null };
}

/**
 * Strip credentials from a remote URL before it is persisted anywhere.
 * Token-bearing remotes (https://x-access-token:TOKEN@github.com/...) must
 * never be stored verbatim — that is a credential leak in the database.
 */
export function sanitizeRemoteUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    // Not a URL (ssh scp-style etc.) — nothing to strip.
    return url;
  }
}

function stripGitSuffix(s: string): string {
  return s.replace(/\.git$/, "");
}

export function createGitCollector(runtime: RuntimeConfig): GitCollector {
  return new GitCollector({
    repos: runtime.git.repos,
    roots: runtime.git.roots,
    globs: runtime.git.globs,
    maxDepth: runtime.git.maxDepth,
    excludes: runtime.git.excludes,
    lookbackDays: runtime.orchestrator.lookbackDays,
  });
}
