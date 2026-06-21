import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { initDb, upsertDailyMetrics, getDailyMetricsRange, getDailyMetricsRangeForRepo, getLatestDailyDay, getLatestDailyDayForRepo, close } from '../client'
import type { DailyMetricsInsert } from '../../../types/daily-metrics'

let tmpDir: string

function makeRow(day: string, overrides: Partial<DailyMetricsInsert> = {}): DailyMetricsInsert {
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'daily-metrics-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('daily_metrics table', () => {
  it('inserts a daily metrics row and retrieves it', async () => {
    await initDb()
    const row = makeRow('2026-06-01', {
      issuesOpened: 5,
      issuesClosed: 3,
      prsCreated: 2,
      prsMerged: 1,
      totalCommits: 20,
    })
    upsertDailyMetrics(row)

    const results = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.day).toBe('2026-06-01')
    expect(results[0]!.repoKey).toBe('all')
    expect(results[0]!.issuesOpened).toBe(5)
    expect(results[0]!.issuesClosed).toBe(3)
    expect(results[0]!.prsCreated).toBe(2)
    expect(results[0]!.prsMerged).toBe(1)
    expect(results[0]!.totalCommits).toBe(20)
    expect(results[0]!.source).toBe('test')
    expect(results[0]!.reflectsCompleteData).toBe(true)
  })

  it('overwrites an existing day on second insert (same-day overwrite)', async () => {
    await initDb()
    const row1 = makeRow('2026-06-01', { issuesOpened: 5, totalCommits: 20 })
    upsertDailyMetrics(row1)

    const row2 = makeRow('2026-06-01', { issuesOpened: 8, totalCommits: 25 })
    upsertDailyMetrics(row2)

    const results = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.issuesOpened).toBe(8)
    expect(results[0]!.totalCommits).toBe(25)
  })

  it('keeps distinct rows for different repo keys on the same day', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01', { repoKey: 'all', issuesOpened: 10 }))
    upsertDailyMetrics(makeRow('2026-06-01', { repoKey: 'github:demo/repo-a', issuesOpened: 3 }))
    upsertDailyMetrics(makeRow('2026-06-01', { repoKey: 'github:demo/repo-b', issuesOpened: 7 }))

    const allResults = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(allResults).toHaveLength(1)
    expect(allResults[0]!.repoKey).toBe('all')
    expect(allResults[0]!.issuesOpened).toBe(10)

    const repoAResults = getDailyMetricsRangeForRepo('2026-06-01', '2026-06-01', 'github:demo/repo-a')
    expect(repoAResults).toHaveLength(1)
    expect(repoAResults[0]!.issuesOpened).toBe(3)
  })

  it('preserves different days separately', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01', { issuesOpened: 3 }))
    upsertDailyMetrics(makeRow('2026-06-02', { issuesOpened: 7 }))
    upsertDailyMetrics(makeRow('2026-06-03', { issuesOpened: 1 }))

    const results = getDailyMetricsRange('2026-06-01', '2026-06-03')
    expect(results).toHaveLength(3)
    expect(results.find((r) => r.day === '2026-06-02')!.issuesOpened).toBe(7)
  })

  it('queries a date range returning only days that have data (missing days by omission)', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01', { repoKey: 'github:demo/repo-a' }))
    upsertDailyMetrics(makeRow('2026-06-03', { repoKey: 'github:demo/repo-a' }))
    upsertDailyMetrics(makeRow('2026-06-05', { repoKey: 'github:demo/repo-a' }))

    const results = getDailyMetricsRangeForRepo('2026-06-01', '2026-06-05', 'github:demo/repo-a')
    expect(results).toHaveLength(3)
    const days = results.map((r) => r.day).sort()
    expect(days).toEqual(['2026-06-01', '2026-06-03', '2026-06-05'])
  })

  it('returns empty array when no days in range', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01'))

    const results = getDailyMetricsRange('2026-06-10', '2026-06-20')
    expect(results).toHaveLength(0)
  })

  it('filters latest day by repo key when requested', async () => {
    await initDb()
    expect(getLatestDailyDayForRepo('github:demo/repo-a')).toBeNull()

    upsertDailyMetrics(makeRow('2026-06-01', { repoKey: 'github:demo/repo-a' }))
    upsertDailyMetrics(makeRow('2026-06-05', { repoKey: 'github:demo/repo-b' }))

    expect(getLatestDailyDayForRepo('github:demo/repo-a')).toBe('2026-06-01')
    expect(getLatestDailyDayForRepo('github:demo/repo-b')).toBe('2026-06-05')
    expect(getLatestDailyDay()).toBe('2026-06-05')
  })

  it('returns results in descending order', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01'))
    upsertDailyMetrics(makeRow('2026-06-02'))
    upsertDailyMetrics(makeRow('2026-06-03'))

    const results = getDailyMetricsRange('2026-06-01', '2026-06-03')
    expect(results.map((r) => r.day)).toEqual(['2026-06-03', '2026-06-02', '2026-06-01'])
  })

  it('getLatestDailyDay returns the latest day', async () => {
    await initDb()
    expect(getLatestDailyDay()).toBeNull()

    upsertDailyMetrics(makeRow('2026-06-01'))
    expect(getLatestDailyDay()).toBe('2026-06-01')

    upsertDailyMetrics(makeRow('2026-06-05'))
    expect(getLatestDailyDay()).toBe('2026-06-05')
  })

  it('stores and retrieves nullable numeric fields correctly', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01', {
      avgCycleTimeDays: 3.5,
      medianCycleTimeDays: 2.1,
      p95CycleTimeDays: 8.9,
      cycleTimeSampleSize: 10,
      ciPassRate: 0.85,
      ciAvgDurationMs: 1200,
    }))

    const results = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(results[0]!.avgCycleTimeDays).toBe(3.5)
    expect(results[0]!.medianCycleTimeDays).toBe(2.1)
    expect(results[0]!.p95CycleTimeDays).toBe(8.9)
    expect(results[0]!.cycleTimeSampleSize).toBe(10)
    expect(results[0]!.ciPassRate).toBe(0.85)
    expect(results[0]!.ciAvgDurationMs).toBe(1200)
  })

  it('stores and retrieves warnings array', async () => {
    await initDb()
    upsertDailyMetrics(makeRow('2026-06-01', {
      warnings: ['Partial data: GitHub rate limit exceeded', 'Session collector failed'],
    }))

    const results = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(results[0]!.warnings).toEqual([
      'Partial data: GitHub rate limit exceeded',
      'Session collector failed',
    ])
  })

  it('resets incompatible existing database state and starts cleanly', async () => {
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

      INSERT INTO latest_state (key, value, updated_at) VALUES ('schema_version', '2', datetime('now'));

      CREATE TABLE daily_metrics (
        day TEXT PRIMARY KEY,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'orchestrated',
        version INTEGER NOT NULL DEFAULT 1,
        reflects_complete_data INTEGER NOT NULL DEFAULT 0,
        issues_opened INTEGER NOT NULL DEFAULT 0,
        issues_closed INTEGER NOT NULL DEFAULT 0,
        prs_created INTEGER NOT NULL DEFAULT 0,
        prs_merged INTEGER NOT NULL DEFAULT 0,
        total_commits INTEGER NOT NULL DEFAULT 0,
        avg_cycle_time_days REAL,
        median_cycle_time_days REAL,
        p95_cycle_time_days REAL,
        cycle_time_sample_size INTEGER NOT NULL DEFAULT 0,
        ci_total_runs INTEGER NOT NULL DEFAULT 0,
        ci_pass_count INTEGER NOT NULL DEFAULT 0,
        ci_fail_count INTEGER NOT NULL DEFAULT 0,
        ci_pass_rate REAL,
        ci_avg_duration_ms REAL,
        total_sessions INTEGER NOT NULL DEFAULT 0,
        session_error_count INTEGER NOT NULL DEFAULT 0,
        stale_issues INTEGER NOT NULL DEFAULT 0,
        stale_prs INTEGER NOT NULL DEFAULT 0,
        warnings TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO daily_metrics (day, captured_at, source, issues_opened, warnings)
      VALUES ('2026-06-01', '2026-06-01T12:00:00Z', 'legacy', 4, '["legacy"]');
    `)
    legacyDb.close()

    await initDb()
    const results = getDailyMetricsRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(0)
  })
})
