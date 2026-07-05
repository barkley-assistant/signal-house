export interface TokenUsageRow {
  periodStart: string
  periodEnd: string
  source: string
  toolName: string
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
  collectedAt: string
}

