export interface GitHubCollectorConfig {
  owner: string
  repo: string
  token: string
  baseUrl?: string
  staleThresholdDays?: number
  lookbackDays?: number
  skipPersist?: boolean
}

export interface GHIssueRaw {
  number: number
  title: string
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  closed_at: string | null
  html_url: string
  labels: Array<{ name: string }>
  assignee: { login: string } | null
  milestone: { title: string } | null
  pull_request?: unknown
}

export interface GHPullRequestRaw {
  number: number
  title: string
  state: 'open' | 'closed'
  created_at: string
  updated_at: string
  merged_at: string | null
  closed_at: string | null
  html_url: string
  user: { login: string }
  labels: Array<{ name: string }>
  additions: number
  deletions: number
  changed_files: number
  head: { ref: string; sha: string }
  merged: boolean
}

export interface GHWorkflowRunRaw {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null
  created_at: string
  updated_at: string
  head_branch: string
  html_url: string
  run_started_at: string
  event: string
  workflow_id: number
}

export interface GHWorkflowRaw {
  id: number
  name: string
}

export interface GHRepoRaw {
  id: number
  name: string
  owner: { login: string }
  description: string | null
  default_branch: string
  private: boolean
  updated_at: string
  pushed_at: string
  html_url: string
}

export interface PAClientOptions {
  token: string
  baseUrl: string
}

export interface CollectorProgress {
  stage: 'fetching' | 'deriving' | 'caching' | 'done'
  message: string
}

export interface CollectorResult {
  snapshotId: string
  capturedAt: string
  issuesCount: number
  prsCount: number
  checkRunsCount: number
  errors: string[]
  partialData: boolean
  durationMs: number
  snapshot?: import('../../../types/snapshot').MetricSnapshot
}
