import type {
  IssueMetric,
  PullRequestMetric,
  WorkflowRunMetric,
  RepositoryIdentity,
  SessionMetric,
  LocalGitRepoMetric,
  ErrorMetric,
} from './metrics'
import type { DashboardAggregates } from './aggregates'
import type { DailyMetricsRow } from './daily-metrics'
import type { DailyTokenUsageRow } from './daily-token-usage'
import type { TokenUsageRow } from './opencode'

export interface MetricSnapshot {
  id: string
  capturedAt: string
  issues: IssueMetric[]
  pullRequests: PullRequestMetric[]
  workflowRuns: WorkflowRunMetric[]
  repositories: RepositoryIdentity[]
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
  averageSeconds: number | null
  medianSeconds: number | null
  p95Seconds: number | null
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
  startedSessions: number | null
  completedSessions: number | null
  erroredSessions: number | null
  stuckSessions: number | null
  lastActivityAt: string | null
  status: DashboardPanelStatus
  message: string | null
}

export interface DashboardWindowSessionUsageSummary {
  periodStart: string
  periodEnd: string
  totalSessions: number
  startedSessions: number | null
  completedSessions: number | null
  erroredSessions: number | null
  stuckSessions: number | null
  lastActivityAt: string | null
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
  modelUsage: Array<{
    modelName: string
    messages: number
    inputTokens: number | null
    outputTokens: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    cost: number | null
  }>
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

export interface DashboardStateWindow {
  startDay: string
  endDay: string
  days: DashboardWindowDay[]
  missingDays: string[]
  latestDay: DailyMetricsRow | null
  coverage: DashboardWindowCoverage
  warnings: string[]
}

export interface DashboardStateStatus {
  lastRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  refreshInProgress: boolean
  isStale: boolean
  staleReason: string | null
  pollerEnabled: boolean
  refreshStatus: RefreshRunStatus
  lastFailureAt: string | null
  lastSuccessAt: string | null
  nextRunAt: string | null
  refreshState: RefreshRunState
}

export interface DashboardStateUsage {
  sessionUsage: DashboardWindowSessionUsageSummary | null
  tokenUsage: TokenUsageRow | null
  hermesTokenUsage: TokenUsageRow | null
  tokenUsageDays: DailyTokenUsageRow[]
  hermesTokenUsageDays: DailyTokenUsageRow[]
}

export interface DashboardAttentionItem {
  id: string
  kind: 'issue' | 'pr'
  title: string
  repo: string
  url: string
  ageDays: number
  priorityTier: 'stale' | 'ci-failing' | 'ci-blocked' | 'ci-pending'
  statusLabel: string
}

export interface DashboardStateAttention {
  staleThresholdDays: number
  items: DashboardAttentionItem[]
}

export interface DashboardStateResponse {
  window: DashboardStateWindow
  summary: DashboardWindowCards
  usage: DashboardStateUsage
  attention: DashboardStateAttention
  status: DashboardStateStatus
  diagnostics: SourceDiagnostics
}

export interface LatestState {
  snapshot: MetricSnapshot | null
  lastRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  refreshInProgress: boolean
  isStale: boolean
  staleReason: string | null
  pollerEnabled: boolean
  refreshStatus: RefreshRunStatus
  lastFailureAt: string | null
  lastSuccessAt: string | null
  nextRunAt: string | null
  dashboardWindow: DashboardWindow | null
  refreshState: RefreshRunState
  diagnostics: SourceDiagnostics
}

export interface SourceDiagnostics {
  configuredProjectRoots: string[]
  discoveredRepos: Array<{
    repoKey: string
    name: string
    path: string | null
    remoteUrl: string | null
    githubOwner: string | null
    githubRepo: string | null
    source: 'local' | 'github' | 'both'
    isPrivate?: boolean
  }>
  historicalRepos: Array<{
    repoKey: string
    name: string
    path: string | null
    remoteUrl: string | null
    githubOwner: string | null
    githubRepo: string | null
    source: 'local' | 'github' | 'both'
    isPrivate?: boolean
    lastSeenAt: string | null
  }>
  skippedPaths: Array<{ path: string; message: string }>
  parsedGitHubRemotes: Array<{
    repoKey: string
    remoteUrl: string | null
    githubOwner: string | null
    githubRepo: string | null
  }>
  collectionTargets: string[]
  cacheAgeSeconds: number | null
  pollerEnabled: boolean
  pollerIntervalSeconds: number | null
  lastSuccessfulRefreshAt: string | null
  lastError: string | null
  sourceHealth: Record<string, RefreshSourceHealth>
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
  warnings?: string[]
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
