export const SCHEMA_VERSION = 1

export const SQL = {

  createTables: `
    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      data        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aggregates (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end   TEXT NOT NULL,
      data         TEXT NOT NULL,
      snapshot_id  TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS latest_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
      ON snapshots(captured_at DESC);

    CREATE INDEX IF NOT EXISTS idx_aggregates_type
      ON aggregates(type);

    CREATE INDEX IF NOT EXISTS idx_aggregates_period
      ON aggregates(period_start, period_end);
  `,

  insertSnapshot: `
    INSERT INTO snapshots (id, captured_at, data, version)
    VALUES (@id, @capturedAt, @data, @version)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      version = excluded.version,
      captured_at = excluded.captured_at;
  `,

  getLatestSnapshot: `
    SELECT * FROM snapshots
    ORDER BY captured_at DESC
    LIMIT 1;
  `,

  listSnapshots: `
    SELECT * FROM snapshots
    ORDER BY captured_at DESC
    LIMIT @limit OFFSET @offset;
  `,

  insertAggregate: `
    INSERT INTO aggregates (id, type, period_start, period_end, data, snapshot_id)
    VALUES (@id, @type, @periodStart, @periodEnd, @data, @snapshotId)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data;
  `,

  getAggregatesByType: `
    SELECT * FROM aggregates
    WHERE type = @type
    ORDER BY period_start DESC
    LIMIT @limit;
  `,

  upsertLatestState: `
    INSERT INTO latest_state (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `,

  getLatestState: `
    SELECT value FROM latest_state
    WHERE key = @key;
  `,

  deleteSnapshotsOlderThan: `
    DELETE FROM snapshots
    WHERE captured_at < @before;
  `,

  deleteAggregatesOlderThan: `
    DELETE FROM aggregates
    WHERE period_end < @before;
  `,

}

export type QueryName = keyof typeof SQL
