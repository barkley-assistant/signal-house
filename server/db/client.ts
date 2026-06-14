import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SQL, SCHEMA_VERSION } from './schema'
import type { MetricSnapshot, SnapshotRow, LatestState } from '../../types/snapshot'
import type { AggregateType } from '../../types/aggregates'

const DB_DIR = join(process.cwd(), '.data')
const DB_PATH = join(DB_DIR, 'metrics.db')

let _db: SqlJsDatabase | null = null

export async function initDb(): Promise<SqlJsDatabase> {
  if (_db) return _db
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true })
  }
  const SQL = await initSqlJs()
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    _db = new SQL.Database(buffer)
  } else {
    _db = new SQL.Database()
  }
  migrate(_db)
  save()
  return _db
}

function migrate(db: SqlJsDatabase): void {
  const stmt = db.prepare(
    `SELECT value FROM latest_state WHERE key = 'schema_version'`
  )
  const current = stmt.step() ? Number(stmt.getAsObject().value) : 0
  stmt.free()
  if (current < SCHEMA_VERSION) {
    db.run(SQL.createTables)
    db.run(SQL.upsertLatestState, {
      '@key': 'schema_version',
      '@value': String(SCHEMA_VERSION),
    })
  }
}

export function save(): void {
  if (!_db) return
  const data = _db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
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

export function getLatestState(): LatestState {
  const snapshot = getLatestSnapshot()
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestState)
  stmt.bind({ '@key': 'last_successful_refresh' })
  const lastRefresh = stmt.step() ? String(stmt.getAsObject().value) : null
  stmt.free()
  return {
    snapshot,
    lastRefreshAt: lastRefresh,
    lastSuccessfulRefreshAt: lastRefresh,
    refreshInProgress: false,
  }
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
