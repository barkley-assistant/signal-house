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
