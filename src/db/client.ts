/**
 * Database owner — the single controlled access point for the primary DB.
 * WAL, foreign keys, busy timeout, schema init, and graceful close live here.
 */

import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSchema, guardFreshDatabase, looksLikeV1Database, V1DatabaseRefusedError } from "./init";

export class DatabaseOwner {
  private constructor(
    readonly db: Database,
    readonly path: string,
  ) {}

  /** Open (creating dirs as needed), configure pragmas, and initialize schema. */
  static open(path: string): DatabaseOwner {
    mkdirSync(dirname(path), { recursive: true });
    // Sniff an existing file READ-ONLY before opening for write: if it is a V1
    // database we refuse WITHOUT creating or modifying anything (no artifacts).
    if (existsSync(path)) {
      const sniff = new Database(path, { readonly: true, create: false });
      const v1 = looksLikeV1Database(sniff);
      sniff.close();
      if (v1) throw new V1DatabaseRefusedError(path);
    }
    const db = new Database(path);
    guardFreshDatabase(db, path);
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

  /** Run `fn` inside one transaction (native bun:sqlite); rollback on throw. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
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
