export interface ThroughputAggregate {
  periodStart: string
  periodEnd: string
  issuesClosed: number
  issuesOpened: number
  prsMerged: number
  prsCreated: number
  totalCommits: number
}

export interface CycleTimeAggregate {
  periodStart: string
  periodEnd: string
  averageSeconds: number
  medianSeconds: number
  p95Seconds: number
  sampleSize: number
}

export interface CIAggregate {
  periodStart: string
  periodEnd: string
  totalRuns: number
  passCount: number
  failCount: number
  passRate: number
  averageDurationMs: number | null
}

export interface StaleWorkAggregate {
  asOf: string
  staleIssues: number
  stalePRs: number
  staleThresholdDays: number
  oldestItemDays: number | null
}

export interface SessionUsageAggregate {
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
  modelUsage?: Array<{
    modelName: string
    messages: number
    inputTokens: number | null
    outputTokens: number | null
    tokensReasoning: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    cost: number | null
  }>
  topActions: Array<{ action: string; count: number }>
  errorCount: number
}

export interface TokenUsageAggregate {
  periodStart: string
  periodEnd: string
  source: string
  toolName: string
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCost: number | null
  modelUsage: NonNullable<SessionUsageAggregate['modelUsage']>
  rawJson: string | null
  collectedAt: string
}

export interface RepositoryPrivacyAggregate {
  privacyMap: Record<string, boolean>
}

export interface DashboardAggregates {
  throughput: ThroughputAggregate
  cycleTime: CycleTimeAggregate | null
  ci: CIAggregate | null
  staleWork: StaleWorkAggregate
  sessionUsage: SessionUsageAggregate | null
  tokenUsage?: TokenUsageAggregate | null
  repositoryPrivacy?: RepositoryPrivacyAggregate | null
  computedAt: string
}

export type AggregateType = 'throughput' | 'cycleTime' | 'ci' | 'staleWork' | 'sessionUsage' | 'tokenUsage' | 'repositoryPrivacy'
