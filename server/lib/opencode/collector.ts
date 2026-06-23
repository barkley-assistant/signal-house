import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export interface TokenUsageCollectorResult {
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
    cacheReadTokens: number | null
    cacheWriteTokens: number | null
    cost: number | null
  }>
  rawJson: string | null
  collectedAt: string
  errors: string[]
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

function parseNumber(value: string | undefined): number | null { if (!value) return null; const normalized = value.replace(/[$,]/g,'').trim(); const m = normalized.match(/^(-?\d+(?:\.\d+)?)([KMB])$/i); if (m) { const base = Number(m[1]); if (!Number.isFinite(base)) return null; const s = m[2]!.toUpperCase(); return base * (s==='K'?1_000:s==='M'?1_000_000:1_000_000_000)} const p=Number(normalized); return Number.isFinite(p)?p:null }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function extractOverviewValue(lines: string[], label: string): number | null { const pattern = new RegExp(`│\\s*${escapeRegExp(label)}\\s+([^│]+?)\\s*│`, 'i'); for (const line of lines) { const match = line.match(pattern); if (!match) continue; const valueMatch = match[1]?.match(/-?\$?[\d,]+(?:\.\d+)?(?:[KMB])?/i); return parseNumber(valueMatch?.[0]); } return null }
function isLikelyModelName(name: string): boolean { return /^(?:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/i.test(name) }

export function parseTokenUsage(stdout: string) {
  const lines = stdout.split('\n')
  const totalSessions = extractOverviewValue(lines, 'Sessions') ?? 0
  const totalMessages = extractOverviewValue(lines, 'Messages') ?? 0
  const inputTokens = extractOverviewValue(lines, 'Input') ?? extractOverviewValue(lines, 'Input Tokens') ?? 0
  const outputTokens = extractOverviewValue(lines, 'Output') ?? extractOverviewValue(lines, 'Output Tokens') ?? 0
  const totalCost = extractOverviewValue(lines, 'Total Cost')
  const modelUsage: TokenUsageCollectorResult['modelUsage'] = []
  for (let i=0;i<lines.length;i+=1) {
    const row = lines[i]!
    const modelMatch = row.match(/│\s+(.+?)\s+│\s*$/)
    if (!modelMatch) continue
    const modelName = modelMatch[1]!.trim()
    if (!isLikelyModelName(modelName)) continue
    const block = lines.slice(i+1, i+7).join('\n')
    const messagesMatch = block.match(/Messages\s+([\d,]+)/)
    if (!messagesMatch) continue
    modelUsage.push({
      modelName,
      messages: parseInt(messagesMatch[1]!.replace(/,/g,''),10),
      inputTokens: parseNumber((block.match(/Input Tokens\s+([^\n│]+)/)?.[1] ?? block.match(/Input\s+([^\n│]+)/)?.[1])?.trim()),
      outputTokens: parseNumber((block.match(/Output Tokens\s+([^\n│]+)/)?.[1] ?? block.match(/Output\s+([^\n│]+)/)?.[1])?.trim()),
      cacheReadTokens: parseNumber((block.match(/Cache Read\s+([^\n│]+)/)?.[1])?.trim()),
      cacheWriteTokens: parseNumber((block.match(/Cache Write\s+([^\n│]+)/)?.[1])?.trim()),
      cost: parseNumber((block.match(/Cost\s+([^\n│]+)/)?.[1])?.trim()),
    })
  }
  return { totalSessions, totalMessages, totalTokens: inputTokens + outputTokens, totalCost, modelUsage, rawJson: stdout }
}

export function collectTokenUsageSnapshot(): TokenUsageCollectorResult {
  const collectedAt = new Date().toISOString()
  const periodEnd = collectedAt
  const periodStart = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
  const errors: string[] = []
  const candidates: string[] = []
  if (process.env.OPENCODE_BIN) candidates.push(process.env.OPENCODE_BIN)
  candidates.push('opencode')
  candidates.push(path.join(os.homedir(), '.opencode/bin/opencode'))
  candidates.push('/home/openclaw/.opencode/bin/opencode')
  if (process.env.OPENCODE_COMMAND) candidates.push(process.env.OPENCODE_COMMAND)
  for (const cmd of candidates) {
    try {
      const stdout = execFileSync(cmd, ['stats', '--days', '28', '--models'], { timeout: 15000, encoding: 'utf-8', stdio: ['pipe','pipe','ignore'] })
      const parsed = parseTokenUsage(stdout)
      return { periodStart, periodEnd, source: 'opencode', toolName: 'opencode', ...parsed, collectedAt, errors: [] }
    } catch (err) {
      if (isCommandNotFound(err)) continue
      errors.push(`OpenCode stats collector failed: ${err instanceof Error ? err.message : String(err)}`)
      return { periodStart, periodEnd, source: 'opencode', toolName: 'opencode', totalSessions: 0, totalMessages: 0, totalTokens: 0, totalCost: null, modelUsage: [], rawJson: null, collectedAt, errors }
    }
  }
  errors.push('OpenCode binary not found: no opencode binary available')
  return { periodStart, periodEnd, source: 'opencode', toolName: 'opencode', totalSessions: 0, totalMessages: 0, totalTokens: 0, totalCost: null, modelUsage: [], rawJson: null, collectedAt, errors }
}
