/**
 * Shared domain types for Signal House.
 *
 * Numbers that can be unknown are `number | null` (never `0`).
 * Booleans that can be unknown are `boolean | null` (never `false`).
 */

/** Tri-state repository privacy. `null` = unknown. Fail-closed consumers treat null as private. */
export type RepositoryPrivacy = true | false | null;

export type SourceTier = "core" | "agent" | "tool";

export type CollectorId = "github" | "git" | "hermes" | "opencode";

export interface RepositoryIdentity {
  /** Stable identity: `github:<owner>/<repo>` or `local:<abs path>` (or `local:<name>` for un-remote repos). */
  repoKey: string;
  name: string;
  localPath: string | null;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  source: "github" | "local";
  isPrivate: RepositoryPrivacy;
  present: boolean;
  lastSeenAt: string | null;
}

export interface IssueRecord {
  id: string;
  title: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  repo: string;
  repoKey: string;
  labels: string[];
  assignee: string | null;
  milestone: string | null;
  url: string;
}

export interface PullRequestRecord {
  id: string;
  title: string;
  state: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  headSha: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  repo: string;
  repoKey: string;
  author: string;
  labels: string[];
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  url: string;
  ciStatus: string | null;
}

export interface WorkflowRunRecord {
  id: string;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  completedAt: string | null;
  headSha: string;
  repo: string;
  repoKey: string;
  branch: string;
  workflowName: string;
  url: string;
}

export interface LocalGitRecord {
  repoKey: string;
  path: string;
  repoName: string;
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
  defaultBranch: string | null;
  isGitRepo: boolean;
  recentCommits: number;
  authors: string[];
  latestCommitAt: string | null;
  error: string | null;
  present: boolean;
  lastSeenAt: string | null;
}

/** Per-UTC-day usage rollup for an agent session source. */
export interface UsageDay {
  date: string;
  sessions: number;
  messages: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
  tokensReasoning: number | null;
  /** null = this source has no cost telemetry (or cost unknown for that day). */
  cost: number | null;
  /**
   * Per-model breakdown for THIS day, when the collector could compute it.
   * Used only to feed signal-house's own daily_metrics history (the model
   * rows are persisted per day so the dashboard keeps 90 days of by-model
   * history independent of upstream retention); stripped before the snapshot
   * is persisted so latest_state/snapshots stay lean.
   */
  byModel?: ModelUsageRow[];
}

/** How a model row's `cost` was derived. Server-set by the aggregator when
 *  `SIGNAL_HOUSE_ESTIMATE_COSTS=true` (default). Computed at read time;
 *  never persisted to the snapshot tables. */
export type CostSource = "estimated" | "local" | "passthrough" | "unknown" | "skipped";

/** Rates for one model in per-1M-token terms. The aggregator's
 *  pre-fetched map. */
export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
}

/** Options bundle for the cost estimation pipeline. Passed to the
 *  aggregator's sync merge functions so they don't grow to five+
 *  positional parameters (AGENTS.md "Types"). The resolver builds
 *  `costRates`; the env-var / config produces `estimateCosts`. */
export interface CostEstimationOpts {
  /** Pre-fetched per-machine-key rates, deduped by the resolver. Empty map
   *  is safe (means "no estimation ran yet"). */
  rates: Map<string, ModelRates>;
  /** When true, the aggregator recomputes per-row cost from tokens × rates
   *  and sets `costSource` on each row. When false, upstream cost passes
   *  through and `costSource` is "passthrough" or undefined. */
  enabled: boolean;
}

/** Per-model usage across the collection window. */
export interface ModelUsageRow {
  model: string;
  provider: string | null;
  /** Source discriminator when the row is fed into a cross-source merge
   *  (opencode / hermes). Collector-emitted rows do not set this; it is
   *  applied server-side before mergeModelRows. */
  source?: string;
  sessions: number;
  messages: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  cost: number | null;
  /** How `cost` was derived. Set by the aggregator at merge time. Absent on
   *  raw collector output; the dashboard treats absence as "passthrough"
   *  for display purposes. */
  costSource?: CostSource;
}

export interface UsageSummary {
  source: CollectorId;
  periodDays: number;
  byDay: UsageDay[];
  /** Model breakdown over the whole collection window (periodDays). */
  byModel: ModelUsageRow[];
}

/** Everything a collector observes about its source in one pass. */
export interface SourceData {
  repositories: RepositoryIdentity[];
  issues: IssueRecord[];
  pullRequests: PullRequestRecord[];
  workflowRuns: WorkflowRunRecord[];
  localGit: LocalGitRecord[];
  usage: UsageSummary | null;
  /** Per-UTC-day commit counts observed from local git (bounded window). */
  commitsByDay: Record<string, number>;
}

export function emptySourceData(): SourceData {
  return {
    repositories: [],
    issues: [],
    pullRequests: [],
    workflowRuns: [],
    localGit: [],
    usage: null,
    commitsByDay: {},
  };
}

export interface CollectorError {
  message: string;
  code: string;
  retryable: boolean;
}

export interface CollectorResult<T = SourceData> {
  source: CollectorId;
  ok: boolean;
  /** null when the collector failed or the source is unavailable. */
  data: T | null;
  durationMs: number;
  warnings: string[];
  errors: CollectorError[];
  /** true = source not configured / not present (not a failure, just absent). */
  unavailable: boolean;
}

export interface Collector<T = SourceData> {
  id: CollectorId;
  tier: SourceTier;
  title: string;
  collect(signal: AbortSignal): Promise<CollectorResult<T>>;
}

/** Derived per-repo privacy resolution: repoKey → effective private flag (null→true). */
export type PrivacyMap = Record<string, boolean>;

export type RefreshStatusKind = "success" | "partial" | "failed";

export interface RefreshState {
  status: RefreshStatusKind;
  inProgress: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  lastManualRefreshAt: string | null;
  lockOwner: "manual" | "poller" | null;
  partialData: boolean;
}

/** One daily_metrics write: (date, metric, value, tags). Value NULL = unknown. */
export interface DailyWrite {
  date: string;
  metric: string;
  value: number | null;
  tags: Record<string, string | null>;
}
