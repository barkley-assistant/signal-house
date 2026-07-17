import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createSessionCollector } from '../collector'

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
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
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
  `).run({
    ...row,
    status: row.status ?? null,
    error: row.error ?? null,
    timeCompleted: row.timeCompleted ?? null,
    completedAt: row.completedAt ?? null,
    timeErrored: row.timeErrored ?? null,
    erroredAt: row.erroredAt ?? null,
  })
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
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'session-collector-'))
  dbPath = path.join(tempDir, 'opencode.db')
  const db = new Database(dbPath)
  createSchema(db)
  db.close()
})

afterEach(() => {
  jest.restoreAllMocks()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  tempDir = null
  dbPath = null
})

describe('createSessionCollector', () => {
  it('collects DB-backed session aggregates', async () => {
    const db = new Database(dbPath ?? '')

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
      timeUpdated: utc(2026, 6, 26, 23, 45),
      projectId: 'project-a',
      parentId: null,
      status: 'completed',
      timeCompleted: utc(2026, 6, 26, 23, 45),
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

    insertMessage(db, 'msg-1', 'ses-001', utc(2026, 6, 26, 23, 30))
    insertMessage(db, 'msg-2', 'ses-001', utc(2026, 6, 26, 23, 31))
    insertMessage(db, 'msg-3', 'ses-002', utc(2026, 6, 27, 0, 5))
    insertMessage(db, 'msg-4', 'ses-003', utc(2026, 6, 27, 12, 0))
    insertMessage(db, 'msg-5', 'ses-003', utc(2026, 6, 27, 12, 2))
    insertMessage(db, 'msg-6', 'ses-003', utc(2026, 6, 27, 12, 4))

    insertPart(db, 'part-1', 'ses-001', { type: 'tool', tool: 'read_file' }, utc(2026, 6, 26, 23, 31))
    insertPart(db, 'part-2', 'ses-001', { type: 'tool', tool: 'read_file' }, utc(2026, 6, 26, 23, 32))
    insertPart(db, 'part-3', 'ses-001', { type: 'tool', tool: 'write_file' }, utc(2026, 6, 26, 23, 33))
    insertPart(db, 'part-4', 'ses-002', { type: 'tool', tool: 'read_file' }, utc(2026, 6, 27, 0, 6))
    insertPart(db, 'part-5', 'ses-003', { type: 'tool', tool: 'bash' }, utc(2026, 6, 27, 12, 1))
    insertPart(db, 'part-6', 'ses-003', { type: 'tool', tool: 'bash' }, utc(2026, 6, 27, 12, 2))
    insertPart(db, 'part-7', 'ses-003', { type: 'tool', tool: 'bash' }, utc(2026, 6, 27, 12, 3))
    insertPart(db, 'part-8', 'ses-003', { type: 'tool', tool: 'bash' }, utc(2026, 6, 27, 12, 4))
    insertPart(db, 'part-9', 'ses-003', { type: 'text', content: 'ignored' }, utc(2026, 6, 27, 12, 5))

    db.close()

    jest.spyOn(Date, 'now').mockReturnValue(utc(2026, 6, 28, 12, 0))

    const result = await createSessionCollector({ dbPath: dbPath ?? undefined }).collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toEqual([])
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage).toMatchObject({
      periodStart: '2026-05-29T12:00:00.000Z',
      periodEnd: '2026-06-28T12:00:00.000Z',
      totalSessions: 3,
      startedSessions: 3,
      completedSessions: 2,
      erroredSessions: null,
      stuckSessions: null,
      lastActivityAt: '2026-06-27T12:30:00.000Z',
      messages: 6,
      activeDays: 2,
      totalCost: 3.25,
      averageCostPerDay: 1.625,
      averageTokensPerSession: 285,
      medianTokensPerSession: 245,
      inputTokens: 420,
      outputTokens: 280,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      uniqueTools: ['bash', 'read_file', 'write_file'],
      toolUsage: [
        { toolName: 'bash', count: 4, percentage: 50 },
        { toolName: 'read_file', count: 3, percentage: 37.5 },
        { toolName: 'write_file', count: 1, percentage: 12.5 },
      ],
      topActions: [
        { action: 'bash', count: 4 },
        { action: 'read_file', count: 3 },
        { action: 'write_file', count: 1 },
      ],
      errorCount: 0,
    })
    expect(result.sessionUsage!.modelUsage).toEqual([
      {
        modelName: 'claude-4',
        messages: 3,
        inputTokens: 120,
        outputTokens: 80,
        tokensReasoning: 30,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        cost: 1.25,
      },
      {
        modelName: 'gpt-4.1',
        messages: 3,
        inputTokens: 300,
        outputTokens: 200,
        tokensReasoning: 50,
        cacheReadTokens: 40,
        cacheWriteTokens: 20,
        cost: 2,
      },
    ])
  })

  it('returns a zeroed aggregate for an empty opencode db', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(utc(2026, 6, 28, 12, 0))

    const result = await createSessionCollector({ dbPath: dbPath ?? undefined }).collect()

    expect(result.gap).toBeNull()
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage).toMatchObject({
      totalSessions: 0,
      startedSessions: null,
      completedSessions: null,
      erroredSessions: null,
      stuckSessions: null,
      lastActivityAt: null,
      messages: 0,
      activeDays: null,
      // "unknown vs false" contract (issue #343): an empty DB has no
      // measurement, so `totalCost` is `null` (not `0`).
      totalCost: null,
      averageCostPerDay: null,
      averageTokensPerSession: null,
      medianTokensPerSession: null,
      // token totals: not measured either → null
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      uniqueTools: [],
      toolUsage: [],
      modelUsage: [],
      topActions: [],
      errorCount: 0,
    })
  })

  it('returns a gap when the db cannot be opened', async () => {
    const result = await createSessionCollector({ dbPath: path.join(tempDir ?? '', 'missing.db') }).collect()

    expect(result.sessions).toEqual([])
    expect(result.sessionUsage).toBeNull()
    expect(result.gap).toContain('opencode stats DB unavailable')
    expect(result.gap).toContain('no opencode database available')
  })
})
