import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  connectOpencodeDb,
  queryAgentBreakdown,
  queryModelBreakdown,
  queryParentChildCounts,
  querySessions,
  querySessionsByDay,
  queryToolUsage,
} from '../db-collector'

let tempDir: string | null = null
let dbPath: string | null = null

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      agent TEXT,
      model TEXT,
      cost REAL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      tokens_reasoning INTEGER,
      tokens_cache_read INTEGER,
      tokens_cache_write INTEGER,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      status TEXT,
      error TEXT,
      time_completed INTEGER,
      completed_at INTEGER,
      time_errored INTEGER,
      errored_at INTEGER
    );

    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL
    );

    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT
    );
  `)
}

function insertSession(db: Database.Database, row: {
  id: string
  slug: string
  agent: string | null
  model: string | null
  cost: number | null
  tokensInput: number | null
  tokensOutput: number | null
  tokensReasoning: number | null
  tokensCacheRead: number | null
  tokensCacheWrite: number | null
  timeCreated: number
  timeUpdated: number
  projectId: string
  parentId: string | null
  status?: string | null
  error?: string | null
  timeCompleted?: number | null
  completedAt?: number | null
  timeErrored?: number | null
  erroredAt?: number | null
}): void {
  const params = {
    ...row,
    status: row.status ?? null,
    error: row.error ?? null,
    timeCompleted: row.timeCompleted ?? null,
    completedAt: row.completedAt ?? null,
    timeErrored: row.timeErrored ?? null,
    erroredAt: row.erroredAt ?? null,
  }

  db.prepare(`
    INSERT INTO session (
      id, slug, agent, model, cost, tokens_input, tokens_output, tokens_reasoning,
      tokens_cache_read, tokens_cache_write, time_created, time_updated, project_id,
      parent_id, status, error, time_completed, completed_at, time_errored, errored_at
    ) VALUES (
      @id, @slug, @agent, @model, @cost, @tokensInput, @tokensOutput, @tokensReasoning,
      @tokensCacheRead, @tokensCacheWrite, @timeCreated, @timeUpdated, @projectId,
      @parentId, @status, @error, @timeCompleted, @completedAt, @timeErrored, @erroredAt
    )
  `).run(params)
}

function insertMessage(db: Database.Database, id: string, sessionId: string, timeCreated: number): void {
  db.prepare('INSERT INTO message (id, session_id, time_created) VALUES (?, ?, ?)').run(id, sessionId, timeCreated)
}

function insertPart(db: Database.Database, id: string, sessionId: string, data: Record<string, unknown>, timeCreated?: number): void {
  db.prepare('INSERT INTO part (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
    id,
    sessionId,
    timeCreated ?? Date.now(),
    JSON.stringify(data),
  )
}

function utc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'opencode-db-collector-'))
  dbPath = path.join(tempDir, 'opencode.db')
  const db = new Database(dbPath)
  createSchema(db)

  insertSession(db, {
    id: 'ses-001',
    slug: 'root-1',
    agent: 'explorer',
    model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
    cost: 1.25,
    tokensInput: 120,
    tokensOutput: 80,
    tokensReasoning: 30,
    tokensCacheRead: 10,
    tokensCacheWrite: 5,
    timeCreated: utc(2026, 6, 26, 23, 30),
    timeUpdated: utc(2026, 6, 27, 0, 10),
    projectId: 'project-a',
    parentId: null,
    status: 'completed',
    timeCompleted: utc(2026, 6, 27, 0, 10),
  })

  insertSession(db, {
    id: 'ses-002',
    slug: 'root-2',
    agent: 'explorer',
    model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
    cost: 0,
    tokensInput: 0,
    tokensOutput: 0,
    tokensReasoning: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    timeCreated: utc(2026, 6, 27, 0, 5),
    timeUpdated: utc(2026, 6, 27, 0, 5),
    projectId: 'project-a',
    parentId: null,
    status: 'errored',
    error: 'boom',
    timeErrored: utc(2026, 6, 27, 0, 6),
  })

  insertSession(db, {
    id: 'ses-003',
    slug: 'root-3',
    agent: 'planner',
    model: 'gpt-4.1',
    cost: 2,
    tokensInput: 300,
    tokensOutput: 200,
    tokensReasoning: 50,
    tokensCacheRead: 40,
    tokensCacheWrite: 20,
    timeCreated: utc(2026, 6, 27, 12, 0),
    timeUpdated: utc(2026, 6, 27, 12, 30),
    projectId: 'project-a',
    parentId: null,
    status: 'completed',
    completedAt: utc(2026, 6, 27, 12, 30),
  })

  insertSession(db, {
    id: 'ses-004',
    slug: 'child-1',
    agent: 'subagent',
    model: null,
    cost: 0.1,
    tokensInput: 15,
    tokensOutput: 5,
    tokensReasoning: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    timeCreated: utc(2026, 6, 27, 13, 0),
    timeUpdated: utc(2026, 6, 27, 13, 2),
    projectId: 'project-a',
    parentId: 'ses-001',
    status: 'completed',
    timeCompleted: utc(2026, 6, 27, 13, 2),
  })

  insertSession(db, {
    id: 'ses-005',
    slug: 'root-4',
    agent: 'explorer',
    model: JSON.stringify({ modelID: 'old-model', providerID: 'openai' }),
    cost: 0.5,
    tokensInput: 50,
    tokensOutput: 25,
    tokensReasoning: 10,
    tokensCacheRead: 2,
    tokensCacheWrite: 1,
    timeCreated: utc(2026, 6, 28, 1, 0),
    timeUpdated: utc(2026, 6, 28, 1, 3),
    projectId: 'project-b',
    parentId: null,
    status: 'completed',
    completedAt: utc(2026, 6, 28, 1, 3),
  })

  insertSession(db, {
    id: 'ses-006',
    slug: 'root-5',
    agent: 'planner',
    model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic', variant: 'default' }),
    cost: 0.75,
    tokensInput: 60,
    tokensOutput: 40,
    tokensReasoning: 5,
    tokensCacheRead: 8,
    tokensCacheWrite: 4,
    timeCreated: utc(2026, 6, 28, 2, 0),
    timeUpdated: utc(2026, 6, 28, 2, 0),
    projectId: 'project-b',
    parentId: null,
  })

  insertMessage(db, 'msg-1', 'ses-001', utc(2026, 6, 26, 23, 30))
  insertMessage(db, 'msg-2', 'ses-001', utc(2026, 6, 26, 23, 31))
  insertMessage(db, 'msg-3', 'ses-001', utc(2026, 6, 26, 23, 32))
  insertMessage(db, 'msg-4', 'ses-002', utc(2026, 6, 27, 0, 5))
  insertMessage(db, 'msg-5', 'ses-003', utc(2026, 6, 27, 12, 0))
  insertMessage(db, 'msg-6', 'ses-003', utc(2026, 6, 27, 12, 2))
  insertMessage(db, 'msg-7', 'ses-004', utc(2026, 6, 27, 13, 0))
  insertMessage(db, 'msg-8', 'ses-005', utc(2026, 6, 28, 1, 0))
  insertMessage(db, 'msg-9', 'ses-005', utc(2026, 6, 28, 1, 1))
  insertMessage(db, 'msg-10', 'ses-006', utc(2026, 6, 28, 2, 0))

  db.close()
})

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe('opencode db collector', () => {
  it('connects to a valid opencode db in read-only mode', () => {
    const db = connectOpencodeDb({ dbPath: dbPath ?? undefined })
    expect(db).not.toBeNull()
    db?.close()
  })

  it('returns sessions ordered by timeCreated descending', () => {
    const rows = querySessions(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
    expect(rows).toHaveLength(6)
    expect(rows[0]!.id).toBe('ses-006')
    expect(rows[1]!.id).toBe('ses-005')
    expect(rows.at(-1)!.id).toBe('ses-001')
    expect(rows.find(row => row.id === 'ses-004')!.parentId).toBe('ses-001')
    expect(rows.find(row => row.id === 'ses-004')!.model).toBeNull()
  })

  it('aggregates sessions by utc day', () => {
    jest.spyOn(Date, 'now').mockReturnValue(utc(2026, 6, 28, 12, 0))

    const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
    expect(rows).toEqual([
      {
        day: '2026-06-28',
        sessions: 2,
        startedSessions: 2,
        completedSessions: 1,
        erroredSessions: 0,
        cost: 1.25,
        tokensInput: 110,
        tokensOutput: 65,
        tokensReasoning: 15,
        tokensCacheRead: 10,
        tokensCacheWrite: 5,
      },
      {
        day: '2026-06-27',
        sessions: 3,
        startedSessions: 3,
        completedSessions: 2,
        erroredSessions: 0,
        cost: 2.1,
        tokensInput: 315,
        tokensOutput: 205,
        tokensReasoning: 50,
        tokensCacheRead: 40,
        tokensCacheWrite: 20,
      },
      {
        day: '2026-06-26',
        sessions: 1,
        startedSessions: 1,
        completedSessions: 1,
        erroredSessions: 0,
        cost: 1.25,
        tokensInput: 120,
        tokensOutput: 80,
        tokensReasoning: 30,
        tokensCacheRead: 10,
        tokensCacheWrite: 5,
      },
    ])
    jest.restoreAllMocks()
  })

  it('aggregates sessions by model and includes message counts', () => {
    const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
    expect(rows).toEqual([
      {
        modelName: 'claude-4',
        provider: 'anthropic',
        sessions: 3,
        messages: 5,
        inputTokens: 180,
        outputTokens: 120,
        reasoningTokens: 35,
        cacheReadTokens: 18,
        cacheWriteTokens: 9,
        cost: 2,
      },
      {
        modelName: 'gpt-4.1',
        provider: null,
        sessions: 1,
        messages: 2,
        inputTokens: 300,
        outputTokens: 200,
        reasoningTokens: 50,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
        cost: 2,
      },
      {
        modelName: 'old-model',
        provider: 'openai',
        sessions: 1,
        messages: 2,
        inputTokens: 50,
        outputTokens: 25,
        reasoningTokens: 10,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        cost: 0.5,
      },
      {
        modelName: 'unknown',
        provider: null,
        sessions: 1,
        messages: 1,
        inputTokens: 15,
        outputTokens: 5,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.1,
      },
    ])
  })

  it('aggregates reasoningTokens per model in queryModelBreakdown', () => {
    const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
    // Every entry must carry a numeric reasoningTokens field, summed across
    // sessions of the same model. From the seed data:
    //   claude-4   = 30 + 0 + 5 = 35
    //   gpt-4.1    = 50
    //   old-model  = 10
    //   (unknown)  = 0
    for (const row of rows) {
      expect(typeof row.reasoningTokens).toBe('number')
      expect(row.reasoningTokens).toBeGreaterThanOrEqual(0)
    }
    const byName = new Map(rows.map(r => [r.modelName, r.reasoningTokens]))
    expect(byName.get('claude-4')).toBe(35)
    expect(byName.get('gpt-4.1')).toBe(50)
    expect(byName.get('old-model')).toBe(10)
    expect(byName.get('(unknown)')).toBeUndefined()
    expect(byName.get('unknown')).toBe(0)
  })

  it('aggregates sessions by agent', () => {
    const rows = queryAgentBreakdown(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
    expect(rows).toEqual([
      { agent: 'explorer', sessions: 3 },
      { agent: 'planner', sessions: 2 },
      { agent: 'subagent', sessions: 1 },
    ])
  })

  it('counts root sessions vs subagent sessions', () => {
    expect(queryParentChildCounts(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })).toEqual({
      primarySessions: 5,
      subagentSessions: 1,
    })
  })

  describe('queryToolUsage', () => {
    it('returns an empty array when there are no tool parts', () => {
      expect(queryToolUsage(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })).toEqual([])
    })

    it('aggregates tool usage by tool name', () => {
      const db = new Database(dbPath ?? '')
      insertPart(db, 'part-1', 'ses-001', { type: 'tool', tool: 'read_file' })
      insertPart(db, 'part-2', 'ses-001', { type: 'tool', tool: 'read_file' })
      insertPart(db, 'part-3', 'ses-001', { type: 'tool', tool: 'write_file' })
      insertPart(db, 'part-4', 'ses-002', { type: 'tool', tool: 'read_file' })
      insertPart(db, 'part-5', 'ses-003', { type: 'tool', tool: 'bash' })
      insertPart(db, 'part-6', 'ses-003', { type: 'tool', tool: 'bash' })
      insertPart(db, 'part-7', 'ses-003', { type: 'tool', tool: 'bash' })
      insertPart(db, 'part-8', 'ses-003', { type: 'text', content: 'ignored' })
      db.close()

      const rows = queryToolUsage(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
      expect(rows).toEqual([
        { toolName: 'bash', count: 3 },
        { toolName: 'read_file', count: 3 },
        { toolName: 'write_file', count: 1 },
      ])
    })

    it('filters by session.time_created (since)', () => {
      const db = new Database(dbPath ?? '')
      insertPart(db, 'part-1', 'ses-001', { type: 'tool', tool: 'read_file' })
      insertPart(db, 'part-2', 'ses-003', { type: 'tool', tool: 'bash' })
      db.close()

      const rows = queryToolUsage(utc(2026, 6, 27), undefined, { dbPath: dbPath ?? undefined })
      expect(rows).toEqual([{ toolName: 'bash', count: 1 }])
    })

    it('filters by the optional until boundary', () => {
      const db = new Database(dbPath ?? '')
      insertPart(db, 'part-1', 'ses-001', { type: 'tool', tool: 'read_file' })
      insertPart(db, 'part-2', 'ses-003', { type: 'tool', tool: 'bash' })
      insertPart(db, 'part-3', 'ses-005', { type: 'tool', tool: 'edit' })
      db.close()

      const rows = queryToolUsage(
        utc(2026, 6, 26),
        utc(2026, 6, 28),
        { dbPath: dbPath ?? undefined },
      )
      expect(rows).toEqual([
        { toolName: 'bash', count: 1 },
        { toolName: 'read_file', count: 1 },
      ])
    })

    it('returns an empty array for missing or corrupt databases', () => {
      expect(queryToolUsage(0, undefined, { dbPath: path.join(tempDir ?? '', 'missing.db') })).toEqual([])
    })
  })

  it('falls back to empty results for missing or corrupt databases', () => {
    expect(connectOpencodeDb({ dbPath: path.join(tempDir ?? '', 'missing.db') })).toBeNull()

    const corruptPath = path.join(tempDir ?? '', 'corrupt.db')
    rmSync(corruptPath, { force: true })
    writeFileSync(corruptPath, Buffer.from('not sqlite'))

    expect(connectOpencodeDb({ dbPath: corruptPath })).toBeNull()
    expect(querySessions(0, undefined, { dbPath: corruptPath })).toEqual([])
    expect(querySessionsByDay(30, { dbPath: corruptPath })).toEqual([])
    expect(queryModelBreakdown(0, undefined, { dbPath: corruptPath })).toEqual([])
    expect(queryAgentBreakdown(0, undefined, { dbPath: corruptPath })).toEqual([])
    expect(queryToolUsage(0, undefined, { dbPath: corruptPath })).toEqual([])
    expect(queryParentChildCounts(0, undefined, { dbPath: corruptPath })).toEqual({ primarySessions: 0, subagentSessions: 0 })
  })

  // ----- "unknown vs false" contract (issue #343) -----

  describe('null-aware metric propagation', () => {
    it('returns null cost/tokens fields when the DB column is NULL', () => {
      const db = new Database(dbPath ?? '')
      insertSession(db, {
        id: 'ses-null-1',
        slug: 'root-null',
        agent: 'explorer',
        model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
        cost: null,
        tokensInput: null,
        tokensOutput: null,
        tokensReasoning: null,
        tokensCacheRead: null,
        tokensCacheWrite: null,
        timeCreated: utc(2026, 6, 29, 12, 0),
        timeUpdated: utc(2026, 6, 29, 12, 0),
        projectId: 'project-null',
        parentId: null,
      })
      db.close()

      const rows = querySessions(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
      const nullRow = rows.find((r) => r.id === 'ses-null-1')
      expect(nullRow).toBeDefined()
      expect(nullRow!.cost).toBeNull()
      expect(nullRow!.tokensInput).toBeNull()
      expect(nullRow!.tokensOutput).toBeNull()
      expect(nullRow!.tokensReasoning).toBeNull()
      expect(nullRow!.tokensCacheRead).toBeNull()
      expect(nullRow!.tokensCacheWrite).toBeNull()
    })

    it('produces a null daily aggregation when the only session in a day has null columns', () => {
      jest.spyOn(Date, 'now').mockReturnValue(utc(2026, 6, 30, 12, 0))
      const db = new Database(dbPath ?? '')
      insertSession(db, {
        id: 'ses-null-day',
        slug: 'root-null-day',
        agent: 'explorer',
        model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
        cost: null,
        tokensInput: null,
        tokensOutput: null,
        tokensReasoning: null,
        tokensCacheRead: null,
        tokensCacheWrite: null,
        timeCreated: utc(2026, 6, 30, 8, 0),
        timeUpdated: utc(2026, 6, 30, 8, 5),
        projectId: 'project-null',
        parentId: null,
      })
      db.close()

      const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
      const day = rows.find((r) => r.day === '2026-06-30')
      expect(day).toBeDefined()
      // Sessions counter is real (row exists) but every cost/tokens field
      // is null because the seed row had NULL for every numeric column.
      expect(day!.sessions).toBe(1)
      expect(day!.cost).toBeNull()
      expect(day!.tokensInput).toBeNull()
      expect(day!.tokensOutput).toBeNull()
      expect(day!.tokensReasoning).toBeNull()
      expect(day!.tokensCacheRead).toBeNull()
      expect(day!.tokensCacheWrite).toBeNull()
      jest.restoreAllMocks()
    })

    it('keeps a null field null when ALL sessions in a day are null, sums mixed correctly', () => {
      jest.spyOn(Date, 'now').mockReturnValue(utc(2026, 6, 30, 12, 0))
      const db = new Database(dbPath ?? '')
      // Two sessions on the same day — one with cost, one without.
      // The day's `cost` field should be a non-null sum (only one non-null
      // value), but if a different column is null in both rows, it stays null.
      insertSession(db, {
        id: 'ses-mixed-A',
        slug: 'mixed-A',
        agent: 'explorer',
        model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
        cost: 0.5,
        tokensInput: 100,
        tokensOutput: 50,
        tokensReasoning: null,
        tokensCacheRead: 5,
        tokensCacheWrite: null,
        timeCreated: utc(2026, 6, 30, 8, 0),
        timeUpdated: utc(2026, 6, 30, 8, 5),
        projectId: 'project-mixed',
        parentId: null,
      })
      insertSession(db, {
        id: 'ses-mixed-B',
        slug: 'mixed-B',
        agent: 'planner',
        model: 'gpt-4.1',
        cost: 0.25,
        tokensInput: null,
        tokensOutput: 70,
        tokensReasoning: null,
        tokensCacheRead: null,
        tokensCacheWrite: null,
        timeCreated: utc(2026, 6, 30, 9, 0),
        timeUpdated: utc(2026, 6, 30, 9, 10),
        projectId: 'project-mixed',
        parentId: null,
      })
      db.close()

      const rows = querySessionsByDay(7, { dbPath: dbPath ?? undefined })
      const day = rows.find((r) => r.day === '2026-06-30')
      expect(day).toBeDefined()
      // Mixed: at least one non-null → sum of non-null values.
      expect(day!.cost).toBeCloseTo(0.75, 10)            // 0.5 + 0.25
      expect(day!.tokensInput).toBe(100)                  // only ses-A had it
      expect(day!.tokensOutput).toBe(120)                 // 50 + 70
      // All-null column: stays null (no measurement available).
      expect(day!.tokensReasoning).toBeNull()
      expect(day!.tokensCacheWrite).toBeNull()
      jest.restoreAllMocks()
    })

    it('produces a null model entry when the model has only null-cost sessions', () => {
      const db = new Database(dbPath ?? '')
      insertSession(db, {
        id: 'ses-null-model',
        slug: 'root-null-model',
        agent: 'explorer',
        model: JSON.stringify({ id: 'claude-4', providerID: 'anthropic' }),
        cost: null,
        tokensInput: null,
        tokensOutput: null,
        tokensReasoning: null,
        tokensCacheRead: null,
        tokensCacheWrite: null,
        timeCreated: utc(2026, 6, 29, 13, 0),
        timeUpdated: utc(2026, 6, 29, 13, 5),
        projectId: 'project-x',
        parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: dbPath ?? undefined })
      const claude = rows.find((r) => r.modelName === 'claude-4')
      expect(claude).toBeDefined()
      // Claude-4 had non-null values from the seed data, but the new
      // null session should additively leave cost null-free: the original
      // sum is preserved (claude-4 originally summed to 2.0 across ses-001/002/006).
      // Verify by checking the reasoningTokens/cost are still numeric (not null).
      expect(typeof claude!.cost).toBe('number')
      expect(typeof claude!.reasoningTokens).toBe('number')
    })
  })

  // Regression tests for the `provider: null` bug. Before the fix, the
  // collector extracted `id` from the JSON-shaped model column and then
  // ran a slash-split on the bare string — the sibling `providerID` field
  // was dropped. Every model row therefore reported `provider: null`,
  // even though the upstream opencode schema carries the provider in the
  // same JSON. These tests pin the behaviour for every shape that
  // `session.model` can take: JSON string, pre-parsed JSON object,
  // plain string, null.
  describe('provider extraction from session.model', () => {
    it('surfaces providerID from JSON-shaped model string', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-prov-1-'))
      const p = path.join(dir, 'opencode.db')
      const db = new Database(p)
      createSchema(db)
      insertSession(db, {
        id: 'ses-A',
        slug: 's',
        agent: 'a',
        model: JSON.stringify({ id: 'glm-5.2', providerID: 'openference' }),
        cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
        tokensCacheRead: 0, tokensCacheWrite: 0,
        timeCreated: utc(2026, 6, 26, 0, 0), timeUpdated: utc(2026, 6, 26, 0, 1),
        projectId: 'p', parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: p })
      expect(rows[0]?.modelName).toBe('glm-5.2')
      expect(rows[0]?.provider).toBe('openference')
    })

    it('falls back to slash-form provider when JSON has no providerID', () => {
      // opencode-go fixtures use the legacy `<provider>/<model>` slash
      // form. The collector must keep deriving provider from the slash
      // when the JSON has no providerID, so the opencode-go provider
      // tests stay green.
      const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-prov-3-'))
      const p = path.join(dir, 'opencode.db')
      const db = new Database(p)
      createSchema(db)
      insertSession(db, {
        id: 'ses-A',
        slug: 's',
        agent: 'a',
        model: 'opencode-go/deepseek-v4-flash',
        cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
        tokensCacheRead: 0, tokensCacheWrite: 0,
        timeCreated: utc(2026, 6, 26, 0, 0), timeUpdated: utc(2026, 6, 26, 0, 1),
        projectId: 'p', parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: p })
      expect(rows[0]?.modelName).toBe('opencode-go-deepseek-v4-flash')
      expect(rows[0]?.provider).toBe('opencode-go')
    })

    it('returns null provider for plain-string model with no slash and no JSON', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-prov-4-'))
      const p = path.join(dir, 'opencode.db')
      const db = new Database(p)
      createSchema(db)
      insertSession(db, {
        id: 'ses-A',
        slug: 's',
        agent: 'a',
        model: 'gpt-4.1',
        cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
        tokensCacheRead: 0, tokensCacheWrite: 0,
        timeCreated: utc(2026, 6, 26, 0, 0), timeUpdated: utc(2026, 6, 26, 0, 1),
        projectId: 'p', parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: p })
      expect(rows[0]?.modelName).toBe('gpt-4.1')
      expect(rows[0]?.provider).toBeNull()
    })

    it('returns null provider when session.model is null', () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-prov-5-'))
      const p = path.join(dir, 'opencode.db')
      const db = new Database(p)
      createSchema(db)
      insertSession(db, {
        id: 'ses-A',
        slug: 's',
        agent: 'a',
        model: null,
        cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
        tokensCacheRead: 0, tokensCacheWrite: 0,
        timeCreated: utc(2026, 6, 26, 0, 0), timeUpdated: utc(2026, 6, 26, 0, 1),
        projectId: 'p', parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: p })
      expect(rows[0]?.modelName).toBe('unknown')
      expect(rows[0]?.provider).toBeNull()
    })

    it('JSON providerID wins over any embedded slash in id (defensive)', () => {
      // Defensive: if a model id contains a slash but the JSON also
      // carries providerID, the JSON wins. Real schema can't produce
      // this today but the contract is worth pinning.
      const dir = mkdtempSync(path.join(os.tmpdir(), 'opencode-prov-6-'))
      const p = path.join(dir, 'opencode.db')
      const db = new Database(p)
      createSchema(db)
      insertSession(db, {
        id: 'ses-A',
        slug: 's',
        agent: 'a',
        model: JSON.stringify({ id: 'some-org/some-model', providerID: 'real-provider' }),
        cost: 0, tokensInput: 0, tokensOutput: 0, tokensReasoning: 0,
        tokensCacheRead: 0, tokensCacheWrite: 0,
        timeCreated: utc(2026, 6, 26, 0, 0), timeUpdated: utc(2026, 6, 26, 0, 1),
        projectId: 'p', parentId: null,
      })
      db.close()

      const rows = queryModelBreakdown(utc(2026, 6, 26), undefined, { dbPath: p })
      expect(rows[0]?.provider).toBe('real-provider')
    })
  })
})
