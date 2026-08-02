/** refresh_meta repository — persisted refresh/lock metadata (crash recovery). */

import type { Database } from "bun:sqlite";

export function getRefreshMeta<T = unknown>(db: Database, key: string): T | null {
  const row = db.query("SELECT value FROM refresh_meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** Read many refresh_meta keys in ONE query. /api/state reads 8 keys per
 *  request — 8 separate PK lookups was the previous hot path. Missing keys
 *  are absent from the map (distinct from a stored `null`, which is present). */
export function getRefreshMetaMany(db: Database, keys: string[]): Map<string, unknown> {
  if (keys.length === 0) return new Map();
  const placeholders = keys.map(() => "?").join(", ");
  const rows = db
    .query(`SELECT key, value FROM refresh_meta WHERE key IN (${placeholders})`)
    .all(...keys) as Array<{ key: string; value: string }>;
  const out = new Map<string, unknown>();
  for (const row of rows) {
    try {
      out.set(row.key, JSON.parse(row.value));
    } catch {
      out.set(row.key, null);
    }
  }
  return out;
}

export function setRefreshMeta(db: Database, key: string, value: unknown, updatedAt: number = Date.now()): void {
  db.query("INSERT OR REPLACE INTO refresh_meta (key, value, updated_at) VALUES (?, ?, ?)").run(
    key,
    JSON.stringify(value),
    updatedAt,
  );
}

export function deleteRefreshMeta(db: Database, key: string): void {
  db.query("DELETE FROM refresh_meta WHERE key = ?").run(key);
}
