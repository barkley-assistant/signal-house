import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { SessionUsageAggregate } from '../../../types/aggregates'
import { getSessionPeriodDays } from '../runtime-config'
import type { SessionCollectorConfig, SessionCollectorResult } from './types'

type SessionExport = {
  info?: {
    id?: string
    time?: {
      created?: number
      updated?: number
    }
    summary?: unknown
  }
  messages?: Array<{
    info?: {
      role?: string
      finish?: string
      time?: {
        created?: number
        completed?: number
      }
    }
    parts?: Array<{
      type?: string
      state?: {
        status?: string
      }
    }>
  }>
}

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

function parseSectionRows(lines: string[], heading: string): string[] {
  const rows: string[] = []
  let inSection = false
  for (const line of lines) {
    if (line.includes(heading)) {
      inSection = true
      continue
    }
    if (!inSection) continue
    if (line.includes('└')) break
    rows.push(line)
  }
  return rows
}

function parseSessionList(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('ses_'))
    .map(line => line.split(/\s+/)[0]!)
}

function parseSessionExport(output: string): SessionExport | null {
  const start = output.indexOf('{')
  if (start < 0) return null
  try {
    return JSON.parse(output.slice(start))
  } catch {
    return null
  }
}

function analyzeSessionExport(data: SessionExport): {
  startedAt: string | null
  lastActivityAt: string | null
  completedAt: string | null
  status: 'completed' | 'errored' | 'stuck' | 'running' | 'unknown'
} {
  const startedAt = data.info?.time?.created ? new Date(data.info.time.created).toISOString() : null
  const lastActivityAt = data.info?.time?.updated ? new Date(data.info.time.updated).toISOString() : null
  const lastMessage = [...(data.messages ?? [])].reverse().find(message => message.info?.role === 'assistant' || message.info?.role === 'tool')
  const completedAt = lastMessage?.info?.time?.completed ? new Date(lastMessage.info.time.completed).toISOString() : null
  const hasError = (data.messages ?? []).some(message =>
    (message.parts ?? []).some(part => part.state?.status === 'error'),
  )
  const hasToolCallFinish = lastMessage?.info?.role === 'assistant' && lastMessage.info.finish === 'tool-calls'

  if (hasError) {
    return { startedAt, lastActivityAt, completedAt, status: 'errored' }
  }
  if (hasToolCallFinish) {
    return { startedAt, lastActivityAt, completedAt: null, status: 'stuck' }
  }
  if (completedAt != null) {
    return { startedAt, lastActivityAt, completedAt, status: 'completed' }
  }
  if (lastActivityAt != null) {
    return { startedAt, lastActivityAt, completedAt: null, status: 'running' }
  }
  return { startedAt, lastActivityAt: null, completedAt: null, status: 'unknown' }
}

export function createSessionCollector(config: SessionCollectorConfig = {}) {
  const periodDays = config.periodDays ?? getSessionPeriodDays()

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
          const sessionListOutput = execFileSync(cmd, ['session', 'list'], {
            timeout: 15_000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          })
          const sessionIds = parseSessionList(sessionListOutput)

          const recentSessions = sessionIds.slice(0, 5)
          let startedSessions = 0
          let completedSessions = 0
          let erroredSessions = 0
          let stuckSessions = 0
          let lastActivityAt: string | null = null

          for (const sessionId of recentSessions) {
            try {
              const exported = execFileSync(cmd, ['export', sessionId, '--sanitize'], {
                timeout: 15_000,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'ignore'],
              })
              const parsed = parseSessionExport(exported)
              if (!parsed) continue
              const analysis = analyzeSessionExport(parsed)
              if (analysis.startedAt) startedSessions += 1
              if (analysis.completedAt) completedSessions += 1
              if (analysis.status === 'errored') erroredSessions += 1
              if (analysis.status === 'stuck') stuckSessions += 1
              if (analysis.lastActivityAt && (!lastActivityAt || analysis.lastActivityAt > lastActivityAt)) {
                lastActivityAt = analysis.lastActivityAt
              }
            } catch {
              // If a single session cannot be exported, keep the aggregate signal from the rest.
            }
          }

          const stdout = execFileSync(cmd, ['stats', '--days', String(periodDays), '--models'], {
            timeout: 15_000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore'],
          })

          if (stdout.length > 250_000) {
            throw new Error(`opencode stats output too large (${stdout.length} bytes)`)
          }

          const lines = stdout.split('\n')

          const foundOverview = lines.some(line => line.includes('OVERVIEW'))
          const foundToolUsage = lines.some(line => line.includes('TOOL USAGE'))
          const foundModelUsage = lines.some(line => line.includes('MODEL USAGE'))
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
          for (const line of parseSectionRows(lines, 'TOOL USAGE')) {
            const toolMatch = line.match(/│\s+(.+?)\s+.*?(\d+)\s+\(([\d.]+%)\)\s*│?/)
            if (toolMatch) {
              tools.push({
                toolName: toolMatch[1]!.trim(),
                count: parseInt(toolMatch[2]!, 10),
                percentage: parseToolPercentage(toolMatch[3]),
              })
            }
          }

          const modelUsage: Array<{
            modelName: string
            messages: number
            inputTokens: number | null
            outputTokens: number | null
            cacheReadTokens: number | null
            cacheWriteTokens: number | null
            cost: number | null
          }> = []
          if (foundModelUsage) {
            const modelRows = parseSectionRows(lines, 'MODEL USAGE')
            for (let i = 0; i < modelRows.length; i += 1) {
              const row = modelRows[i]!
              const modelMatch = row.match(/│\s+(.+?)\s+│\s*$/)
              if (!modelMatch) continue
              const modelName = modelMatch[1]!.trim()
              if (!modelName || modelName === 'Messages') continue
              const block = modelRows.slice(i + 1, i + 7).join('\n')
              const messagesMatch = block.match(/Messages\s+([\d,]+)/)
              if (!messagesMatch) continue
              modelUsage.push({
                modelName,
                messages: parseInt(messagesMatch[1]!.replace(/,/g, ''), 10),
                inputTokens: parseNumber((block.match(/Input Tokens\s+([^\n│]+)/)?.[1] ?? block.match(/Input\s+([^\n│]+)/)?.[1])?.trim()),
                outputTokens: parseNumber((block.match(/Output Tokens\s+([^\n│]+)/)?.[1] ?? block.match(/Output\s+([^\n│]+)/)?.[1])?.trim()),
                cacheReadTokens: parseNumber((block.match(/Cache Read\s+([^\n│]+)/)?.[1])?.trim()),
                cacheWriteTokens: parseNumber((block.match(/Cache Write\s+([^\n│]+)/)?.[1])?.trim()),
                cost: parseNumber((block.match(/Cost\s+([^\n│]+)/)?.[1])?.trim()),
              })
            }
          }

          if (!foundOverview || !foundToolUsage) {
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
            startedSessions: startedSessions > 0 ? startedSessions : null,
            completedSessions: completedSessions > 0 ? completedSessions : null,
            erroredSessions: erroredSessions > 0 ? erroredSessions : null,
            stuckSessions: stuckSessions > 0 ? stuckSessions : null,
            lastActivityAt,
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
            modelUsage,
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
