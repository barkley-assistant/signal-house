import type { GitHubCollectorConfig } from '../github/types'
import type { LocalGitCollectorConfig } from '../git/types'
import type { SessionCollectorConfig } from '../sessions/types'

export interface OrchestratorConfig {
  github?: GitHubCollectorConfig
  localGit?: LocalGitCollectorConfig
  sessions?: SessionCollectorConfig
}

export interface OrchestratorResult {
  snapshotId: string
  capturedAt: string
  sources: string[]
  errors: string[]
  partialData: boolean
  durationMs: number
}
