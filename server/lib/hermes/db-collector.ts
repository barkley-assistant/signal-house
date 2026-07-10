import Database from 'better-sqlite3'
import os from 'node:os'
import path from 'node:path'
import { getHermesConfig } from '../runtime-config'

export interface HermesDbConfig {
  dbPath?: string
}

export interface DailyAggregation {
  day: string
  sessions: number
  startedSessions: number
  completedSessions: number
  erroredSessions: number
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
}

export interface ModelBreakdownEntry {
  modelName: string
  sessions: number
  messages: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
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
  started_at: string | null
  ended_at: string | null
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

function resolveCost(row: SessionSchemaRow): number {
  if (row.actual_cost_usd != null) return toNumber(row.actual_cost_usd)
  if (row.estimated_cost_usd != null) return toNumber(row.estimated_cost_usd)
  return 0
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
    const sinceIso = since.toISOString()

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
    `).all(sinceIso) as SessionSchemaRow[]

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
    const day = startedAt ? new Date(startedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)

    const current = grouped.get(day) ?? {
      day,
      sessions: 0,
      startedSessions: 0,
      completedSessions: 0,
      erroredSessions: 0,
      cost: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensReasoning: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
    }

    current.sessions += 1
    current.startedSessions += 1
    if (isCompleted(row)) current.completedSessions += 1
    if (isErrored(row)) current.erroredSessions += 1
    current.cost += resolveCost(row)
    current.tokensInput += toNumber(row.input_tokens)
    current.tokensOutput += toNumber(row.output_tokens)
    current.tokensReasoning += toNumber(row.reasoning_tokens)
    current.tokensCacheRead += toNumber(row.cache_read_tokens)
    current.tokensCacheWrite += toNumber(row.cache_write_tokens)

    grouped.set(day, current)
  }

  return [...grouped.values()].sort((a, b) => b.day.localeCompare(a.day))
}

export function queryModelBreakdown(since: string, until?: string, config?: HermesDbConfig): ModelBreakdownEntry[] {
  const db = connectHermesDb(config)
  if (!db) return []

  try {
    const clauses = ['started_at >= ?']
    const params: Array<string> = [since]
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
      const modelName = normalizeModelName(row.model) ?? '(unknown)'
      const current = grouped.get(modelName) ?? {
        modelName,
        sessions: 0,
        messages: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
      }

      current.sessions += 1
      current.messages += toNumber(row.message_count)
      current.inputTokens += toNumber(row.input_tokens)
      current.outputTokens += toNumber(row.output_tokens)
      current.reasoningTokens += toNumber(row.reasoning_tokens)
      current.cacheReadTokens += toNumber(row.cache_read_tokens)
      current.cacheWriteTokens += toNumber(row.cache_write_tokens)
      current.cost += resolveCost(row)

      grouped.set(modelName, current)
    }

    return [...grouped.values()].sort((a, b) => b.sessions - a.sessions || a.modelName.localeCompare(b.modelName))
  } catch {
    return []
  } finally {
    db.close()
  }
}
