import type {
  CollectorId,
  CollectorResult,
  SourceData,
  RefreshStatusKind,
  UsageSummary,
} from "../shared/types";

export interface RuntimeConfig {
  dev: boolean;
  environment: "development" | "production";
  host: string;
  port: number;
  db: { dir: string; file: string; path: string };
  auth: { username: string; password: string; enabled: boolean };
  github: { token: string | null; owner: string | null; repo: string | null };
  git: {
    repos: string[];
    roots: string[];
    globs: string[];
    maxDepth: number;
    excludes: string[];
  };
  hermes: { dbPath: string };
  opencode: { dbPath: string };
  sessions: { periodDays: number; dir: string | null };
  poller: {
    enabled: boolean;
    intervalSeconds: number;
    startupDelaySeconds: number;
    runOnStartup: boolean;
  };
  orchestrator: { concurrency: number; lookbackDays: number };
  staleness: { staleThresholdDays: number; staleThresholdMinutes: number };
  retention: { snapshotsDays: number; dailyMetricsDays: number; sessionsDays: number; workflowRunsDays: number };
  privacy: { showPrivateRepoItems: boolean };
  refresh: { lockStaleMs: number };
}

export interface RefreshOutcome {
  status: RefreshStatusKind;
  ranAt: string;
  startedAt: string;
  finishedAt: string;
  results: CollectorResult<SourceData>[];
  partialData: boolean;
  privacyUncoveredCount: number;
}

export interface PersistedState {
  source: CollectorId;
  ok: boolean;
  unavailable: boolean;
  capturedAt: number;
  window: { start: string; end: string };
  data: SourceData | null;
  warnings: string[];
  errors: Array<{ message: string; code: string; retryable: boolean }>;
  usage: UsageSummary | null;
}
