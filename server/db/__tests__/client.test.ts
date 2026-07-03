import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb, getLatestState, close, setRefreshInProgress, getRefreshInProgress, resetRefreshLock, setRefreshRunState, getRefreshRunState, persistSnapshot, getDbPath } from '../client'
import type { MetricSnapshot } from '../../../types/snapshot'

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

  it('clears stale refresh lock when last run state is already finished', async () => {
    await initDb()

    setRefreshRunState({
      startedAt: '2026-06-15T10:00:00.000Z',
      finishedAt: '2026-06-15T10:00:30.000Z',
      durationMs: 30000,
      success: true,
      partialData: false,
      sources: ['github'],
      errorSummary: null,
      skipped: false,
      skippedReason: null,
    })
    setRefreshInProgress(true)

    expect(getRefreshInProgress()).toBe(false)
    expect(getLatestState().refreshInProgress).toBe(false)
  })

  it('clears stale refresh lock when running state already has finished timestamp', async () => {
    await initDb()

    setRefreshRunState({
      startedAt: '2026-06-15T10:00:00.000Z',
      finishedAt: '2026-06-15T10:00:30.000Z',
      durationMs: 30000,
      success: true,
      partialData: false,
      sources: ['github'],
      errorSummary: null,
      skipped: false,
      skippedReason: null,
    })
    setRefreshInProgress(true)
    const runState = getRefreshRunState()
    const db = await initDb()
    db.prepare(`UPDATE latest_state SET value = ? WHERE key = 'refresh_state'`).run(JSON.stringify({
      ...runState,
      status: 'running',
    }))

    expect(getRefreshInProgress()).toBe(false)
    expect(getLatestState().refreshInProgress).toBe(false)
  })

  it('force resets running refresh lock and marks running state skipped', async () => {
    await initDb()
    setRefreshInProgress(true)
    const db = await initDb()
    db.prepare(`INSERT INTO latest_state (key, value) VALUES ('refresh_state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify({
      status: 'running',
      lastRunStartedAt: '2026-06-15T10:00:00.000Z',
      lastRunFinishedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      nextRunAt: null,
      lastError: null,
      durationMs: null,
      sourceHealth: {},
      runHistory: [],
    }))

    const result = resetRefreshLock('test reset')

    expect(result.wasLocked).toBe(true)
    expect(result.previousStatus).toBe('running')
    expect(getRefreshInProgress()).toBe(false)
    const runState = getRefreshRunState()
    expect(runState.status).toBe('skipped')
    expect(runState.lastError).toBe('test reset')
    expect(runState.lastRunFinishedAt).toBeTruthy()
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
    const snapshot: MetricSnapshot = {
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
    }
    persistSnapshot(snapshot)
    close()

    const reopened = await initDb()
    expect(reopened).toBeTruthy()
    expect(getLatestState().snapshot?.id).toBe('snap-1')
  })

  it('preserves snapshot marker across schema upgrade (blob payload dropped)', async () => {
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
      INSERT INTO snapshots (id, captured_at, data, version)
      VALUES ('snap-old', '2026-06-01T00:00:00.000Z', '{}', 3);
    `)
    legacyDb.close()

    await initDb()

    // Snapshot marker should be preserved after migration.
    // The legacy blob payload is intentionally dropped; the next refresh
    // is expected to repopulate the normalized source data and daily metrics.
    const { getDailyMetricsRange } = await import('../client')
    expect(getDailyMetricsRange('2000-01-01', '2099-12-31')).toHaveLength(0)

    const reopened = new Database(join(tmpDir, 'metrics.db'))
    const snapCount = reopened.prepare('SELECT COUNT(*) as count FROM snapshots').get() as { count: number }
    expect(snapCount.count).toBe(1)
    const snapRow = reopened.prepare('SELECT id, captured_at FROM snapshots').get() as { id: string; captured_at: string }
    expect(snapRow.id).toBe('snap-old')
    expect(snapRow.captured_at).toBe('2026-06-01T00:00:00.000Z')
    const columns = reopened.prepare(`PRAGMA table_info(snapshots)`).all() as Array<{ name: string }>
    expect(columns.map(c => c.name).sort()).toEqual(['captured_at', 'created_at', 'id'])
    reopened.close()
  })
})

describe('migration: drop opencode_daily_usage', () => {
  it('drops orphaned opencode_daily_usage table from existing v12 DB', async () => {
    // Seed a v12 DB with the orphaned table
    const dbPath = join(tmpDir, 'metrics.db')
    const seedDb = new Database(dbPath)
    seedDb.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS aggregates (id TEXT PRIMARY KEY, type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, data TEXT NOT NULL, snapshot_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS latest_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO latest_state (key, value) VALUES ('schema_version', '12');
      CREATE TABLE opencode_daily_usage (date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'opencode', total_sessions INTEGER NOT NULL DEFAULT 0, total_messages INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, total_cost REAL, raw_json TEXT, collected_at TEXT NOT NULL, PRIMARY KEY (date, source));
    `)
    seedDb.close()

    await initDb()

    // Verify table was dropped
    const db = new Database(dbPath)
    const tableRow = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='opencode_daily_usage'`).get()
    expect(tableRow).toBeUndefined()

    // Verify schema version was bumped
    const versionRow = db.prepare(`SELECT value FROM latest_state WHERE key = 'schema_version'`).get() as { value: string } | undefined
    expect(versionRow?.value).toBe('13')
    db.close()
  })

  it('is idempotent on already-migrated database', async () => {
    const dbPath = join(tmpDir, 'metrics.db')
    const seedDb = new Database(dbPath)
    seedDb.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, captured_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS aggregates (id TEXT PRIMARY KEY, type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, data TEXT NOT NULL, snapshot_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS latest_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO latest_state (key, value) VALUES ('schema_version', '12');
      CREATE TABLE opencode_daily_usage (date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'opencode', total_sessions INTEGER NOT NULL DEFAULT 0, total_messages INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, total_cost REAL, raw_json TEXT, collected_at TEXT NOT NULL, PRIMARY KEY (date, source));
      INSERT INTO opencode_daily_usage (date, source, collected_at) VALUES ('2026-01-01', 'opencode', '2026-01-01T00:00:00Z');
    `)
    seedDb.close()

    await initDb()
    close()

    // Re-init (simulate second startup)
    const db = await initDb()

    // Table should be gone
    const tableRow = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='opencode_daily_usage'`).get()
    expect(tableRow).toBeUndefined()
  })
})

describe('getDbPath resolution (issue #179)', () => {
  const originalDbDir = process.env['DB_DIR']
  let cwdSpy: ReturnType<typeof jest.spyOn>

  beforeEach(() => {
    delete process.env['DB_DIR']
    cwdSpy = jest.spyOn(process, 'cwd')
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    if (originalDbDir === undefined) {
      delete process.env['DB_DIR']
    } else {
      process.env['DB_DIR'] = originalDbDir
    }
  })

  it('honors DB_DIR when set', () => {
    process.env['DB_DIR'] = '/custom/db/root'
    expect(getDbPath()).toBe(join('/custom/db/root', 'metrics.db'))
  })

  it('resolves to <cwd>/.data/metrics.db when cwd is the repository root', () => {
    cwdSpy.mockReturnValue('/home/agent/repo')
    expect(getDbPath()).toBe(join('/home/agent/repo', '.data', 'metrics.db'))
  })

  it('falls back to <cwd>/../.data/metrics.db when running from frontend/', () => {
    cwdSpy.mockReturnValue('/home/agent/repo/frontend')
    expect(getDbPath()).toBe(join('/home/agent/repo/frontend', '..', '.data', 'metrics.db'))
  })

  it('does not fall back when cwd merely contains a frontend subdirectory', () => {
    cwdSpy.mockReturnValue('/home/agent/repo/frontend-staging')
    expect(getDbPath()).toBe(join('/home/agent/repo/frontend-staging', '.data', 'metrics.db'))
  })
})
