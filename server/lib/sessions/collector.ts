import type { SessionUsageAggregate } from '../../../types/aggregates'
import { getSessionPeriodDays } from '../runtime-config'
import {
  connectOpencodeDb,
  queryModelBreakdown,
  querySessions,
  querySessionsByDay,
  queryToolUsage,
} from '../opencode/db-collector'
import type { SessionCollectorConfig, SessionCollectorResult } from './types'
import { sumOrNull } from '../../../utils/null-math'

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function asNullableCount(value: number): number | null {
  return value > 0 ? value : null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function createSessionCollector(config: SessionCollectorConfig = {}) {
  const periodDays = config.periodDays ?? getSessionPeriodDays()
  const dbConfig = { dbPath: config.dbPath }

  return {
    async collect(): Promise<SessionCollectorResult> {
      const db = connectOpencodeDb(dbConfig)
      if (!db) {
        const gap = `opencode stats DB unavailable: no opencode database available. Install opencode and run 'opencode stats' to populate session metrics.`
        return { sessions: [], sessionUsage: null, gap, errors: [] }
      }

      db.close()

      try {
        const now = Date.now()
        const since = now - periodDays * 24 * 60 * 60 * 1000

        const sessionsByDay = querySessionsByDay(periodDays, dbConfig)
        const sessions = querySessions(since, now, dbConfig)
        const modelBreakdown = queryModelBreakdown(since, now, dbConfig)
        const modelUsage = modelBreakdown.map(m => ({
          modelName: m.modelName,
          messages: m.messages,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          tokensReasoning: m.reasoningTokens,
          cacheReadTokens: m.cacheReadTokens,
          cacheWriteTokens: m.cacheWriteTokens,
          cost: m.cost,
        }))
        const toolUsageData = queryToolUsage(since, now, dbConfig)

        const totalSessions = sessions.length
        const totalToolCalls = toolUsageData.reduce((sum, t) => sum + t.count, 0)
        // Null-aware reduction (issue #343): a day's cost contributes only
        // if non-null; the period total is `null` only if every day was null.
        const totalCost = sumOrNull(sessionsByDay.map(day => day.cost))
        const activeDays = sessionsByDay.length
        const messages = sum(modelUsage.map(model => model.messages))
        // Per-session token totals: skip nulls (issue #343). A session with
        // all-null token fields contributes 0 to the array of totals,
        // which `median` and `averageTokensPerSession` then handle as a
        // zero-token session. The `null` semantic is preserved at the
        // per-session level (still surfaced as `null` in `modelUsage[i]`)
        // and at the period-total level via `sumOrNull` for each axis.
        const tokenTotals = sessions.map(session =>
          sumOrNull([
            session.tokensInput,
            session.tokensOutput,
            session.tokensReasoning,
            session.tokensCacheRead,
            session.tokensCacheWrite,
          ]) ?? 0,
        )
        const inputTokens = sumOrNull(sessions.map(session => session.tokensInput))
        const outputTokens = sumOrNull(sessions.map(session => session.tokensOutput))
        const cacheReadTokens = sumOrNull(sessions.map(session => session.tokensCacheRead))
        const cacheWriteTokens = sumOrNull(sessions.map(session => session.tokensCacheWrite))
        const lastActivityAt = sessions.reduce<string | null>((latest, session) => {
          const value = new Date(session.timeUpdated).toISOString()
          return latest == null || value > latest ? value : latest
        }, null)

        const sessionUsage: SessionUsageAggregate = {
          periodStart: new Date(since).toISOString(),
          periodEnd: new Date(now).toISOString(),
          totalSessions,
          startedSessions: asNullableCount(sum(sessionsByDay.map(day => day.startedSessions))),
          completedSessions: asNullableCount(sum(sessionsByDay.map(day => day.completedSessions))),
          erroredSessions: asNullableCount(sum(sessionsByDay.map(day => day.erroredSessions))),
          stuckSessions: null,
          lastActivityAt,
          messages,
          activeDays: activeDays > 0 ? activeDays : null,
          totalCost,
          averageCostPerDay: activeDays > 0 && totalCost != null ? totalCost / activeDays : null,
          averageTokensPerSession: totalSessions > 0 ? sum(tokenTotals) / totalSessions : null,
          medianTokensPerSession: median(tokenTotals),
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          uniqueTools: toolUsageData.map(t => t.toolName),
          toolUsage: toolUsageData.map(t => ({
            toolName: t.toolName,
            count: t.count,
            percentage: totalToolCalls > 0 ? Math.round((t.count / totalToolCalls) * 10000) / 100 : null,
          })),
          modelUsage,
          topActions: toolUsageData.map(t => ({
            action: t.toolName,
            count: t.count,
          })),
          errorCount: 0,
        }

        return { sessions: [], sessionUsage, gap: null, errors: [] }
      } catch (err) {
        const gap = `opencode stats DB unavailable${config.dbPath ? ` (${config.dbPath})` : ''}: ${err instanceof Error ? err.message : String(err)}. Install opencode and run 'opencode stats' to populate session metrics.`
        return {
          sessions: [],
          sessionUsage: null,
          gap,
          errors: [],
        }
      }
    },
  }
}

export type SessionCollector = ReturnType<typeof createSessionCollector>
