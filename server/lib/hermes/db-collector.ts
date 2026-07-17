import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { getHermesConfig } from '../runtime-config'
import { normalizeModelName as sharedNormalizeModelName } from '../../../utils/string-normalize'
import { sumOrNull } from '../../../utils/null-math'

export interface HermesDbConfig {
  dbPath?: string
}

export interface DailyAggregation {
  day: string
  sessions: number
  startedSessions: number
  completedSessions: number
  erroredSessions: number
  cost: number | null
  tokensInput: number | null
  tokensOutput: number | null
  tokensReasoning: number | null
  tokensCacheRead: number | null
  tokensCacheWrite: number | null
}

export interface ModelBreakdownEntry {
  modelName: string
  provider?: string | null
  sessions: number
  messages: number
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  cost: number | null
}

type SessionSchemaRow = {
  id: string
  source: string | null
  model: unknown
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  reasoning_tokens: number | null
  estimated_cost_usd: number | null
  actual_cost_usd: number | null
  message_count: number | null
  tool_call_count: number | null
  api_call_count: number | null
  started_at: number | null
  ended_at: number | null
  parent_session_id: string | null
}

const schemaInfoCache = new WeakMap<Database.Database, boolean>()

function defaultDbPath(): string {
  return getHermesConfig().dbPath
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Resolve the cost column for a Hermes session row. Prefers the
 * actual cost over the estimated one; returns `null` when both are
 * missing/unmeasurable, preserving the "unknown vs measured"
 * contract (issue #343). Distinct from a measured `0` cost.
 */
function resolveCost(row: SessionSchemaRow): number | null {
  if (row.actual_cost_usd != null) return toNumberOrNull(row.actual_cost_usd)
  if (row.estimated_cost_usd != null) return toNumberOrNull(row.estimated_cost_usd)
  return null
}

function normalizeModelName(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.id === 'string' && parsed.id.trim()) return parsed.id.trim()
      if (typeof parsed.modelID === 'string' && parsed.modelID.trim()) return parsed.modelID.trim()
      if (typeof parsed.model_id === 'string' && parsed.model_id.trim()) return parsed.model_id.trim()
      if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim()
      if (typeof parsed.providerID === 'string' && parsed.providerID.trim()) return parsed.providerID.trim()
    } catch {
      // Plain string model ids are also valid.
    }

    return trimmed
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.id === 'string' && record.id.trim()) return record.id.trim()
    if (typeof record.modelID === 'string' && record.modelID.trim()) return record.modelID.trim()
    if (typeof record.model_id === 'string' && record.model_id.trim()) return record.model_id.trim()
    if (typeof record.name === 'string' && record.name.trim()) return record.name.trim()
    if (typeof record.providerID === 'string' && record.providerID.trim()) return record.providerID.trim()
  }

  return null
}

function isErrored(_row: SessionSchemaRow): boolean {
  return false
}

// started_at and ended_at are numeric epoch seconds; numeric > comparison is correct.
function isCompleted(row: SessionSchemaRow): boolean {
  if (row.started_at != null && row.ended_at != null) return row.ended_at > row.started_at
  return false
}

function getSchemaInfo(db: Database.Database): boolean {
  const cached = schemaInfoCache.get(db)
  if (cached !== undefined) return cached

  const tableRows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>
  const hasSessions = tableRows.some(r => r.name === 'sessions')
  schemaInfoCache.set(db, hasSessions)
  return hasSessions
}

export function connectHermesDb(config: HermesDbConfig = {}): Database.Database | null {
  const dbPath = config.dbPath ?? defaultDbPath()

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    db.pragma('query_only = ON')

    if (!getSchemaInfo(db)) {
      db.close()
      return null
    }

    return db
  } catch {
    return null
  }
}

function readSessionRows(days: number, config?: HermesDbConfig): SessionSchemaRow[] {
  const db = connectHermesDb(config)
  if (!db) return []

  try {
    const since = new Date()
    since.setDate(since.getDate() - Math.max(0, days))
    const sinceEpoch = since.getTime() / 1000

    const rows = db.prepare(`
      SELECT
        id,
        source,
        model,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        reasoning_tokens,
        estimated_cost_usd,
        actual_cost_usd,
        message_count,
        tool_call_count,
        api_call_count,
        started_at,
        ended_at,
        parent_session_id
      FROM sessions
      WHERE started_at >= ?
      ORDER BY started_at DESC, id DESC
    `).all(sinceEpoch) as SessionSchemaRow[]

    return rows
  } catch {
    return []
  } finally {
    db.close()
  }
}

export function querySessionsByDay(days: number, config?: HermesDbConfig): DailyAggregation[] {
  const rows = readSessionRows(days, config)

  const grouped = new Map<string, DailyAggregation>()
  for (const row of rows) {
    const startedAt = row.started_at
    // started_at is REAL epoch seconds; multiply by 1000 for Date constructor (expects ms)
    const day = startedAt ? new Date(Number(startedAt) * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)

    const current = grouped.get(day) ?? {
      day,
      sessions: 0,
      startedSessions: 0,
      completedSessions: 0,
      erroredSessions: 0,
      cost: null,
      tokensInput: null,
      tokensOutput: null,
      tokensReasoning: null,
      tokensCacheRead: null,
      tokensCacheWrite: null,
    }

    current.sessions += 1
    current.startedSessions += 1
    if (isCompleted(row)) current.completedSessions += 1
    if (isErrored(row)) current.erroredSessions += 1
    current.cost = sumOrNull([current.cost, resolveCost(row)])
    current.tokensInput = sumOrNull([current.tokensInput, toNumberOrNull(row.input_tokens)])
    current.tokensOutput = sumOrNull([current.tokensOutput, toNumberOrNull(row.output_tokens)])
    current.tokensReasoning = sumOrNull([current.tokensReasoning, toNumberOrNull(row.reasoning_tokens)])
    current.tokensCacheRead = sumOrNull([current.tokensCacheRead, toNumberOrNull(row.cache_read_tokens)])
    current.tokensCacheWrite = sumOrNull([current.tokensCacheWrite, toNumberOrNull(row.cache_write_tokens)])

    grouped.set(day, current)
  }

  return [...grouped.values()].sort((a, b) => b.day.localeCompare(a.day))
}

export function queryModelBreakdown(since: number, until?: number, config?: HermesDbConfig): ModelBreakdownEntry[] {
  const db = connectHermesDb(config)
  if (!db) return []

  try {
    const clauses = ['started_at >= ?']
    const params: Array<number> = [since]
    if (until != null) {
      clauses.push('started_at < ?')
      params.push(until)
    }

    const rows = db.prepare(`
      SELECT
        id, source, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens,
        estimated_cost_usd, actual_cost_usd, message_count,
        tool_call_count, api_call_count, started_at, ended_at, parent_session_id
      FROM sessions
      WHERE ${clauses.join(' AND ')}
      ORDER BY started_at DESC, id DESC
    `).all(...params) as SessionSchemaRow[]

    const grouped = new Map<string, ModelBreakdownEntry>()

    for (const row of rows) {
      const rawName = normalizeModelName(row.model) ?? '(unknown)'
      const { slug: modelName, provider } = sharedNormalizeModelName(rawName)
      const current = grouped.get(modelName) ?? {
        modelName,
        provider,
        sessions: 0,
        messages: 0,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: null,
      }

      // Keep first non-null provider
      if (current.provider == null && provider != null) {
        current.provider = provider
      }

      current.sessions += 1
      current.messages += toNumber(row.message_count)
      current.inputTokens = sumOrNull([current.inputTokens, toNumberOrNull(row.input_tokens)])
      current.outputTokens = sumOrNull([current.outputTokens, toNumberOrNull(row.output_tokens)])
      current.reasoningTokens = sumOrNull([current.reasoningTokens, toNumberOrNull(row.reasoning_tokens)])
      current.cacheReadTokens = sumOrNull([current.cacheReadTokens, toNumberOrNull(row.cache_read_tokens)])
      current.cacheWriteTokens = sumOrNull([current.cacheWriteTokens, toNumberOrNull(row.cache_write_tokens)])
      current.cost = sumOrNull([current.cost, resolveCost(row)])

      grouped.set(modelName, current)
    }

    return [...grouped.values()].sort((a, b) => b.sessions - a.sessions || a.modelName.localeCompare(b.modelName))
  } catch {
    return []
  } finally {
    db.close()
  }
}
