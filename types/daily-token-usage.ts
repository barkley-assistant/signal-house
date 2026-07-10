export type TokenUsageSource = 'opencode' | 'hermes'

export interface DailyTokenUsageRow {
  date: string
  source: TokenUsageSource
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCost: number | null
  modelUsage: Array<{
    modelName: string
    messages: number
    inputTokens: number | null
    outputTokens: number | null
    tokensReasoning: number | null
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    cost: number | null
  }>
  rawJson: string | null
  createdAt: string
}

export interface DailyTokenUsageInsert {
  date: string
  source?: TokenUsageSource
  totalSessions: number
  totalMessages: number
  totalTokens: number
  totalCost: number | null
  modelUsage: DailyTokenUsageRow['modelUsage']
  rawJson: string | null
}
