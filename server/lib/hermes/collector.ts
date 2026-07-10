import { connectHermesDb, querySessionsByDay, queryModelBreakdown } from './db-collector'
import type { TokenUsageRow } from '../../../types/opencode'

export interface TokenUsageCollectorResult extends TokenUsageRow {
  errors: string[]
}

export function collectHermesTokenUsageSnapshot(): TokenUsageCollectorResult {
  const collectedAt = new Date().toISOString()
  const periodEnd = collectedAt
  const periodStart = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  const errors: string[] = []

  const db = connectHermesDb()
  if (!db) {
    errors.push('Hermes DB not found: unable to connect to state.db')
    return { periodStart, periodEnd, source: 'hermesdb', toolName: 'hermes-agent', totalSessions: 0, totalMessages: 0, totalTokens: 0, totalCost: null, modelUsage: [], rawJson: null, collectedAt, errors }
  }
  db.close()

  const since = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()

  const dailyAggs = querySessionsByDay(28)
  const totalSessions = dailyAggs.reduce((sum, d) => sum + d.sessions, 0)
  const totalTokens = dailyAggs.reduce((sum, d) => sum + d.tokensInput + d.tokensOutput + d.tokensReasoning + d.tokensCacheRead + d.tokensCacheWrite, 0)
  const totalCost = dailyAggs.reduce((sum, d) => sum + d.cost, 0)

  const models = queryModelBreakdown(since)
  const modelUsage = models.map(m => ({
    modelName: m.modelName,
    messages: m.messages,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    tokensReasoning: m.reasoningTokens,
    cacheReadTokens: m.cacheReadTokens,
    cacheWriteTokens: m.cacheWriteTokens,
    cost: m.cost,
  }))

  return {
    periodStart,
    periodEnd,
    source: 'hermesdb',
    toolName: 'hermes-agent',
    totalSessions,
    totalMessages: totalSessions, // approximation — Hermes sessions don't have a message_count per-session
    totalTokens,
    totalCost,
    modelUsage,
    rawJson: null,
    collectedAt,
    errors: [],
  }
}
