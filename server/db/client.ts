import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SQL, SCHEMA_VERSION } from './schema'
import type { MetricSnapshot, SnapshotRow, LatestState, RefreshRunRecord, RefreshRunState, RefreshSourceHealth, RefreshRunStatus } from '../../types/snapshot'
import type { AggregateType } from '../../types/aggregates'
import type { DailyMetricsInsert, DailyMetricsRow } from '../../types/daily-metrics'

let _db: SqlJsDatabase | null = null

function getDbDir(): string {
  return process.env['DB_DIR'] || join(process.cwd(), '.data')
}

function getDbPath(): string {
  return join(getDbDir(), 'metrics.db')
}

const REFRESH_STATE_KEY = 'refresh_state'
const MAX_REFRESH_HISTORY = 10

function emptyRefreshState(): RefreshRunState {
  return {
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
  }
}

function parseRefreshState(value: string | null): RefreshRunState {
  if (!value) return emptyRefreshState()
  try {
    const parsed = JSON.parse(value) as Partial<RefreshRunState>
    return {
      ...emptyRefreshState(),
      ...parsed,
      sourceHealth: parsed.sourceHealth ?? {},
      runHistory: Array.isArray(parsed.runHistory) ? parsed.runHistory.slice(0, MAX_REFRESH_HISTORY) as RefreshRunRecord[] : [],
    }
  } catch {
    return emptyRefreshState()
  }
}

function saveRefreshState(state: RefreshRunState): void {
  const db = getDb()
  db.run(SQL.upsertLatestState, {
    '@key': REFRESH_STATE_KEY,
    '@value': JSON.stringify({
      ...state,
      runHistory: state.runHistory.slice(0, MAX_REFRESH_HISTORY),
    }),
  })
  save()
}

function buildSourceHealth(sources: string[], status: RefreshRunStatus, errorSummary: string | null): Record<string, RefreshSourceHealth> {
  const health: Record<string, RefreshSourceHealth> = {}
  for (const source of sources) {
    health[source] = {
      status: status === 'success' ? 'healthy' : status === 'skipped' ? 'unknown' : 'degraded',
      message: errorSummary,
    }
  }
  return health
}

export async function initDb(): Promise<SqlJsDatabase> {
  if (_db) return _db
  const dbDir = getDbDir()
  const dbPath = getDbPath()
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  const SQL = await initSqlJs()
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    _db = new SQL.Database(buffer)
  } else {
    _db = new SQL.Database()
  }
  migrate(_db)
  save()
  return _db
}

function migrate(db: SqlJsDatabase): void {
  db.run(SQL.createTables)
  const stmt = db.prepare(
    `SELECT value FROM latest_state WHERE key = 'schema_version'`
  )
  const current = stmt.step() ? Number(stmt.getAsObject().value) : 0
  stmt.free()
  if (current < SCHEMA_VERSION) {
    db.run(SQL.upsertLatestState, {
      '@key': 'schema_version',
      '@value': String(SCHEMA_VERSION),
    })
  }
}

export function save(): void {
  if (!_db) return
  const data = _db.export()
  writeFileSync(getDbPath(), Buffer.from(data))
}

export function close(): void {
  if (_db) {
    save()
    _db.close()
    _db = null
  }
}

export function insertSnapshot(snapshot: MetricSnapshot): void {
  const db = getDb()
  db.run(SQL.insertSnapshot, {
    '@id': snapshot.id,
    '@capturedAt': snapshot.capturedAt,
    '@data': JSON.stringify(snapshot),
    '@version': SCHEMA_VERSION,
  })
  db.run(SQL.upsertLatestState, {
    '@key': 'last_successful_refresh',
    '@value': snapshot.capturedAt,
  })
  save()
}

export function getLatestSnapshot(): MetricSnapshot | null {
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestSnapshot)
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as SnapshotRow
  stmt.free()
  return JSON.parse(row.data) as MetricSnapshot
}

export function listSnapshots(limit = 10, offset = 0): SnapshotRow[] {
  const db = getDb()
  const stmt = db.prepare(SQL.listSnapshots)
  stmt.bind({ '@limit': limit, '@offset': offset })
  const rows: SnapshotRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as SnapshotRow)
  }
  stmt.free()
  return rows
}

export function insertAggregate(
  id: string,
  type: AggregateType,
  periodStart: string,
  periodEnd: string,
  data: unknown,
  snapshotId: string,
): void {
  const db = getDb()
  db.run(SQL.insertAggregate, {
    '@id': id,
    '@type': type,
    '@periodStart': periodStart,
    '@periodEnd': periodEnd,
    '@data': JSON.stringify(data),
    '@snapshotId': snapshotId,
  })
  save()
}

export function getAggregatesByType(type: AggregateType, limit = 10): unknown[] {
  const db = getDb()
  const stmt = db.prepare(SQL.getAggregatesByType)
  stmt.bind({ '@type': type, '@limit': limit })
  const results: unknown[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as { data: string }
    results.push(JSON.parse(row.data))
  }
  stmt.free()
  return results
}

export function setRefreshInProgress(inProgress: boolean): void {
  const db = getDb()
  db.run(SQL.upsertLatestState, {
    '@key': 'refresh_in_progress',
    '@value': inProgress ? 'true' : 'false',
  })
  save()
}

export function getRefreshInProgress(): boolean {
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestState)
  stmt.bind({ '@key': 'refresh_in_progress' })
  const result = stmt.step() ? String(stmt.getAsObject().value) : 'false'
  stmt.free()
  return result === 'true'
}

export function getLatestState(): LatestState {
  const snapshot = getLatestSnapshot()
  const db = getDb()

  const keyStmt = db.prepare(SQL.getLatestState)
  keyStmt.bind({ '@key': 'last_successful_refresh' })
  const lastRefresh = keyStmt.step() ? String(keyStmt.getAsObject().value) : null
  keyStmt.free()

  const refreshInProgress = getRefreshInProgress()
  const refreshStateStmt = db.prepare(SQL.getLatestState)
  refreshStateStmt.bind({ '@key': REFRESH_STATE_KEY })
  const refreshStateValue = refreshStateStmt.step() ? String(refreshStateStmt.getAsObject().value) : null
  refreshStateStmt.free()
  const refreshState = parseRefreshState(refreshStateValue)

  const STALE_THRESHOLD_MS = 15 * 60 * 1000
  let isStale = true
  if (lastRefresh) {
    const elapsed = Date.now() - new Date(lastRefresh).getTime()
    isStale = elapsed > STALE_THRESHOLD_MS
  }

  return {
    snapshot,
    lastRefreshAt: lastRefresh,
    lastSuccessfulRefreshAt: lastRefresh,
    refreshInProgress,
    isStale,
    dashboardWindow: null,
    refreshState,
  }
}

export function setRefreshRunState(record: RefreshRunRecord): void {
  const previous = getRefreshRunState()
  const nextState: RefreshRunState = {
    ...previous,
    status: record.skipped ? 'skipped' : record.success ? 'success' : 'failed',
    lastRunStartedAt: record.startedAt,
    lastRunFinishedAt: record.finishedAt,
    lastSuccessAt: record.success ? record.finishedAt : previous.lastSuccessAt,
    lastFailureAt: record.success ? previous.lastFailureAt : record.finishedAt,
    nextRunAt: null,
    lastError: record.errorSummary,
    durationMs: record.durationMs,
    sourceHealth: buildSourceHealth(record.sources, record.skipped ? 'skipped' : record.success ? 'success' : 'failed', record.errorSummary),
    runHistory: [record, ...previous.runHistory].slice(0, MAX_REFRESH_HISTORY),
  }

  saveRefreshState(nextState)
}

export function setRefreshRunStatus(status: RefreshRunStatus, nextRunAt: string | null = null): void {
  const previous = getRefreshRunState()
  saveRefreshState({
    ...previous,
    status,
    nextRunAt,
  })
}

export function getRefreshRunState(): RefreshRunState {
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestState)
  stmt.bind({ '@key': REFRESH_STATE_KEY })
  const value = stmt.step() ? String(stmt.getAsObject().value) : null
  stmt.free()
  return parseRefreshState(value)
}

export function upsertDailyMetrics(row: DailyMetricsInsert): void {
  const db = getDb()
  db.run(SQL.upsertDailyMetrics, {
    '@day': row.day,
    '@capturedAt': row.capturedAt,
    '@source': row.source,
    '@version': SCHEMA_VERSION,
    '@reflectsCompleteData': row.reflectsCompleteData ? 1 : 0,
    '@issuesOpened': row.issuesOpened,
    '@issuesClosed': row.issuesClosed,
    '@prsCreated': row.prsCreated,
    '@prsMerged': row.prsMerged,
    '@totalCommits': row.totalCommits,
    '@avgCycleTimeDays': row.avgCycleTimeDays,
    '@medianCycleTimeDays': row.medianCycleTimeDays,
    '@p95CycleTimeDays': row.p95CycleTimeDays,
    '@cycleTimeSampleSize': row.cycleTimeSampleSize,
    '@ciTotalRuns': row.ciTotalRuns,
    '@ciPassCount': row.ciPassCount,
    '@ciFailCount': row.ciFailCount,
    '@ciPassRate': row.ciPassRate,
    '@ciAvgDurationMs': row.ciAvgDurationMs,
    '@totalSessions': row.totalSessions,
    '@sessionErrorCount': row.sessionErrorCount,
    '@staleIssues': row.staleIssues,
    '@stalePrs': row.stalePrs,
    '@warnings': JSON.stringify(row.warnings),
  })
  save()
}

function rowToDailyMetrics(row: Record<string, unknown>): DailyMetricsRow {
  return {
    day: String(row.day),
    capturedAt: String(row.captured_at),
    source: String(row.source),
    version: Number(row.version),
    reflectsCompleteData: Number(row.reflects_complete_data) === 1,
    issuesOpened: Number(row.issues_opened),
    issuesClosed: Number(row.issues_closed),
    prsCreated: Number(row.prs_created),
    prsMerged: Number(row.prs_merged),
    totalCommits: Number(row.total_commits),
    avgCycleTimeDays: row.avg_cycle_time_days != null ? Number(row.avg_cycle_time_days) : null,
    medianCycleTimeDays: row.median_cycle_time_days != null ? Number(row.median_cycle_time_days) : null,
    p95CycleTimeDays: row.p95_cycle_time_days != null ? Number(row.p95_cycle_time_days) : null,
    cycleTimeSampleSize: Number(row.cycle_time_sample_size),
    ciTotalRuns: Number(row.ci_total_runs),
    ciPassCount: Number(row.ci_pass_count),
    ciFailCount: Number(row.ci_fail_count),
    ciPassRate: row.ci_pass_rate != null ? Number(row.ci_pass_rate) : null,
    ciAvgDurationMs: row.ci_avg_duration_ms != null ? Number(row.ci_avg_duration_ms) : null,
    totalSessions: Number(row.total_sessions),
    sessionErrorCount: Number(row.session_error_count),
    staleIssues: Number(row.stale_issues),
    stalePrs: Number(row.stale_prs),
    warnings: JSON.parse(String(row.warnings)),
    createdAt: String(row.created_at),
  }
}

export function getDailyMetricsRange(fromDay: string, toDay: string): DailyMetricsRow[] {
  const db = getDb()
  const stmt = db.prepare(SQL.getDailyMetricsRange)
  stmt.bind({ '@fromDay': fromDay, '@toDay': toDay })
  const rows: DailyMetricsRow[] = []
  while (stmt.step()) {
    rows.push(rowToDailyMetrics(stmt.getAsObject() as Record<string, unknown>))
  }
  stmt.free()
  return rows
}

export function getLatestDailyDay(): string | null {
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestDailyDay)
  const result = stmt.step() ? String(stmt.getAsObject().day) : null
  stmt.free()
  return result
}

export function prune(before: string): void {
  const db = getDb()
  db.run(SQL.deleteSnapshotsOlderThan, { '@before': before })
  db.run(SQL.deleteAggregatesOlderThan, { '@before': before })
  save()
}

function getDb(): SqlJsDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.')
  return _db
}
