import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  initDb,
  close,
  runRetention,
  insertSnapshot,
  upsertDailyMetrics,
  getLatestSnapshot,
  getDailyMetricsRange,
  listSnapshots,
  persistSnapshot,
} from '../client'
import type { DailyMetricsInsert } from '../../../types/daily-metrics'
import type { MetricSnapshot } from '../../../types/snapshot'

let tmpDir: string

function makeDailyRow(day: string, overrides: Partial<DailyMetricsInsert> = {}): DailyMetricsInsert {
  return {
    day,
    repoKey: 'all',
    capturedAt: day + 'T12:00:00Z',
    source: 'test',
    reflectsCompleteData: true,
    issuesOpened: 0,
    issuesClosed: 0,
    prsCreated: 0,
    prsMerged: 0,
    totalCommits: 0,
    avgCycleTimeDays: null,
    medianCycleTimeDays: null,
    p95CycleTimeDays: null,
    cycleTimeSampleSize: 0,
    ciTotalRuns: 0,
    ciPassCount: 0,
    ciFailCount: 0,
    ciPassRate: null,
    ciAvgDurationMs: null,
    totalSessions: 0,
    sessionErrorCount: 0,
    staleIssues: 0,
    stalePrs: 0,
    warnings: [],
    ...overrides,
  }
}

function makeSnapshot(id: string, capturedAt: string): MetricSnapshot {
  return {
    id,
    capturedAt,
    issues: [],
    pullRequests: [],
    workflowRuns: [],
    repositories: [],
    sessions: [],
    localGit: [],
    errors: [],
    aggregates: {
      throughput: { periodStart: capturedAt, periodEnd: capturedAt, issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
      cycleTime: null,
      ci: null,
      staleWork: { asOf: capturedAt, staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
      sessionUsage: null,
      computedAt: capturedAt,
    },
    metadata: { source: 'orchestrated', refreshDurationMs: 1, partialData: false, errors: [] },
  }
}

function insertRawSession(db: Database.Database, id: string, timestamp: string): void {
  db.prepare(`
    INSERT INTO source_sessions (id, last_snapshot_id, tool_name, action, timestamp, duration_ms, success, metadata)
    VALUES (?, 'snap', 'tool', 'action', ?, 100, 1, '{}')
  `).run(id, timestamp)
}

function insertRawWorkflowRun(db: Database.Database, id: string, createdAt: string): void {
  db.prepare(`
    INSERT INTO source_workflow_runs (id, last_snapshot_id, name, status, conclusion, created_at, head_sha, repo, repo_key, branch, workflow_name)
    VALUES (?, 'snap', 'ci', 'completed', 'success', ?, 'sha', 'repo', 'repo-key', 'main', 'workflow')
  `).run(id, createdAt)
}

function countTable(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
  return row.count
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'retention-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('runRetention', () => {
  it('prunes old snapshots while preserving the latest one', async () => {
    await initDb()

    insertSnapshot(makeSnapshot('snap-old-1', '2020-01-01T00:00:00.000Z'))
    insertSnapshot(makeSnapshot('snap-old-2', '2020-06-01T00:00:00.000Z'))
    insertSnapshot(makeSnapshot('snap-latest', '2026-06-18T12:00:00.000Z'))

    const result = runRetention({
      SECRET_HOUSE_RETENTION_SNAPSHOTS_DAYS: '30',
    } as NodeJS.ProcessEnv)

    expect(result.snapshotsDeleted).toBe(2)
    expect(getLatestSnapshot()?.id).toBe('snap-latest')
    expect(listSnapshots()).toHaveLength(1)
  })

  it('never deletes the latest snapshot even when cutoff is in the future', async () => {
    await initDb()

    insertSnapshot(makeSnapshot('snap-only', '2026-06-18T12:00:00.000Z'))

    const result = runRetention({
      SECRET_HOUSE_RETENTION_SNAPSHOTS_DAYS: '0',
    } as NodeJS.ProcessEnv)

    expect(getLatestSnapshot()?.id).toBe('snap-only')
    expect(listSnapshots()).toHaveLength(1)
  })

  it('prunes old daily metrics but keeps recent dashboard data', async () => {
    await initDb()

    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)

    const oldDate = new Date(today)
    oldDate.setUTCDate(oldDate.getUTCDate() - 200)
    const oldDay = oldDate.toISOString().slice(0, 10)

    const recentDate = new Date(today)
    recentDate.setUTCDate(recentDate.getUTCDate() - 5)
    const recentDay = recentDate.toISOString().slice(0, 10)

    upsertDailyMetrics(makeDailyRow(oldDay))
    upsertDailyMetrics(makeDailyRow(recentDay))
    upsertDailyMetrics(makeDailyRow(todayStr))

    const result = runRetention({
      SECRET_HOUSE_RETENTION_DAILY_METRICS_DAYS: '90',
    } as NodeJS.ProcessEnv)

    expect(result.dailyMetricsDeleted).toBe(1)

    const remaining = getDailyMetricsRange('2000-01-01', '2099-12-31')
    expect(remaining).toHaveLength(2)
    expect(remaining.map(r => r.day).sort()).toEqual([recentDay, todayStr].sort())
  })

  it('prunes old sessions but keeps recent ones', async () => {
    await initDb()
    const db = new Database(join(tmpDir, 'metrics.db'))

    insertRawSession(db, 'session-old', '2020-01-01T00:00:00.000Z')
    insertRawSession(db, 'session-recent', '2026-06-15T00:00:00.000Z')
    db.close()

    const result = runRetention({
      SECRET_HOUSE_RETENTION_SESSIONS_DAYS: '90',
    } as NodeJS.ProcessEnv)

    expect(result.sessionsDeleted).toBe(1)

    const dbAfter = new Database(join(tmpDir, 'metrics.db'))
    expect(countTable(dbAfter, 'source_sessions')).toBe(1)
    const remaining = dbAfter.prepare('SELECT id FROM source_sessions').get() as { id: string }
    expect(remaining.id).toBe('session-recent')
    dbAfter.close()
  })

  it('prunes old workflow runs but keeps recent ones', async () => {
    await initDb()
    const db = new Database(join(tmpDir, 'metrics.db'))

    insertRawWorkflowRun(db, 'run-old', '2020-01-01T00:00:00.000Z')
    insertRawWorkflowRun(db, 'run-recent', '2026-06-15T00:00:00.000Z')
    db.close()

    const result = runRetention({
      SECRET_HOUSE_RETENTION_WORKFLOW_RUNS_DAYS: '90',
    } as NodeJS.ProcessEnv)

    expect(result.workflowRunsDeleted).toBe(1)

    const dbAfter = new Database(join(tmpDir, 'metrics.db'))
    expect(countTable(dbAfter, 'source_workflow_runs')).toBe(1)
    const remaining = dbAfter.prepare('SELECT id FROM source_workflow_runs').get() as { id: string }
    expect(remaining.id).toBe('run-recent')
    dbAfter.close()
  })

  it('does not delete latest state or break cached reads', async () => {
    await initDb()

    const snap = makeSnapshot('snap-latest', '2026-06-18T12:00:00.000Z')
    persistSnapshot(snap)

    const beforeRetention = getLatestSnapshot()
    expect(beforeRetention?.id).toBe('snap-latest')

    runRetention()

    const afterRetention = getLatestSnapshot()
    expect(afterRetention?.id).toBe('snap-latest')
    expect(afterRetention?.capturedAt).toBe('2026-06-18T12:00:00.000Z')
  })

  it('returns zero counts on an empty database', async () => {
    await initDb()

    const result = runRetention()

    expect(result).toEqual({
      snapshotsDeleted: 0,
      aggregatesDeleted: 0,
      dailyMetricsDeleted: 0,
      sessionsDeleted: 0,
      workflowRunsDeleted: 0,
    })
  })

  it('respects configurable retention thresholds', async () => {
    await initDb()

    const today = new Date()
    const day45 = new Date(today)
    day45.setUTCDate(day45.getUTCDate() - 45)
    const day45Str = day45.toISOString().slice(0, 10)

    const day15 = new Date(today)
    day15.setUTCDate(day15.getUTCDate() - 15)
    const day15Str = day15.toISOString().slice(0, 10)

    upsertDailyMetrics(makeDailyRow(day45Str))
    upsertDailyMetrics(makeDailyRow(day15Str))

    const strictResult = runRetention({
      SECRET_HOUSE_RETENTION_DAILY_METRICS_DAYS: '30',
    } as NodeJS.ProcessEnv)
    expect(strictResult.dailyMetricsDeleted).toBe(1)

    upsertDailyMetrics(makeDailyRow(day45Str))

    const looseResult = runRetention({
      SECRET_HOUSE_RETENTION_DAILY_METRICS_DAYS: '60',
    } as NodeJS.ProcessEnv)
    expect(looseResult.dailyMetricsDeleted).toBe(0)
  })

  it('prunes aggregates tied to old snapshots while preserving latest snapshot aggregates', async () => {
    await initDb()

    insertSnapshot(makeSnapshot('snap-old', '2020-01-01T00:00:00.000Z'))
    insertSnapshot(makeSnapshot('snap-new', '2026-06-18T12:00:00.000Z'))

    const db = new Database(join(tmpDir, 'metrics.db'))
    db.prepare(`
      INSERT INTO aggregates (id, type, period_start, period_end, data, snapshot_id)
      VALUES ('agg-old', 'throughput', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '{}', 'snap-old')
    `).run()
    db.prepare(`
      INSERT INTO aggregates (id, type, period_start, period_end, data, snapshot_id)
      VALUES ('agg-new', 'throughput', '2026-06-18T00:00:00.000Z', '2026-06-18T12:00:00.000Z', '{}', 'snap-new')
    `).run()
    db.close()

    const result = runRetention({
      SECRET_HOUSE_RETENTION_SNAPSHOTS_DAYS: '30',
    } as NodeJS.ProcessEnv)

    expect(result.snapshotsDeleted).toBe(1)
    expect(result.aggregatesDeleted).toBe(1)

    const dbAfter = new Database(join(tmpDir, 'metrics.db'))
    expect(countTable(dbAfter, 'snapshots')).toBe(1)
    expect(countTable(dbAfter, 'aggregates')).toBe(1)
    const remainingAgg = dbAfter.prepare('SELECT id FROM aggregates').get() as { id: string }
    expect(remainingAgg.id).toBe('agg-new')
    dbAfter.close()
  })
})
