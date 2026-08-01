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
