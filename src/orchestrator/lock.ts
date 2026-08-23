/**
 * Refresh lock — one in-process guard + persisted metadata for crash recovery.
 *
 * The persisted row survives a process crash; staleness is age-based
 * (config.refresh.lockStaleMs). A stale lock can be stolen by the next
 * refresh or cleared via POST /api/refresh/reset-lock. Reset only ever clears
 * the lock row — never snapshots, metrics, or cached state.
 */

import type { Database } from "bun:sqlite";
import { getRefreshMeta, setRefreshMeta, deleteRefreshMeta } from "../db/refresh-meta";
import { log } from "../shared/logger";

export type LockOwner = "manual" | "poller";

export interface PersistedLock {
  token: string;
  owner: LockOwner;
  acquiredAt: number;
}

export interface LockStatus {
  inProgress: boolean;
  owner: LockOwner | null;
  acquiredAt: number | null;
  stale: boolean;
}

export class RefreshLock {
  private readonly KEY = "refresh_lock";
  private inProcess = false;

  constructor(
    private readonly db: Database,
    private readonly staleMs: number,
  ) {}

  status(): LockStatus {
    const persisted = getRefreshMeta<PersistedLock>(this.db, this.KEY);
    if (!persisted) return { inProgress: this.inProcess, owner: null, acquiredAt: null, stale: false };
    const stale = Date.now() - persisted.acquiredAt > this.staleMs;
    return {
      inProgress: this.inProcess || !stale,
      owner: persisted.owner,
      acquiredAt: persisted.acquiredAt,
      stale,
    };
  }

  /** Try to acquire. Refuses while another refresh is live; steals stale locks. */
  acquire(owner: LockOwner): { ok: true; token: string } | { ok: false; reason: "in_progress" } {
    const current = getRefreshMeta<PersistedLock>(this.db, this.KEY);
    if (this.inProcess || (current && !this.isStale(current))) {
      return { ok: false, reason: "in_progress" };
    }
    const token = crypto.randomUUID();
    this.inProcess = true;
    setRefreshMeta(this.db, this.KEY, { token, owner, acquiredAt: Date.now() });
    return { ok: true, token };
  }

  release(token: string): void {
    const current = getRefreshMeta<PersistedLock>(this.db, this.KEY);
    if (current && current.token === token) deleteRefreshMeta(this.db, this.KEY);
    this.inProcess = false;
  }

  /** Narrowly scoped reset: clears only lock state. */
  reset(): void {
    deleteRefreshMeta(this.db, this.KEY);
    this.inProcess = false;
  }

  /**
   * Clear a persisted lock left behind by a previous process (crash or
   * SIGTERM mid-refresh). Safe at startup: no refresh can legitimately be
   * running — the process that would hold it just died. Without this, the
   * stale-lock window (config.refresh.lockStaleMs, default 10 min) blocks
   * every poller tick after an unlucky deploy.
   */
  clearOrphanedAtStartup(): void {
    if (this.inProcess) return; // our own pass is live — never steal it
    const persisted = getRefreshMeta<PersistedLock>(this.db, this.KEY);
    if (persisted) {
      deleteRefreshMeta(this.db, this.KEY);
      log.info("lock", "cleared orphaned refresh lock from previous process");
    }
  }

  private isStale(lock: PersistedLock): boolean {
    return Date.now() - lock.acquiredAt > this.staleMs;
  }
}
