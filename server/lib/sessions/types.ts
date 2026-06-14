export interface SessionCollectorConfig {
  periodDays?: number
  opencodeCommand?: string
}

export interface SessionCollectorResult {
  sessions: import('../../../types/metrics').SessionMetric[]
  sessionUsage: import('../../../types/aggregates').SessionUsageAggregate | null
  gap: string | null
  errors: string[]
}
