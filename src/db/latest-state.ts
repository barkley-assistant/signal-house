/** latest_state repository — per-source last-good state, read by /api/state. */

import type { Database } from "bun:sqlite";
import type { PersistedState } from "../config/types";

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

interface ParsedStatesCache {
  db: Database;
  version: string;
  states: PersistedState[];
}

// /api/state and /api/diagnostics both JSON.parse every per-source blob on
// each request — with a 30s client poll that is wasted work. The blobs only
// change when a refresh writes latest_state, so cache the parsed result keyed
// on the newest row's `updated` timestamp (which setLatestState bumps per
// refresh). The `db` identity guard keeps tests that use separate in-memory
// databases from reading each other's cache entries.
let parsedStatesCache: ParsedStatesCache | null = null;

/** Parse all latest_state rows, memoized until a refresh writes a newer row. */
export function parsedLatestStates(db: Database): PersistedState[] {
  const versionRow = db.query("SELECT MAX(updated) AS v FROM latest_state").get() as { v: number | null } | null;
  const version = versionRow && versionRow.v !== null ? String(versionRow.v) : "";
  if (parsedStatesCache && parsedStatesCache.db === db && parsedStatesCache.version === version) {
    return parsedStatesCache.states;
  }
  const states = getAllLatestState(db)
    .map((row) => JSON.parse(row.data) as PersistedState)
    .filter((s) => s.ok && s.data !== null);
  parsedStatesCache = { db, version, states };
  return states;
}
