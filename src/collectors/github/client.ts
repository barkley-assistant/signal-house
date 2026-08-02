/**
 * GitHub REST API client — standards-based fetch through Bun.
 *
 * Handles: token absence (caller decides), authentication failure (401),
 * rate limits (403 + headers), pagination (Link header), partial failures,
 * and time-window filtering. Never includes the token in error messages.
 */

export interface GitHubRepoSummary {
  id: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
  htmlUrl: string;
  archived: boolean;
}

export interface GitHubIssue {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  htmlUrl: string;
  labels: string[];
  assigneeLogin: string | null;
  milestoneTitle: string | null;
  userLogin: string;
}

export interface GitHubPullRequest {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  htmlUrl: string;
  headSha: string | null;
  labels: string[];
  userLogin: string;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  draft: boolean;
}

export interface GitHubWorkflowRun {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  completedAt: string | null;
  headSha: string;
  headBranch: string;
  htmlUrl: string;
  displayTitle: string;
}

export interface GitHubRepoDetail {
  repo: GitHubRepoSummary;
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  workflowRuns: GitHubWorkflowRun[];
}

export type GitHubErrorKind = "auth" | "rate_limit" | "not_found" | "network" | "http";

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    /** Request path that produced the error, e.g. /repos/o/r/pulls (for 404 disambiguation). */
    readonly path: string | null = null,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const API_BASE = "https://api.github.com";

// Concurrent repo fetches. GitHub rewards parallelism, but too many concurrent
// calls trip its secondary rate limits — 5 is a conservative middle ground.
const REPO_CONCURRENCY = 5;

export class GitHubClient {
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(private readonly opts: GitHubClientOptions) {
    this.headers = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "signal-house-bun",
      authorization: `Bearer ${opts.token}`,
    };
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * GET with pagination; returns all items across pages.
   * Some endpoints wrap the list in an object ({total_count, <listKey>: []});
   * pass listKey to unwrap. Flat arrays are accepted too.
   */
  private async getPaged<T>(path: string, params: Record<string, string | number>, listKey?: string): Promise<T[]> {
    const url = new URL(`${opts_base(this.opts)}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const items: T[] = [];
    let nextUrl: URL | null = url;
    let page = 0;
    while (nextUrl && page < 10) {
      const res = await this.fetchJson(nextUrl.toString());
      const body = (await res.json()) as unknown;
      const list: unknown = Array.isArray(body) ? body : listKey ? (body as Record<string, unknown>)[listKey] : undefined;
      if (!Array.isArray(list)) {
        throw new GitHubError(
          "http",
          `GitHub ${res.status} returned non-array for ${redactUrl(nextUrl.toString())}: expected array${listKey ? ` or {${listKey}: []}` : ""}, got ${typeof body}`,
          page > 0, // page-1 non-array is a hard error; page-2+ retryable
          res.status,
        );
      }
      items.push(...(list as T[]));
      page++;
      nextUrl = parseNextLink(res.headers.get("link"));
    }
    return items;
  }

  private async fetchJson(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers, signal: ctrl.signal });
    } catch (err) {
      const aborted = ctrl.signal.aborted;
      throw new GitHubError("network", aborted ? `request timed out after ${this.timeoutMs}ms` : `network error: ${message(err)}`, true);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) throw new GitHubError("auth", "GitHub authentication failed (401) — token invalid or missing scopes", false, 401);
    if (res.status === 403) {
      // Rate limiting is the common 403; a 403 without rate-limit headers is a
      // permission problem. Either way it's retryable for our purposes.
      const remaining = res.headers.get("x-ratelimit-remaining");
      const message =
        remaining === "0"
          ? "GitHub rate limit exceeded (403)"
          : `GitHub access denied (403)${remaining ? `, ${remaining} requests remaining` : ""}`;
      throw new GitHubError("rate_limit", message, true, 403);
    }
    if (res.status === 404) throw new GitHubError("not_found", `GitHub resource not found (404): ${redactUrl(url)}`, false, 404, new URL(url).pathname);
    if (!res.ok) throw new GitHubError("http", `GitHub HTTP ${res.status} for ${redactUrl(url)}`, true, res.status);
    return res;
  }

  /** Repos for an explicit owner, or the authenticated user's repos. */
  async listRepos(owner: string | null): Promise<GitHubRepoSummary[]> {
    const path = owner ? `/users/${encodeURIComponent(owner)}/repos` : "/user/repos";
    const raw = await this.getPaged<Record<string, unknown>>(path, { per_page: 100, sort: "updated" });
    return raw.map(mapRepo);
  }

  /** A single repo's details + issues + PRs + workflow runs. */
  async fetchRepo(owner: string, repoName: string, since: string): Promise<GitHubRepoDetail> {
    const encOwner = encodeURIComponent(owner);
    const encRepo = encodeURIComponent(repoName);
    // A repo that has never had a pull request 404s on /pulls (GitHub quirk,
    // not an error). Tolerate that one endpoint — the repo is real, issues
    // and CI still collect; the pulls list is just empty.
    const pullsPath = `/repos/${encOwner}/${encRepo}/pulls`;
    const [detailRes, issues, pullRequests, workflowRuns] = await Promise.all([
      this.fetchJson(`${opts_base(this.opts)}/repos/${encOwner}/${encRepo}`).then((r) => r.json() as Promise<Record<string, unknown>>),
      this.getPaged<Record<string, unknown>>(`/repos/${encOwner}/${encRepo}/issues`, {
        state: "all",
        since,
        per_page: 100,
      }),
      this.getPaged<Record<string, unknown>>(pullsPath, { state: "all", per_page: 100 }).catch((err: unknown) => {
        if (err instanceof GitHubError && err.kind === "not_found" && err.path?.endsWith("/pulls")) return [];
        throw err;
      }),
      this.getPaged<Record<string, unknown>>(`/repos/${encOwner}/${encRepo}/actions/runs`, { per_page: 100 }, "workflow_runs"),
    ]);

    const repoSummary = mapRepo(detailRes);
    return {
      repo: repoSummary,
      issues: issues
        .filter((i) => !("pull_request" in i)) // issues API includes PRs; exclude them
        .map(mapIssue),
      pullRequests: pullRequests
        .filter((pr) => withinWindow(pr.updated_at as string | undefined, since) || (pr.state as string) === "open")
        .map(mapPullRequest),
      workflowRuns: workflowRuns.map(mapWorkflowRun).filter((w) => withinWindow(w.createdAt, since)),
    };
  }

  /** Fetch details for several repos with a bounded concurrency pool.
   *  Failures are per-repo, never fatal; result order matches input order. */
  async fetchRepos(repos: Array<{ owner: string; repo: string }>, since: string): Promise<Array<GitHubRepoDetail | GitHubError>> {
    const out: Array<GitHubRepoDetail | GitHubError> = new Array(repos.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++;
        if (i >= repos.length) return;
        const r = repos[i];
        try {
          out[i] = await this.fetchRepo(r.owner, r.repo, since);
        } catch (err) {
          out[i] = err instanceof GitHubError ? err : new GitHubError("network", `unexpected GitHub error: ${message(err)}`, true);
        }
      }
    };
    const workers = Array.from({ length: Math.max(1, Math.min(REPO_CONCURRENCY, repos.length)) }, worker);
    await Promise.all(workers);
    return out;
  }
}

function opts_base(opts: GitHubClientOptions): string {
  return opts.baseUrl ?? API_BASE;
}

function parseNextLink(link: string | null): URL | null {
  if (!link) return null;
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  if (!m) return null;
  try {
    return new URL(m[1]);
  } catch {
    return null;
  }
}

function withinWindow(iso: string | undefined, since: string): boolean {
  if (!iso) return false;
  return iso >= since;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return "(unknown url)";
  }
}

function mapRepo(raw: Record<string, unknown>): GitHubRepoSummary {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    fullName: String(raw.full_name ?? ""),
    private: Boolean(raw.private),
    defaultBranch: raw.default_branch ? String(raw.default_branch) : null,
    htmlUrl: String(raw.html_url ?? ""),
    archived: Boolean(raw.archived),
  };
}

function mapIssue(raw: Record<string, unknown>): GitHubIssue {
  return {
    id: String(raw.id ?? ""),
    number: Number(raw.number ?? 0),
    title: String(raw.title ?? ""),
    state: raw.state === "open" ? "open" : "closed",
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    closedAt: raw.closed_at ? String(raw.closed_at) : null,
    htmlUrl: String(raw.html_url ?? ""),
    labels: (raw.labels as Array<{ name?: unknown }> | undefined)?.map((l) => String(l.name ?? "")).filter(Boolean) ?? [],
    assigneeLogin: (raw.assignee as { login?: unknown } | null)?.login ? String((raw.assignee as { login: unknown }).login) : null,
    milestoneTitle: (raw.milestone as { title?: unknown } | null)?.title ? String((raw.milestone as { title: unknown }).title) : null,
    userLogin: String((raw.user as { login?: unknown } | null)?.login ?? ""),
  };
}

function mapPullRequest(raw: Record<string, unknown>): GitHubPullRequest {
  const head = raw.head as { sha?: unknown } | undefined;
  return {
    id: String(raw.id ?? ""),
    number: Number(raw.number ?? 0),
    title: String(raw.title ?? ""),
    state: raw.state === "open" ? "open" : "closed",
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    mergedAt: raw.merged_at ? String(raw.merged_at) : null,
    closedAt: raw.closed_at ? String(raw.closed_at) : null,
    htmlUrl: String(raw.html_url ?? ""),
    headSha: head?.sha ? String(head.sha) : null,
    labels: (raw.labels as Array<{ name?: unknown }> | undefined)?.map((l) => String(l.name ?? "")).filter(Boolean) ?? [],
    userLogin: String((raw.user as { login?: unknown } | null)?.login ?? ""),
    additions: typeof raw.additions === "number" ? raw.additions : null,
    deletions: typeof raw.deletions === "number" ? raw.deletions : null,
    changedFiles: typeof raw.changed_files === "number" ? raw.changed_files : null,
    draft: Boolean(raw.draft),
  };
}

function mapWorkflowRun(raw: Record<string, unknown>): GitHubWorkflowRun {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    status: String(raw.status ?? "unknown"),
    conclusion: raw.conclusion ? String(raw.conclusion) : null,
    createdAt: String(raw.created_at ?? ""),
    completedAt: raw.completed_at ? String(raw.completed_at) : null,
    headSha: String(raw.head_sha ?? ""),
    headBranch: String(raw.head_branch ?? ""),
    htmlUrl: String(raw.html_url ?? ""),
    displayTitle: String(raw.display_title ?? ""),
  };
}
