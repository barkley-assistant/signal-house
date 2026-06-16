export interface LocalGitRepoConfig {
  path: string
  repoKey?: string
  name?: string
  remoteUrl?: string | null
  githubOwner?: string | null
  githubRepo?: string | null
  source?: 'local' | 'github' | 'both'
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

export interface RepoDiscoveryRepo {
  repoKey: string
  name: string
  path: string
  remoteUrl: string | null
  githubOwner: string | null
  githubRepo: string | null
  source: 'local' | 'github' | 'both'
}

export interface RepoDiscoveryResult {
  repos: RepoDiscoveryRepo[]
  warnings: RepoDiscoveryWarning[]
}

export interface LocalGitCollectorResult {
  repos: LocalGitRepoInfo[]
  errors: string[]
}

export interface LocalGitRepoInfo {
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
