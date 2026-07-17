import { connectOpencodeDb, querySessionsByDay, queryModelBreakdown } from '../opencode/db-collector'
import { upsertDailyTokenUsage } from '../../db/client'
import type { DailyTokenUsageInsert } from '../../../types/daily-token-usage'
import { normalizeModelName } from '../../../utils/string-normalize'
import { sumOrNull } from '../../../utils/null-math'

export interface DailyTokenUsageCollectorResult {
  success: boolean
  dates: string[]
  upserted: number
  errors: string[]
}

export async function maybeCollectDailyTokenUsage(): Promise<DailyTokenUsageCollectorResult> {
  const errors: string[] = []
  const dates: string[] = []
  let upserted = 0

  const db = connectOpencodeDb()
  if (!db) {
    errors.push('OpenCode DB not found: unable to connect to opencode.db')
    return { success: false, dates: [], upserted: 0, errors }
  }
  db.close()

  const dailyAggs = querySessionsByDay(365)
  if (dailyAggs.length === 0) {
    return { success: true, dates: [], upserted: 0, errors: [] }
  }

  for (const agg of dailyAggs) {
    // Compute day start/end as UTC ms timestamps for queryModelBreakdown
    const [yearStr, monthStr, dayStr] = agg.day.split('-')
    const year = parseInt(yearStr!, 10)
    const month = parseInt(monthStr!, 10) - 1 // JS months are 0-indexed
    const day = parseInt(dayStr!, 10)
    const dayStart = Date.UTC(year, month, day)
    const dayEnd = dayStart + 24 * 60 * 60 * 1000

    const models = queryModelBreakdown(dayStart, dayEnd)

    // Null-aware per-day totals: a day's token/cost total stays `null`
    // only if every contributing session had a null column; otherwise
    // non-null values are summed. (issue #343)
    const totalTokens = sumOrNull([
      agg.tokensInput,
      agg.tokensOutput,
      agg.tokensReasoning,
      agg.tokensCacheRead,
      agg.tokensCacheWrite,
    ])

    const row: DailyTokenUsageInsert = {
      date: agg.day,
      totalSessions: agg.sessions,
      totalMessages: agg.sessions, // approximation per spec
      totalTokens: totalTokens ?? 0,
      totalCost: agg.cost,
      modelUsage: models.map(m => {
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
      }),
      rawJson: null,
    }

    try {
      upsertDailyTokenUsage(row)
    } catch (err) {
      errors.push(`Failed to upsert daily token usage for ${agg.day}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    upserted++
    dates.push(agg.day)
  }

  return { success: errors.length === 0, dates, upserted, errors }
}
