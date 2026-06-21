import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb, getLatestState, close, setRefreshRunState, getRefreshRunState, getLatestSnapshot, insertSnapshot } from '../client'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'metrics-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('initDb on fresh database', () => {
  it('initializes and returns a valid db', async () => {
    const db = await initDb()
    expect(db).toBeTruthy()
    expect(typeof db.prepare).toBe('function')
  })

  it('getLatestState returns defaults on empty db', async () => {
    await initDb()
    const state = getLatestState()
    expect(state.snapshot).toBeNull()
    expect(state.lastRefreshAt).toBeNull()
    expect(state.lastSuccessfulRefreshAt).toBeNull()
    expect(state.refreshInProgress).toBe(false)
    expect(state.isStale).toBe(true)
    expect(state.staleReason).toBe('no successful refresh has completed yet')
    expect(state.pollerEnabled).toBe(false)
    expect(state.refreshStatus).toBe('idle')
    expect(state.lastFailureAt).toBeNull()
    expect(state.lastSuccessAt).toBeNull()
    expect(state.nextRunAt).toBeNull()
    expect(state.refreshState).toEqual({
      status: 'idle',
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      nextRunAt: null,
      lastError: null,
      durationMs: null,
      sourceHealth: {},
      runHistory: [],
    })
  })

  it('getLatestState can be called multiple times', async () => {
    await initDb()
    const state1 = getLatestState()
    const state2 = getLatestState()
    expect(state1).toEqual(state2)
  })

  it('persists structured refresh run state with capped history', async () => {
    await initDb()

    for (let i = 0; i < 12; i += 1) {
      setRefreshRunState({
        startedAt: `2026-06-15T10:${String(i).padStart(2, '0')}:00.000Z`,
        finishedAt: `2026-06-15T10:${String(i).padStart(2, '0')}:30.000Z`,
        durationMs: 30000,
        success: i % 2 === 0,
        partialData: i % 3 === 0,
        sources: ['github'],
        errorSummary: i % 2 === 0 ? null : 'GitHub collector failed',
        skipped: false,
        skippedReason: null,
      })
    }

    const runState = getRefreshRunState()
    expect(runState.status).toBe('failed')
    expect(runState.runHistory).toHaveLength(10)
    expect(runState.lastFailureAt).toBe('2026-06-15T10:11:30.000Z')
    expect(runState.lastSuccessAt).toBe('2026-06-15T10:10:30.000Z')
    expect(runState.sourceHealth.github?.status).toBe('degraded')

    const latestState = getLatestState()
    expect(latestState.refreshState.runHistory).toHaveLength(10)
  })

  it('includes discovery warnings in local source health', async () => {
    await initDb()

    setRefreshRunState({
      startedAt: '2026-06-15T10:00:00.000Z',
      finishedAt: '2026-06-15T10:00:30.000Z',
      durationMs: 30000,
      success: true,
      partialData: false,
      sources: ['localGit'],
      warnings: ['root /workspace: permission denied'],
      errorSummary: null,
      skipped: false,
      skippedReason: null,
    })

    const runState = getRefreshRunState()
    expect(runState.sourceHealth.localGit?.status).toBe('degraded')
    expect(runState.sourceHealth.localGit?.message).toContain('Discovery warnings')
    expect(runState.sourceHealth.localGit?.message).toContain('permission denied')
  })

  it('persists data on disk across close and reopen', async () => {
    await initDb()
    insertSnapshot({
      id: 'snap-1',
      capturedAt: '2026-06-18T12:00:00.000Z',
      issues: [],
      pullRequests: [],
      workflowRuns: [],
      repositories: [],
      sessions: [],
      localGit: [],
      errors: [],
      aggregates: {
        throughput: { periodStart: '2026-06-18T00:00:00.000Z', periodEnd: '2026-06-18T12:00:00.000Z', issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
        cycleTime: null,
        ci: null,
        staleWork: { asOf: '2026-06-18T12:00:00.000Z', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
        sessionUsage: null,
        computedAt: '2026-06-18T12:00:00.000Z',
      },
      metadata: { source: 'orchestrated', refreshDurationMs: 1, partialData: false, errors: [] },
    } as any)
    close()

    const reopened = await initDb()
    expect(reopened).toBeTruthy()
    expect(getLatestSnapshot()?.id).toBe('snap-1')
  })

  it('drops incompatible runtime data and recreates a fresh schema', async () => {
    const legacyDb = new Database(join(tmpDir, 'metrics.db'))
    legacyDb.exec(`
      CREATE TABLE snapshots (
        id TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        data TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE aggregates (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        data TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE latest_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO latest_state (key, value) VALUES ('schema_version', '3');
      INSERT INTO snapshots (id, captured_at, data, version) VALUES ('snap-old', '2026-06-01T00:00:00.000Z', '{}', 3);
    `)
    legacyDb.close()

    await initDb()

    expect(getLatestSnapshot()).toBeNull()
    expect(getLatestState().snapshot).toBeNull()
    expect(getLatestState().refreshState.runHistory).toEqual([])

    const reopened = new Database(join(tmpDir, 'metrics.db'))
    const count = reopened.prepare('SELECT COUNT(*) as count FROM snapshots').get() as { count: number }
    expect(count.count).toBe(0)
    reopened.close()
  })
})
