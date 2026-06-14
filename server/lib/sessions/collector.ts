import { execSync } from 'node:child_process'
import type { SessionMetric } from '../../../types/metrics'
import type { SessionUsageAggregate } from '../../../types/aggregates'
import type { SessionCollectorConfig, SessionCollectorResult } from './types'

export function createSessionCollector(config: SessionCollectorConfig = {}) {
  const periodDays = config.periodDays ?? 30

  function buildAggregate(
    sessions: SessionMetric[],
    periodStart: string,
    periodEnd: string,
  ): SessionUsageAggregate {
    const tools = [...new Set(sessions.map(s => s.toolName))]
    const actionCounts = new Map<string, number>()
    for (const s of sessions) {
      actionCounts.set(s.action, (actionCounts.get(s.action) || 0) + 1)
    }
    const topActions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }))

    return {
      periodStart,
      periodEnd,
      totalSessions: sessions.length,
      uniqueTools: tools,
      topActions,
      errorCount: sessions.filter(s => !s.success).length,
    }
  }

  return {
    async collect(): Promise<SessionCollectorResult> {
      const cmd = config.opencodeCommand ?? 'opencode'

      try {
        const stdout = execSync(`${cmd} stats --json 2>/dev/null`, {
          timeout: 15_000,
          encoding: 'utf-8',
          stdio: 'pipe',
        })

        const data = JSON.parse(stdout)
        const rawSessions: Array<Record<string, unknown>> = data.sessions ?? []
        const periods = data.period ?? {}

        const sessions: SessionMetric[] = rawSessions.map((s: Record<string, unknown>, i: number) => ({
          id: String(s.id ?? `session-${i}`),
          toolName: String(s.toolName ?? s.tool ?? 'opencode'),
          action: String(s.action ?? 'unknown'),
          timestamp: String(s.timestamp ?? new Date().toISOString()),
          durationMs: s.durationMs != null ? Number(s.durationMs) : null,
          metadata: (s.metadata as Record<string, unknown>) ?? {},
          success: s.success !== false,
        }))

        const periodEnd = periods.end ?? new Date().toISOString()
        const periodStart = periods.start ??
          new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()

        const aggregate = buildAggregate(sessions, periodStart, periodEnd)

        return { sessions, sessionUsage: aggregate, gap: null, errors: [] }
      } catch (err) {
        const gap = `opencode stats CLI unavailable: ${err instanceof Error ? err.message : String(err)}. Install opencode and run 'opencode stats' to populate session metrics.`
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
