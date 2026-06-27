import { connectOpencodeDb, querySessionsByDay, queryModelBreakdown } from '../opencode/db-collector'
import { upsertDailyTokenUsage, getDailyTokenUsageRange } from '../../db/client'
import type { DailyTokenUsageInsert } from '../../../types/daily-token-usage'

export interface DailyTokenUsageCollectorResult {
  success: boolean
  dates: string[]
  upserted: number
  skipped: number
  errors: string[]
}

export async function maybeCollectDailyTokenUsage(): Promise<DailyTokenUsageCollectorResult> {
  const errors: string[] = []
  const dates: string[] = []
  let upserted = 0
  let skipped = 0

  const db = connectOpencodeDb()
  if (!db) {
    errors.push('OpenCode DB not found: unable to connect to opencode.db')
    return { success: false, dates: [], upserted: 0, skipped: 0, errors }
  }
  db.close()

  const dailyAggs = querySessionsByDay(365)
  if (dailyAggs.length === 0) {
    return { success: true, dates: [], upserted: 0, skipped: 0, errors: [] }
  }

  // Find date range from aggregates
  const allDayStrings = dailyAggs.map(d => d.day).sort()
  const minDay = allDayStrings[0]!
  const maxDay = allDayStrings[allDayStrings.length - 1]!

  // Get existing days from DB
  let existingDays: Set<string>
  try {
    const existingRows = getDailyTokenUsageRange(minDay, maxDay)
    existingDays = new Set(existingRows.map(r => r.date))
  } catch (err) {
    errors.push(`Failed to query existing token usage: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, dates: [], upserted: 0, skipped: 0, errors }
  }

  for (const agg of dailyAggs) {
    if (existingDays.has(agg.day)) {
      skipped++
      continue
    }

    // Compute day start/end as UTC ms timestamps for queryModelBreakdown
    const [yearStr, monthStr, dayStr] = agg.day.split('-')
    const year = parseInt(yearStr!, 10)
    const month = parseInt(monthStr!, 10) - 1 // JS months are 0-indexed
    const day = parseInt(dayStr!, 10)
    const dayStart = Date.UTC(year, month, day)
    const dayEnd = dayStart + 24 * 60 * 60 * 1000

    const models = queryModelBreakdown(dayStart, dayEnd)

    const row: DailyTokenUsageInsert = {
      date: agg.day,
      totalSessions: agg.sessions,
      totalMessages: agg.sessions, // approximation per spec
      totalTokens: agg.tokensInput + agg.tokensOutput + agg.tokensReasoning + agg.tokensCacheRead + agg.tokensCacheWrite,
      totalCost: agg.cost,
      modelUsage: models.map(m => ({
        modelName: m.modelName,
        messages: m.messages,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadTokens,
        cacheWriteTokens: m.cacheWriteTokens,
        cost: m.cost,
      })),
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

  return { success: errors.length === 0, dates, upserted, skipped, errors }
}
