/**
 * Database owner — the single controlled access point for the primary DB.
 * WAL, foreign keys, busy timeout, schema init, and graceful close live here.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSchema, guardFreshDatabase } from "./init";

export class DatabaseOwner {
  private constructor(
    readonly db: Database,
    readonly path: string,
  ) {}

  /** Open (creating dirs as needed), configure pragmas, and initialize schema. */
  static open(path: string): DatabaseOwner {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    guardFreshDatabase(db, path); // never adopt a V1 database
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    ensureSchema(db);
    return new DatabaseOwner(db, path);
  }

  /** Wrap an already-configured Database (used by openMemoryDatabase). */
  static fromRaw(db: Database, path: string): DatabaseOwner {
    return new DatabaseOwner(db, path);
  }

  /** Run `fn` inside one immediate transaction; rollback on throw. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /** Checkpoint WAL and close. Safe to call twice. */
  close(): void {
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // already closed or checkpoint refused — nothing to do
    }
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

/** Create an in-memory V2 database for tests (no file, schema applied). */
export function openMemoryDatabase(): DatabaseOwner {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);
  return DatabaseOwner.fromRaw(db, ":memory:");
}
