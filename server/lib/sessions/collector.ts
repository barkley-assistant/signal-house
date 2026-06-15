import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { SessionUsageAggregate } from '../../../types/aggregates'
import type { SessionCollectorConfig, SessionCollectorResult } from './types'

function isCommandNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT' || e.code === 'EACCES') return true
    const msg = e.message
    if (msg.includes('ENOENT') || msg.includes('EACCES') || msg.includes('not found') || msg.includes('127')) return true
  }
  return false
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const normalized = value.replace(/[$,]/g, '').trim()
  const compactMatch = normalized.match(/^(-?\d+(?:\.\d+)?)([KMB])$/i)
  if (compactMatch) {
    const base = Number(compactMatch[1])
    if (!Number.isFinite(base)) return null
    const suffix = compactMatch[2]!.toUpperCase()
    const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : 1_000_000_000
    return base * multiplier
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractOverviewValue(lines: string[], label: string): number | null {
  const pattern = new RegExp(`│\\s*${escapeRegExp(label)}\\s+([^│]+?)\\s*│`, 'i')
  for (const line of lines) {
    const match = line.match(pattern)
    if (!match) continue
    const valueMatch = match[1]?.match(/-?\$?[\d,]+(?:\.\d+)?(?:[KMB])?/i)
    return parseNumber(valueMatch?.[0])
  }
  return null
}

function extractOverviewValueFromLabels(lines: string[], labels: string[]): number | null {
  for (const label of labels) {
    const value = extractOverviewValue(lines, label)
    if (value != null) return value
  }
  return null
}

function parseToolPercentage(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/([\d.]+)\s*%/)
  return match ? parseNumber(match[1]) : null
}

export function createSessionCollector(config: SessionCollectorConfig = {}) {
  const periodDays = config.periodDays ?? 30

  return {
    async collect(): Promise<SessionCollectorResult> {
      const candidates: string[] = []

      if (config.opencodeBin) candidates.push(config.opencodeBin)
      if (process.env.OPENCODE_BIN) candidates.push(process.env.OPENCODE_BIN)
      candidates.push('opencode')
      candidates.push(path.join(os.homedir(), '.opencode/bin/opencode'))
      candidates.push('/home/openclaw/.opencode/bin/opencode')
      if (config.opencodeCommand) candidates.push(config.opencodeCommand)
      if (process.env.OPENCODE_COMMAND) candidates.push(process.env.OPENCODE_COMMAND)

      for (const cmd of candidates) {
        try {
          const stdout = execFileSync(cmd, ['stats', '--days', String(periodDays)], {
            timeout: 15_000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          })

          const lines = stdout.split('\n')

          const foundOverview = lines.some(line => line.includes('OVERVIEW'))
          const totalSessions = extractOverviewValue(lines, 'Sessions') ?? 0
          const messages = extractOverviewValue(lines, 'Messages')
          const activeDays = extractOverviewValue(lines, 'Days')
          const totalCost = extractOverviewValue(lines, 'Total Cost')
          const averageCostPerDay = extractOverviewValueFromLabels(lines, ['Average Cost / Day', 'Avg Cost/Day'])
          const averageTokensPerSession = extractOverviewValueFromLabels(lines, ['Average Tokens / Session', 'Avg Tokens/Session'])
          const medianTokensPerSession = extractOverviewValueFromLabels(lines, ['Median Tokens / Session'])
          const inputTokens = extractOverviewValueFromLabels(lines, ['Input Tokens', 'Input'])
          const outputTokens = extractOverviewValueFromLabels(lines, ['Output Tokens', 'Output'])
          const cacheReadTokens = extractOverviewValueFromLabels(lines, ['Cache Read'])
          const cacheWriteTokens = extractOverviewValueFromLabels(lines, ['Cache Write'])

          const tools: Array<{ toolName: string; count: number; percentage: number | null }> = []
          let inToolSection = false
          for (const line of lines) {
            if (line.includes('TOOL USAGE')) { inToolSection = true; continue }
            if (!inToolSection) continue
            if (line.includes('└')) break

            const toolMatch = line.match(/│\s+(.+?)\s+.*?(\d+)\s+\(([\d.]+%)\)\s*│?/)
            if (toolMatch) {
              tools.push({
                toolName: toolMatch[1]!.trim(),
                count: parseInt(toolMatch[2]!, 10),
                percentage: parseToolPercentage(toolMatch[3]),
              })
            }
          }

          if (!foundOverview) {
            const gap = `opencode stats CLI unavailable: Could not parse CLI output. Install opencode and run 'opencode stats' to populate session metrics.`
            return { sessions: [], sessionUsage: null, gap, errors: [] }
          }

          const periodEnd = new Date().toISOString()
          const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()

          const topActions = tools
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
            .map(({ toolName, count }) => ({ action: toolName, count }))

          const sessionUsage: SessionUsageAggregate = {
            periodStart,
            periodEnd,
            totalSessions,
            messages,
            activeDays,
            totalCost,
            averageCostPerDay,
            averageTokensPerSession,
            medianTokensPerSession,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            uniqueTools: tools.map(t => t.toolName),
            toolUsage: tools,
            topActions,
            errorCount: 0,
          }

          return { sessions: [], sessionUsage, gap: null, errors: [] }
        } catch (err) {
          if (isCommandNotFound(err)) continue

          const hint = cmd ? ` (resolved: ${cmd})` : ''
          const gap = `opencode stats CLI unavailable${hint}: ${err instanceof Error ? err.message : String(err)}. Install opencode and run 'opencode stats' to populate session metrics.`
          return {
            sessions: [],
            sessionUsage: null,
            gap,
            errors: [],
          }
        }
      }

      const gap = `opencode stats CLI unavailable: no opencode binary available. Install opencode and run 'opencode stats' to populate session metrics.`
      return { sessions: [], sessionUsage: null, gap, errors: [] }
    },
  }
}

export type SessionCollector = ReturnType<typeof createSessionCollector>
