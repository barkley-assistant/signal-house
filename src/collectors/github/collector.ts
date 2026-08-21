/**
 * GitHub collector — issues, PRs, workflow runs, repository identity/visibility.
 *
 * Privacy posture: repo visibility comes straight from the GitHub API
 * (`private` boolean) — the only source that can confirm it. Local-git-only
 * repositories are never classified here (they carry `isPrivate: null` in the
 * git collector). When no token/owner/repo is configured the collector reports
 * the source as unavailable (not a failure). A failed fetch for one repo is a
 * per-repo warning, not a whole-source failure.
 */

import type { Collector, SourceData, RepositoryIdentity, IssueRecord, PullRequestRecord, WorkflowRunRecord, CollectorResult } from "../../shared/types";
import { emptySourceData } from "../../shared/types";
import { GitHubClient, GitHubError } from "./client";
import { utcDaysAgo } from "../../shared/dates";
import type { RuntimeConfig } from "../../config/types";

export interface GitHubCollectorConfig {
  token: string | null;
  owner: string | null;
  repo: string | null;
  lookbackDays: number;
}

export class GitHubCollector implements Collector<SourceData> {
  readonly id = "github" as const;
  readonly tier = "core" as const;
  readonly title = "GitHub";

  /** Repos discovered by the git collector (from local remotes), fed by the
   *  refresh runner before each collect. Merged with the explicit config. */
  private candidates: Array<{ owner: string; repo: string }> = [];

  constructor(private readonly config: GitHubCollectorConfig) {}

  setCandidates(repos: Array<{ owner: string; repo: string }>): void {
    this.candidates = repos;
  }

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    const warnings: string[] = [];
    const errors: CollectorResult["errors"] = [];

    const cfg = configFromRuntime(this.config);
    if (!cfg) {
      return {
        source: "github",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: ["GitHub token not configured — source unavailable"],
        errors: [],
        unavailable: true,
      };
    }

    const client = new GitHubClient({ token: cfg.token });
    const since = utcDaysAgo(this.config.lookbackDays);

    try {
      const targets = mergeTargets(resolveRepos(cfg.owner, cfg.repo), this.candidates);
      if (targets.length === 0) {
        return {
          source: "github",
          ok: true,
          data: emptySourceData(),
          durationMs: Date.now() - start,
          warnings: ["No GitHub repos configured or discovered — source unavailable"],
          errors: [],
          unavailable: true,
        };
      }
      const results = await client.fetchRepos(targets, since);

      const data = emptySourceData();
      const seen = new Set<string>();

      for (const r of results) {
        if (r instanceof GitHubError) {
          if (r.kind === "not_found") {
            // A discovered repo may have been renamed/removed on GitHub —
            // worth a warning, never a whole-source failure. (404s on the
            // /pulls endpoint are handled earlier in the client: a zero-PR
            // repo 404s there and is treated as an empty list, so this
            // branch only sees real repo-level 404s.)
            warnings.push(r.message);
            continue;
          }
          errors.push({ message: r.message, code: r.kind, retryable: r.retryable });
          continue;
        }
        const repoKey = `github:${r.repo.fullName}`;
        seen.add(repoKey);
        data.repositories.push(toRepositoryIdentity(r.repo, repoKey));
        for (const i of r.issues) {
          if (!withinLookback(i.createdAt, since) && i.state !== "open") continue;
          data.issues.push(toIssue(i, r.repo.fullName, repoKey));
        }
        for (const pr of r.pullRequests) {
          data.pullRequests.push(toPullRequest(pr, r.repo.fullName, repoKey));
        }
        for (const w of r.workflowRuns) {
          data.workflowRuns.push(toWorkflowRun(w, r.repo.fullName, repoKey));
        }
      }

      // Only surface warnings for complete repo-level failures; a missing
      // repo is a configuration concern, a 401/403 is worth surfacing.
      const fatal = errors.find((e) => ["auth", "rate_limit"].includes(e.code));
      if (fatal) warnings.push(fatal.message);

      if (signal.aborted) {
        return {
          source: "github",
          ok: false,
          data: null,
          durationMs: Date.now() - start,
          warnings,
          errors: [...errors, { message: "cancelled", code: "cancelled", retryable: false }],
          unavailable: false,
        };
      }

      return {
        source: "github",
        ok: errors.length === 0,
        data,
        durationMs: Date.now() - start,
        warnings,
        errors,
        unavailable: false,
      };
    } catch (err) {
      const gh = err instanceof GitHubError ? err : null;
      errors.push({
        message: gh?.message ?? "GitHub collector failed unexpectedly",
        code: gh?.kind ?? "unexpected",
        retryable: gh?.retryable ?? true,
      });
      return {
        source: "github",
        ok: false,
        data: null,
        durationMs: Date.now() - start,
        warnings,
        errors,
        unavailable: false,
      };
    }
  }
}

function configFromRuntime(c: GitHubCollectorConfig): { token: string; owner: string; repo: string } | null {
  if (!c.token) return null;
  if (!c.owner && !c.repo) return null;
  return { token: c.token, owner: c.owner ?? "", repo: c.repo ?? "" };
}

function resolveRepos(owner: string, repo: string): Array<{ owner: string; repo: string }> {
  if (owner && repo) return [{ owner, repo }];
  // A single explicit repo is the documented config; for an owner without a
  // repo the collector can still fetch the owner's top public repos, but the
  // documented contract is "explicit owner OR explicit repo". We require both
  // for a scoped fetch to keep pagination bounded.
  if (owner) return [{ owner, repo: repo || owner }];
  return [{ owner: owner || "", repo }];
}

/** Explicit config repos ∪ discovered candidates, deduplicated by owner/repo. */
export function mergeTargets(
  explicit: Array<{ owner: string; repo: string }>,
  discovered: Array<{ owner: string; repo: string }>,
): Array<{ owner: string; repo: string }> {
  const seen = new Set<string>();
  const out: Array<{ owner: string; repo: string }> = [];
  for (const t of [...explicit, ...discovered]) {
    if (!t.owner || !t.repo) continue;
    const key = `${t.owner}/${t.repo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** GitHub repos discovered by the git collector from local remotes. */
export function extractGithubTargets(data: SourceData): Array<{ owner: string; repo: string }> {
  const out: Array<{ owner: string; repo: string }> = [];
  for (const r of data.localGit) {
    if (r.githubOwner && r.githubRepo) out.push({ owner: r.githubOwner, repo: r.githubRepo });
  }
  return out;
}

function toRepositoryIdentity(r: { fullName: string; name: string; private: boolean; defaultBranch: string | null; htmlUrl: string; archived: boolean }, repoKey: string): RepositoryIdentity {
  const [owner, name] = r.fullName.split("/");
  return {
    repoKey,
    name: r.name,
    localPath: null,
    remoteUrl: r.htmlUrl,
    githubOwner: owner ?? null,
    githubRepo: name ?? null,
    source: "github",
    isPrivate: r.private,
    present: !r.archived,
    lastSeenAt: null,
  };
}

function toIssue(i: { id: string; title: string; state: "open" | "closed"; createdAt: string; updatedAt: string; closedAt: string | null; htmlUrl: string; labels: string[]; assigneeLogin: string | null; milestoneTitle: string | null }, fullName: string, repoKey: string): IssueRecord {
  return {
    id: i.id,
    title: i.title,
    state: i.state,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    closedAt: i.closedAt,
    repo: fullName,
    repoKey,
    labels: i.labels,
    assignee: i.assigneeLogin,
    milestone: i.milestoneTitle,
    url: i.htmlUrl,
  };
}

function toPullRequest(pr: { id: string; title: string; state: "open" | "closed"; createdAt: string; updatedAt: string; mergedAt: string | null; closedAt: string | null; headSha: string | null; labels: string[]; userLogin: string; additions: number | null; deletions: number | null; changedFiles: number | null; htmlUrl: string }, fullName: string, repoKey: string): PullRequestRecord {
  return {
    id: pr.id,
    title: pr.title,
    state: pr.state,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headSha: pr.headSha,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    repo: fullName,
    repoKey,
    author: pr.userLogin,
    labels: pr.labels,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    // htmlUrl from the GitHub API is the canonical pulls URL
    // (https://github.com/<owner>/<repo>/pull/<number>) — never rebuild it
    // from the internal node id.
    url: pr.htmlUrl,
    ciStatus: null,
  };
}

function toWorkflowRun(w: { id: string; name: string; status: string; conclusion: string | null; createdAt: string; completedAt: string | null; headSha: string; headBranch: string; htmlUrl: string }, fullName: string, repoKey: string): WorkflowRunRecord {
  return {
    id: w.id,
    name: w.name,
    status: w.status,
    conclusion: w.conclusion,
    createdAt: w.createdAt,
    completedAt: w.completedAt,
    headSha: w.headSha,
    repo: fullName,
    repoKey,
    branch: w.headBranch,
    workflowName: w.name,
    url: w.htmlUrl,
  };
}

function withinLookback(iso: string, since: string): boolean {
  return iso >= since;
}

export function createGithubCollector(runtime: RuntimeConfig): GitHubCollector {
  return new GitHubCollector({
    token: runtime.github.token,
    owner: runtime.github.owner,
    repo: runtime.github.repo,
    lookbackDays: runtime.orchestrator.lookbackDays,
  });
}
