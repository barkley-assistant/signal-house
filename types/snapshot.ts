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

export interface LatestState {
  snapshot: MetricSnapshot | null
  lastRefreshAt: string | null
  lastSuccessfulRefreshAt: string | null
  refreshInProgress: boolean
}
