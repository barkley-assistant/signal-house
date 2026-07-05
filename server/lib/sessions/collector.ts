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
        const totalCost = sum(sessionsByDay.map(day => day.cost))
        const activeDays = sessionsByDay.length
        const messages = sum(modelUsage.map(model => model.messages))
        const tokenTotals = sessions.map(session =>
          session.tokensInput + session.tokensOutput + session.tokensReasoning + session.tokensCacheRead + session.tokensCacheWrite,
        )
        const inputTokens = sum(sessions.map(session => session.tokensInput))
        const outputTokens = sum(sessions.map(session => session.tokensOutput))
        const cacheReadTokens = sum(sessions.map(session => session.tokensCacheRead))
        const cacheWriteTokens = sum(sessions.map(session => session.tokensCacheWrite))
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
          averageCostPerDay: activeDays > 0 ? totalCost / activeDays : null,
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
