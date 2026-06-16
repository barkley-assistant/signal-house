export interface LocalGitRepoConfig {
  path: string
}

export interface LocalGitCollectorConfig {
  repos: LocalGitRepoConfig[]
  lookbackDays?: number
}

export interface RepoDiscoveryConfig {
  roots: string[]
  globs?: string[]
  maxDepth?: number
  excludes?: string[]
}

export interface RepoDiscoveryWarning {
  path: string
  message: string
}

export interface RepoDiscoveryResult {
  repos: string[]
  warnings: RepoDiscoveryWarning[]
}

export interface LocalGitCollectorResult {
  repos: LocalGitRepoInfo[]
  errors: string[]
}

export interface LocalGitRepoInfo {
  path: string
  repoName: string
  defaultBranch: string | null
  isGitRepo: boolean
  recentCommits: number
  commitsByDay: Record<string, number>
  authors: string[]
  latestCommitAt: string | null
  error: string | null
}
