import { connectHermesDb, querySessionsByDay, queryModelBreakdown } from './db-collector'
import type { TokenUsageRow } from '../../../types/opencode'
import { normalizeModelName } from '../../../utils/string-normalize'
import { sumOrNull } from '../../../utils/null-math'

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

  const since = Math.floor((Date.now() - 28 * 24 * 60 * 60 * 1000) / 1000)

  const dailyAggs = querySessionsByDay(28)
  const totalSessions = dailyAggs.reduce((sum, d) => sum + d.sessions, 0)
  // Null-aware reduction (issue #343): a day contributes its token total
  // only when at least one of its five token fields is non-null.
  const totalTokens = sumOrNull(
    dailyAggs.map((d) => sumOrNull([
      d.tokensInput,
      d.tokensOutput,
      d.tokensReasoning,
      d.tokensCacheRead,
      d.tokensCacheWrite,
    ])),
  ) ?? 0
  const totalCost = sumOrNull(dailyAggs.map((d) => d.cost))

  const models = queryModelBreakdown(since)
  const modelUsage = models.map(m => {
    const { slug } = normalizeModelName(m.modelName)
    return {
      modelName: slug,
      provider: m.provider ?? null,
      messages: m.messages,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      tokensReasoning: m.reasoningTokens,
      cacheReadTokens: m.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens,
      cost: m.cost,
    }
  })

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
