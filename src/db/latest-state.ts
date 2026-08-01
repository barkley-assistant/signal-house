/** latest_state repository — per-source last-good state, read by /api/state. */

import type { Database } from "bun:sqlite";

export interface LatestStateRow {
  source: string;
  data: string;
  updated: number;
}

export function setLatestState(db: Database, source: string, data: unknown, updated: number): void {
  db.query("INSERT OR REPLACE INTO latest_state (source, data, updated) VALUES (?, ?, ?)").run(
    source,
    JSON.stringify(data),
    updated,
  );
}

export function getLatestState(db: Database, source: string): LatestStateRow | null {
  const row = db.query("SELECT source, data, updated FROM latest_state WHERE source = ?").get(source) as
    | LatestStateRow
    | undefined;
  return row ?? null;
}

export function getAllLatestState(db: Database): LatestStateRow[] {
  return db.query("SELECT source, data, updated FROM latest_state").all() as LatestStateRow[];
}
