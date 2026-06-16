export interface IssueMetric {
  id: string
  title: string
  state: 'open' | 'closed'
  createdAt: string
  updatedAt: string
  closedAt: string | null
  repo: string
  repoKey: string
  labels: string[]
  assignee: string | null
  milestone: string | null
  url: string
}

export interface PullRequestMetric {
  id: string
  title: string
  state: 'open' | 'closed' | 'merged'
  createdAt: string
  updatedAt: string
  mergedAt: string | null
  closedAt: string | null
  repo: string
  repoKey: string
  author: string
  labels: string[]
  additions: number
  deletions: number
  changedFiles: number
  url: string
  ciStatus: 'pending' | 'success' | 'failure' | 'cancelled' | null
}

export interface CheckRunMetric {
  id: string
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | 'startup_failure' | null
  createdAt: string
  completedAt: string | null
  repo: string
  repoKey: string
  branch: string
  workflowName: string
  url: string | null
}

export interface RepositoryIdentity {
  repoKey: string
  name: string
  localPath: string | null
  remoteUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  source: 'local' | 'github' | 'both'
}

export interface RepositoryMetric extends RepositoryIdentity {
  id: string
  owner: string
  description: string | null
  defaultBranch: string
  isPrivate: boolean
  updatedAt: string
  pushedAt: string
  url: string
}

export interface SessionMetric {
  id: string
  toolName: string
  action: string
  timestamp: string
  durationMs: number | null
  metadata: Record<string, unknown>
  success: boolean
}

export interface ErrorMetric {
  id: string
  source: string
  level: 'error' | 'warning' | 'info'
  message: string
  timestamp: string
  stackTrace: string | null
  metadata: Record<string, unknown>
}

export interface LocalGitRepoMetric {
  repoKey: string
  source: 'local' | 'github' | 'both'
  path: string
  repoName: string
  remoteUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  defaultBranch: string | null
  isGitRepo: boolean
  recentCommits: number
  commitsByDay: Record<string, number>
  authors: string[]
  latestCommitAt: string | null
  error: string | null
}

export type MetricDomain = 'issues' | 'pullRequests' | 'checkRuns' | 'repositories' | 'sessions' | 'localGit' | 'errors'

export type MetricRecord = IssueMetric | PullRequestMetric | CheckRunMetric | RepositoryMetric | SessionMetric | LocalGitRepoMetric | ErrorMetric
