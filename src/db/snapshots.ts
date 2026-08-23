/** Snapshots repository — per-source raw data, append-mostly. */

import type { Database } from "bun:sqlite";

export interface SnapshotRow {
  id: number;
  source: string;
  captured_at: number;
  data: string;
}

export function insertSnapshot(db: Database, source: string, capturedAt: number, data: unknown): number {
  const result = db
    .query("INSERT INTO snapshots (source, captured_at, data) VALUES (?, ?, ?)")
    .run(source, capturedAt, JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

/**
 * Snapshot write with change-detection (issue #361 phase 2): when the payload
 * is byte-identical to this source's most recent snapshot, the insert is
 * skipped and `null` returned. At a 2-minute poll cadence the vast majority
 * of passes see unchanged data — writing ~720 identical rows per source per
 * day was pure churn (DB growth + WAL pressure) with zero informational
 * value: an absent row means "same as previous", which the chart layer
 * already understands as carry-forward.
 *
 * latest_state is still written every pass by the caller — only the
 * append-only history is deduplicated.
 */
export function insertSnapshotIfChanged(db: Database, source: string, capturedAt: number, data: unknown): number | null {
  const serialized = JSON.stringify(data);
  const last = db
    .query("SELECT data FROM snapshots WHERE source = ? ORDER BY captured_at DESC LIMIT 1")
    .get(source) as { data: string } | undefined;
  if (last && last.data === serialized) return null;
  const result = db
    .query("INSERT INTO snapshots (source, captured_at, data) VALUES (?, ?, ?)")
    .run(source, capturedAt, serialized);
  return Number(result.lastInsertRowid);
}

export function latestSnapshot(db: Database, source: string): SnapshotRow | null {
  const row = db
    .query("SELECT id, source, captured_at, data FROM snapshots WHERE source = ? ORDER BY captured_at DESC LIMIT 1")
    .get(source) as SnapshotRow | undefined;
  return row ?? null;
}

export function pruneSnapshots(db: Database, cutoffMs: number): number {
  const result = db.query("DELETE FROM snapshots WHERE captured_at < ?").run(cutoffMs);
  return result.changes;
}
