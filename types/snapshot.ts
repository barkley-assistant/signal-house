import type {
  IssueMetric,
  PullRequestMetric,
  CheckRunMetric,
  RepositoryMetric,
  SessionMetric,
  LocalGitRepoMetric,
  ErrorMetric,
} from './metrics'
import type { DashboardAggregates } from './aggregates'
import type { DailyMetricsRow } from './daily-metrics'

export interface MetricSnapshot {
  id: string
  capturedAt: string
  issues: IssueMetric[]
  pullRequests: PullRequestMetric[]
  checkRuns: CheckRunMetric[]
  repositories: RepositoryMetric[]
  sessions: SessionMetric[]
  localGit: LocalGitRepoMetric[]
  errors: ErrorMetric[]
  aggregates: DashboardAggregates
  metadata: {
    source: 'github' | 'local' | 'manual' | 'orchestrated'
    refreshDurationMs: number
    partialData: boolean
    errors: string[]
  }
}

export interface SnapshotRow {
  id: string
  capturedAt: string
  data: string
  version: number
  createdAt: string
}

export interface DashboardWindowDay {
  day: string
  isGap: boolean
  metrics: DailyMetricsRow | null
}

export interface DashboardWindowThroughputSummary {
  issuesOpened: number
  issuesClosed: number
  prsCreated: number
  prsMerged: number
  totalCommits: number
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowCycleTimeSummary {
  averageDays: number | null
  medianDays: number | null
  p95Days: number | null
  sampleSize: number
  sourceDay: string | null
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowCISummary {
  totalRuns: number
  passCount: number
  failCount: number
  passRate: number | null
  averageDurationMs: number | null
  sourceDays: number
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowStaleWorkSummary {
  staleIssues: number
  stalePrs: number
  capturedAt: string | null
  reflectsCompleteData: boolean | null
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowSessionSummary {
  totalSessions: number
  sessionErrorCount: number
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowSessionUsageSummary {
  periodStart: string
  periodEnd: string
  totalSessions: number
  messages: number | null
  activeDays: number | null
  totalCost: number | null
  averageCostPerDay: number | null
  averageTokensPerSession: number | null
  medianTokensPerSession: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  uniqueTools: string[]
  toolUsage: Array<{ toolName: string; count: number; percentage: number | null }>
  topActions: Array<{ action: string; count: number }>
  errorCount: number
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowCoverage {
  totalDays: number
  daysWithData: number
  missingDays: number
  hasGaps: boolean
  hasSourceWarnings: boolean
  isComplete: boolean
}

export interface DashboardWindowCards {
  throughput: DashboardWindowThroughputSummary
  cycleTime: DashboardWindowCycleTimeSummary
  ci: DashboardWindowCISummary
  staleWork: DashboardWindowStaleWorkSummary
  sessionUsage: DashboardWindowSessionSummary
}

export type DashboardPanelStatus =
  | 'available'
  | 'partial'
  | 'unconfigured'
  | 'unavailable'
  | 'error'
  | 'empty'
  | 'stale'

export interface DashboardWindow {
  startDay: string
  endDay: string
  days: DashboardWindowDay[]
  missingDays: string[]
  latestDay: DailyMetricsRow | null
  sessionUsage: DashboardWindowSessionUsageSummary | null
  cards: DashboardWindowCards
  coverage: DashboardWindowCoverage
  warnings: string[]
}

export interface LatestState {
  snapshot: MetricSnapshot | null
  lastRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  refreshInProgress: boolean
  isStale: boolean
  dashboardWindow: DashboardWindow | null
  refreshState: RefreshRunState
}

export type RefreshRunStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

export interface RefreshSourceHealth {
  status: 'healthy' | 'degraded' | 'failed' | 'unknown'
  message: string | null
}

export interface RefreshRunRecord {
  startedAt: string
  finishedAt: string
  durationMs: number
  success: boolean
  partialData: boolean
  sources: string[]
  errorSummary: string | null
  skipped: boolean
  skippedReason: string | null
}

export interface RefreshRunState {
  status: RefreshRunStatus
  lastRunStartedAt: string | null
  lastRunFinishedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  nextRunAt: string | null
  lastError: string | null
  durationMs: number | null
  sourceHealth: Record<string, RefreshSourceHealth>
  runHistory: RefreshRunRecord[]
}
