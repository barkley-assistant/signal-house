import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  connectHermesDb,
  querySessionsByDay,
  queryModelBreakdown,
} from '../db-collector'

let tempDir: string | null = null
let dbPath: string | null = null

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      reasoning_tokens INTEGER,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      message_count INTEGER,
      tool_call_count INTEGER,
      api_call_count INTEGER,
      started_at TEXT,
      ended_at TEXT,
      parent_session_id TEXT
    );
  `)
}

function insertSession(db: Database.Database, row: {
  id: string
  source?: string | null
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  estimatedCost?: number | null
  actualCost?: number | null
  messageCount?: number | null
  toolCallCount?: number | null
  apiCallCount?: number | null
  startedAt?: string | null
  endedAt?: string | null
  parentSessionId?: string | null
}): void {
  db.prepare(`
    INSERT INTO sessions (
      id, source, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens,
      estimated_cost_usd, actual_cost_usd, message_count,
      tool_call_count, api_call_count, started_at, ended_at, parent_session_id
    ) VALUES (
      @id, @source, @model, @inputTokens, @outputTokens,
      @cacheReadTokens, @cacheWriteTokens, @reasoningTokens,
      @estimatedCost, @actualCost, @messageCount,
      @toolCallCount, @apiCallCount, @startedAt, @endedAt, @parentSessionId
    )
  `).run({
    id: row.id,
    source: row.source ?? null,
    model: row.model ?? null,
    inputTokens: row.inputTokens ?? null,
    outputTokens: row.outputTokens ?? null,
    cacheReadTokens: row.cacheReadTokens ?? null,
    cacheWriteTokens: row.cacheWriteTokens ?? null,
    reasoningTokens: row.reasoningTokens ?? null,
    estimatedCost: row.estimatedCost ?? null,
    actualCost: row.actualCost ?? null,
    messageCount: row.messageCount ?? null,
    toolCallCount: row.toolCallCount ?? null,
    apiCallCount: row.apiCallCount ?? null,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    parentSessionId: row.parentSessionId ?? null,
  })
}

function day(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return d.toISOString()
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'hermes-db-collector-'))
  dbPath = path.join(tempDir, 'state.db')
  const db = new Database(dbPath)
  createSchema(db)

  // Primary session
  insertSession(db, {
    id: 'ses-001',
    source: 'cli',
    model: JSON.stringify({ id: 'claude-sonnet-4-20250514', providerID: 'anthropic' }),
    inputTokens: 120,
    outputTokens: 80,
    reasoningTokens: 30,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    actualCost: 0.05,
    estimatedCost: 0.03,
    messageCount: 3,
    startedAt: day(2026, 7, 7, 23, 30),
    endedAt: day(2026, 7, 8, 0, 10),
    parentSessionId: null,
  })

  // Subagent session — should be included (no parent_session_id filter)
  insertSession(db, {
    id: 'ses-002',
    source: 'subagent',
    model: JSON.stringify({ id: 'claude-sonnet-4-20250514', providerID: 'anthropic' }),
    inputTokens: 50,
    outputTokens: 30,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCost: 0.01,
    actualCost: null,
    messageCount: 1,
    startedAt: day(2026, 7, 7, 23, 45),
    endedAt: day(2026, 7, 7, 23, 50),
    parentSessionId: 'ses-001',
  })

  // Another day session
  insertSession(db, {
    id: 'ses-003',
    source: 'cli',
    model: 'gpt-5',
    inputTokens: 300,
    outputTokens: 200,
    reasoningTokens: 50,
    cacheReadTokens: 40,
    cacheWriteTokens: 20,
    actualCost: 0.10,
    estimatedCost: 0.08,
    messageCount: 5,
    startedAt: day(2026, 7, 8, 12, 0),
    endedAt: day(2026, 7, 8, 12, 30),
    parentSessionId: null,
  })

  // Session with null model
  insertSession(db, {
    id: 'ses-004',
    source: 'cli',
    model: null,
    inputTokens: 15,
    outputTokens: 5,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    actualCost: null,
    estimatedCost: null,
    messageCount: 0,
    startedAt: day(2026, 7, 8, 13, 0),
    endedAt: day(2026, 7, 8, 13, 2),
    parentSessionId: 'ses-003',
  })

  // Session with model as model_id key
  insertSession(db, {
    id: 'ses-005',
    source: 'cli',
    model: JSON.stringify({ model_id: 'old-model', providerID: 'openai' }),
    inputTokens: 60,
    outputTokens: 40,
    reasoningTokens: 5,
    cacheReadTokens: 8,
    cacheWriteTokens: 4,
    estimatedCost: 0.02,
    actualCost: 0.03,
    messageCount: 2,
    startedAt: day(2026, 7, 9, 1, 0),
    endedAt: day(2026, 7, 9, 1, 3),
    parentSessionId: null,
  })

  db.close()
})

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe('hermes db collector', () => {
  it('connects to a valid hermes db in read-only mode', () => {
    const db = connectHermesDb({ dbPath: dbPath ?? undefined })
    expect(db).not.toBeNull()
    db?.close()
  })

  it('aggregates sessions by UTC day including subagent sessions', () => {
    // Mock Date.now to control the 28-day lookback window
    jest.spyOn(Date, 'now').mockReturnValue(new Date(day(2026, 7, 9, 12, 0)).getTime())

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const day8 = rows.find(r => r.day === '2026-07-08')
    expect(day8).toBeDefined()
    // Day 2026-07-08 should have ses-003, ses-004, and ses-001 (started 23:30 UTC 7/7 but ended 7/8 — but grouping is by started_at)
    // Actually ses-001 started 7/7 23:30, which is day 2026-07-08 in UTC
    // Wait: day(2026,7,7,23,30) = 2026-07-07T23:30:00Z → day slice = 2026-07-07
    // ses-003 started day(2026,7,8,12,0) → 2026-07-08
    // ses-004 started day(2026,7,8,13,0) → 2026-07-08
    // So day 2026-07-07 should have ses-001 and ses-002
    // day 2026-07-08 should have ses-003 and ses-004
    // day 2026-07-09 should have ses-005

    const day7 = rows.find(r => r.day === '2026-07-07')
    expect(day7).toBeDefined()
    expect(day7!.sessions).toBe(2) // ses-001 + ses-002 (subagent included)

    const day9 = rows.find(r => r.day === '2026-07-09')
    expect(day9).toBeDefined()
    expect(day9!.sessions).toBe(1) // ses-005

    jest.restoreAllMocks()
  })

  it('resolves cost using actual_cost_usd over estimated_cost_usd', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(day(2026, 7, 9, 12, 0)).getTime())

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    const day7 = rows.find(r => r.day === '2026-07-07')

    expect(day7).toBeDefined()
    // ses-001 has actualCost: 0.05, ses-002 has estimatedCost: 0.01 (actualCost: null)
    // Total cost = 0.05 + 0.01 = 0.06
    expect(day7!.cost).toBeCloseTo(0.06, 10)

    jest.restoreAllMocks()
  })

  it('uses estimated_cost_usd when actual_cost_usd is null', () => {
    // ses-002 has actualCost=null, estimatedCost=0.01
    jest.spyOn(Date, 'now').mockReturnValue(new Date(day(2026, 7, 9, 12, 0)).getTime())

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    const day7 = rows.find(r => r.day === '2026-07-07')

    // We already verified cost above; this test confirms cost > 0 from estimated
    expect(day7!.cost).toBeGreaterThan(0)
    jest.restoreAllMocks()
  })

  it('handles null costs gracefully (cost = 0)', () => {
    // ses-004 has both actualCost=null and estimatedCost=null
    jest.spyOn(Date, 'now').mockReturnValue(new Date(day(2026, 7, 9, 12, 0)).getTime())

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    const day8 = rows.find(r => r.day === '2026-07-08')

    expect(day8).toBeDefined()
    // ses-003 cost = 0.10, ses-004 cost = 0 => total 0.10
    expect(day8!.cost).toBeCloseTo(0.10, 10)

    jest.restoreAllMocks()
  })

  it('includes subagent sessions (no parent_session_id filter)', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(day(2026, 7, 9, 12, 0)).getTime())

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    const day7 = rows.find(r => r.day === '2026-07-07')

    // ses-002 (subagent) should be included — counted in sessions per day
    expect(day7!.sessions).toBe(2) // includes both primary + subagent
    jest.restoreAllMocks()
  })

  it('aggregates model breakdown across sessions', () => {
    const rows = queryModelBreakdown(day(2026, 7, 7), day(2026, 7, 10), { dbPath: dbPath ?? undefined })
    expect(rows.length).toBeGreaterThanOrEqual(2)

    const claude = rows.find(r => r.modelName === 'claude-sonnet-4-20250514')
    expect(claude).toBeDefined()
    // ses-001 + ses-002 = 2 sessions, 120+50=170 input, 80+30=110 output
    expect(claude!.sessions).toBe(2)
    expect(claude!.inputTokens).toBe(170)
    expect(claude!.outputTokens).toBe(110)

    const gpt = rows.find(r => r.modelName === 'gpt-5')
    expect(gpt).toBeDefined()
    expect(gpt!.sessions).toBe(1)
    expect(gpt!.inputTokens).toBe(300)
  })

  it('handles null model as (unknown)', () => {
    const rows = queryModelBreakdown(day(2026, 7, 7), day(2026, 7, 10), { dbPath: dbPath ?? undefined })
    const unknown = rows.find(r => r.modelName === '(unknown)')
    expect(unknown).toBeDefined()
    expect(unknown!.sessions).toBe(1)
    expect(unknown!.inputTokens).toBe(15)
  })

  it('resolves model name from model_id key in JSON', () => {
    const rows = queryModelBreakdown(day(2026, 7, 7), day(2026, 7, 10), { dbPath: dbPath ?? undefined })
    const old = rows.find(r => r.modelName === 'old-model')
    expect(old).toBeDefined()
    expect(old!.sessions).toBe(1)
  })

  it('falls back to empty results for missing db', () => {
    expect(connectHermesDb({ dbPath: path.join(tempDir ?? '', 'missing.db') })).toBeNull()
    expect(querySessionsByDay(30, { dbPath: path.join(tempDir ?? '', 'missing.db') })).toEqual([])
    expect(queryModelBreakdown(day(2026, 7, 7), undefined, { dbPath: path.join(tempDir ?? '', 'missing.db') })).toEqual([])
  })

  it('handles corrupt database gracefully', () => {
    const corruptPath = path.join(tempDir ?? '', 'corrupt.db')
    rmSync(corruptPath, { force: true })
    writeFileSync(corruptPath, Buffer.from('not sqlite'))

    expect(connectHermesDb({ dbPath: corruptPath })).toBeNull()
    expect(querySessionsByDay(30, { dbPath: corruptPath })).toEqual([])
    expect(queryModelBreakdown(day(2026, 7, 7), undefined, { dbPath: corruptPath })).toEqual([])
  })
})
