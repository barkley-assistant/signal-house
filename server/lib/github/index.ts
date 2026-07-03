export { createApiClient } from './client'
export type { GitHubApiClient } from './client'
export { createCollector } from './collector'
export type { GitHubCollector } from './collector'
export { deriveMergeRate, deriveAll } from './aggregates'
export type {
  GitHubCollectorConfig,
  CollectorResult,
  CollectorProgress,
} from './types'
