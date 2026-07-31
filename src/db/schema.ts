/**
 * V2 schema (fresh, per 03-fresh-schema-design.md).
 *
 * - `daily_metrics` is the unified daily rollup, keyed (date, source, metric, tags).
 *   `value REAL NULL` preserves the "absent day vs unknown value" distinction:
 *   a missing row = no upstream activity that day; `value NULL` = unknown for
 *   a day that otherwise has data.
 * - `snapshots` holds per-source raw data as JSON.
 * - `latest_state` is what /api/state reads per source.
 * - `refresh_meta` persists refresh/lock metadata (crash recovery).
 */

export const SCHEMA_VERSION = 1;

export const V2_DDL = `
CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  tags TEXT NOT NULL DEFAULT '{}',
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (date, source, metric, tags)
);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_lookup ON daily_metrics (source, metric, date);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_source_time ON snapshots (source, captured_at DESC);
CREATE TABLE IF NOT EXISTS latest_state (
  source TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refresh_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/** V1-only table name. Its presence marks a file as a legacy Signal House database. */
export const V1_MARKER_TABLE = "daily_token_usage";
