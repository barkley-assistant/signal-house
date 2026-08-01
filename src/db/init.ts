/**
 * Schema initialization.
 *
 * V2 is a FRESH start (user decision 2026-07-31: "no migrations, it's all
 * fresh"; planning decision 2026-07-24 #5). There is deliberately no V1→V2
 * migration path: V2 writes to its own database path and never opens a V1
 * database. As a safety guard, opening a file that looks like a V1 database
 * (contains the V1-only `daily_token_usage` table) throws a descriptive error
 * and leaves the file byte-identical — V2 will not casually destroy an
 * existing Signal House database, it just refuses to adopt it.
 *
 * `ensureSchema` is idempotent: re-running it on an initialized database is a
 * no-op (guarded by `PRAGMA user_version`).
 */

import { Database } from "bun:sqlite";
import { SCHEMA_VERSION, V2_DDL, V1_MARKER_TABLE } from "./schema";

export class V1DatabaseRefusedError extends Error {
  constructor(readonly dbPath: string) {
    super(
      `refusing to open ${dbPath}: this looks like a V1 Signal House database. ` +
        `V2 is a fresh rewrite with its own database — it does not migrate or share V1 data. ` +
        `Point DB_DIR at a fresh location (or move the old file aside).`,
    );
    this.name = "V1DatabaseRefusedError";
  }
}

/** True when the file at `path` appears to be a V1 Signal House database. */
export function looksLikeV1Database(db: Database): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(V1_MARKER_TABLE) as { name: string } | null | undefined;
  // bun:sqlite returns null (not undefined) for missing rows — treat both as absent.
  return row !== null && row !== undefined;
}

/** Create the V2 schema if needed; set user_version. Idempotent. */
export function ensureSchema(db: Database): void {
  const userVersion = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (userVersion >= SCHEMA_VERSION) return;

  db.transaction(() => {
    db.exec(V2_DDL);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}

/** Refuse to open a V1-shaped database. Call after opening, before ensureSchema. */
export function guardFreshDatabase(db: Database, path: string): void {
  if (looksLikeV1Database(db)) {
    db.close();
    throw new V1DatabaseRefusedError(path);
  }
}
