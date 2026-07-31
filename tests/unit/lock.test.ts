import { describe, expect, test } from "bun:test";
import { openMemoryDatabase } from "../../src/db/client";
import { RefreshLock } from "../../src/orchestrator/lock";

describe("refresh lock", () => {
  test("acquire succeeds when idle, refuses while in progress", () => {
    const owner = openMemoryDatabase();
    const lock = new RefreshLock(owner.db, 600_000);
    const a = lock.acquire("manual");
    expect(a.ok).toBe(true);
    const b = lock.acquire("poller");
    expect(b.ok).toBe(false);
    if (a.ok) lock.release(a.token);
    const c = lock.acquire("manual");
    expect(c.ok).toBe(true);
    if (c.ok) lock.release(c.token);
    owner.close();
  });

  test("persisted lock survives a simulated crash (new lock instance sees it)", () => {
    const owner = openMemoryDatabase();
    const lock = new RefreshLock(owner.db, 600_000);
    const a = lock.acquire("poller");
    expect(a.ok).toBe(true);
    // simulate crash: no release; a NEW instance reads the same DB
    const lock2 = new RefreshLock(owner.db, 600_000);
    expect(lock2.acquire("manual").ok).toBe(false);
    owner.close();
  });

  test("stale lock is stealable (fresh instance simulates a crashed owner)", () => {
    const owner = openMemoryDatabase();
    const lock = new RefreshLock(owner.db, 1000);
    const a = lock.acquire("manual");
    expect(a.ok).toBe(true);
    // force staleness: rewrite the persisted lock with an old timestamp
    owner.db.query("UPDATE refresh_meta SET value = json_set(value, '$.acquiredAt', ?) WHERE key = 'refresh_lock'").run(Date.now() - 5000);
    // a NEW instance (the next process after a crash) sees the stale lock and steals it
    const lock2 = new RefreshLock(owner.db, 1000);
    const b = lock2.acquire("poller");
    expect(b.ok).toBe(true);
    if (a.ok) lock.release(a.token);
    if (b.ok) lock2.release(b.token);
    owner.close();
  });

  test("status reports stale vs active correctly", () => {
    const owner = openMemoryDatabase();
    const lock = new RefreshLock(owner.db, 1000);
    expect(lock.status().inProgress).toBe(false);
    lock.acquire("manual");
    expect(lock.status().inProgress).toBe(true);
    expect(lock.status().stale).toBe(false);
    owner.db.query("UPDATE refresh_meta SET value = json_set(value, '$.acquiredAt', ?) WHERE key = 'refresh_lock'").run(Date.now() - 5000);
    expect(lock.status().stale).toBe(true);
    owner.close();
  });

  test("reset clears only lock state, never data", () => {
    const owner = openMemoryDatabase();
    const lock = new RefreshLock(owner.db, 600_000);
    lock.acquire("manual");
    expect(lock.status().inProgress).toBe(true);
    lock.reset();
    expect(lock.status().inProgress).toBe(false);
    expect(lock.acquire("manual").ok).toBe(true);
    owner.close();
  });
});
