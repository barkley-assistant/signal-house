import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DatabaseOwner, openMemoryDatabase } from "../../src/db/client";
import { V1DatabaseRefusedError, ensureSchema, looksLikeV1Database } from "../../src/db/init";
import { insertSnapshot, latestSnapshot, pruneSnapshots } from "../../src/db/snapshots";
import { setLatestState, getLatestState, parsedLatestStates } from "../../src/db/latest-state";
import { setRefreshMeta, getRefreshMeta, getRefreshMetaMany } from "../../src/db/refresh-meta";
import { replaceDayForSource, backfillDaysForSource, queryDailyMetrics } from "../../src/db/daily-metrics";
import { runRetention } from "../../src/db/retention";
import { SCHEMA_VERSION } from "../../src/db/schema";
import type { RuntimeConfig } from "../../src/config/types";

const baseConfig: RuntimeConfig = {
  dev: false,
  environment: "production",
  host: "0.0.0.0",
  port: 8999,
  db: { dir: "/tmp", file: "metrics.db", path: "/tmp/metrics.db" },
  auth: { username: "signal-house", password: "", enabled: false },
  github: { token: null, owner: null, repo: null },
  git: { repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: ["node_modules"] },
  hermes: { dbPath: "/tmp/hermes.db" },
  opencode: { dbPath: "/tmp/opencode.db" },
  usage: { periodDays: 30 },
  poller: { enabled: false, intervalSeconds: 300, startupDelaySeconds: 5, runOnStartup: true },
  orchestrator: { concurrency: 3, lookbackDays: 28, githubIntervalSeconds: 600 },
  staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
  retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
  privacy: { showPrivateRepoItems: false },
  refresh: { lockStaleMs: 600_000 },
    estimateCosts: false,
    hostMetrics: { enabled: false },
};

let dir: string;
let owner: DatabaseOwner | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-db-"));
});

afterEach(() => {
  owner?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("database", () => {
  test("fresh database initializes the V2 schema and user_version", () => {
    const path = join(dir, "metrics.db");
    owner = DatabaseOwner.open(path);
    const tables = owner.db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("daily_metrics");
    expect(names).toContain("snapshots");
    expect(names).toContain("latest_state");
    expect(names).toContain("refresh_meta");
    expect((owner.db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
  });

  test("re-initializing an existing V2 database is a no-op (idempotent)", () => {
    const path = join(dir, "metrics.db");
    owner = DatabaseOwner.open(path);
    setRefreshMeta(owner.db, "k", { v: 1 });
    const before = (owner.db.query("SELECT COUNT(*) AS n FROM refresh_meta").get() as { n: number }).n;
    ensureSchema(owner.db);
    const after = (owner.db.query("SELECT COUNT(*) AS n FROM refresh_meta").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  test("refuses to open a V1-shaped database and leaves the file untouched", () => {
    const path = join(dir, "v1.db");
    const db = new Database(path);
    db.exec("CREATE TABLE daily_token_usage (date TEXT PRIMARY KEY);");
    db.exec("CREATE TABLE snapshots (id TEXT PRIMARY KEY);");
    db.close();
    const before = readFileSync(path);
    expect(() => DatabaseOwner.open(path)).toThrow(V1DatabaseRefusedError);
    const after = readFileSync(path);
    expect(before.length).toBe(after.length);
    expect(existsSync(path)).toBe(true);
  });

  test("daily_metrics: same-day replace, earlier days refreshed only when values differ", () => {
    const owner2 = openMemoryDatabase();
    const db = owner2.db;
    replaceDayForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "sessions.total", value: 10, tags: {} },
    ]);
    backfillDaysForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "cost.total", value: 5, tags: {} },
    ]);
    // backfill on an earlier day must NOT clobber existing rows, but may add new metrics
    expect(queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes" }).length).toBe(2);

    // ...but a CHANGED value for an existing metric DOES refresh history
    // (upstream cost corrections, e.g. hermes estimated → actual).
    backfillDaysForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "cost.total", value: 7, tags: {} },
    ]);
    const updated = queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes", metric: "cost.total" });
    expect(updated[0].value).toBe(7);

    // An identical value is a no-op: observed_at does not move.
    const before = queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes", metric: "cost.total" });
    backfillDaysForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "cost.total", value: 7, tags: {} },
    ]);
    const after = queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes", metric: "cost.total" });
    expect(after[0].value).toBe(7);
    expect(after[0].observedAt).toBe(before[0].observedAt);

    // replace today's day entirely
    replaceDayForSource(db, "2026-07-31", "hermes", [
      { date: "2026-07-31", metric: "sessions.total", value: 3, tags: {} },
    ]);
    expect(queryDailyMetrics(db, { from: "2026-07-31", to: "2026-07-31", source: "hermes" }).length).toBe(1);
    // earlier day untouched (the replace only touches its own day)
    expect(queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes" }).length).toBe(2);
    owner2.close();
  });

  test("daily_metrics preserves null values (unknown ≠ zero)", () => {
    const owner2 = openMemoryDatabase();
    replaceDayForSource(owner2.db, "2026-07-31", "opencode", [
      { date: "2026-07-31", metric: "cost.total", value: null, tags: {} },
    ]);
    const rows = queryDailyMetrics(owner2.db, { from: "2026-07-31", to: "2026-07-31", source: "opencode" });
    expect(rows[0].value).toBeNull();
    owner2.close();
  });

  test("snapshot + latest_state persistence round-trips JSON", () => {
    const owner2 = openMemoryDatabase();
    const payload = { a: 1, nested: { b: [1, 2, 3] } };
    insertSnapshot(owner2.db, "github", 1_700_000_000_000, payload);
    const snap = latestSnapshot(owner2.db, "github");
    expect(snap).not.toBeNull();
    expect(JSON.parse(snap!.data)).toEqual(payload);

    setLatestState(owner2.db, "github", payload, 1_700_000_000_001);
    const state = getLatestState(owner2.db, "github");
    expect(JSON.parse(state!.data)).toEqual(payload);
    expect(state!.updated).toBe(1_700_000_000_001);
    owner2.close();
  });

  test("failed transaction rolls back atomically", () => {
    const owner2 = openMemoryDatabase();
    expect(() =>
      owner2.transaction(() => {
        setRefreshMeta(owner2.db, "t", 1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(getRefreshMeta(owner2.db, "t")).toBeNull();
    owner2.close();
  });

  test("retention prunes old snapshots and daily metrics, keeps recent", () => {
    const owner2 = openMemoryDatabase();
    const old = Date.now() - 100 * 86_400_000;
    insertSnapshot(owner2.db, "github", old, {});
    insertSnapshot(owner2.db, "github", Date.now(), {});
    replaceDayForSource(owner2.db, "2026-01-01", "hermes", [{ date: "2026-01-01", metric: "sessions.total", value: 1, tags: {} }]);
    replaceDayForSource(owner2.db, "2026-07-31", "hermes", [{ date: "2026-07-31", metric: "sessions.total", value: 2, tags: {} }]);

    const report = runRetention(owner2.db, { ...baseConfig, retention: { snapshotsDays: 30, dailyMetricsDays: 90 } });
    expect(report.prunedSnapshots).toBe(1);
    expect(latestSnapshot(owner2.db, "github")).not.toBeNull();
    const remainingDays = queryDailyMetrics(owner2.db, { from: "2026-01-01", to: "2026-07-31" }).map((r) => r.date);
    expect(remainingDays).not.toContain("2026-01-01");
    expect(remainingDays).toContain("2026-07-31");
    owner2.close();
  });
});

describe("parsedLatestStates cache", () => {
  test("returns parsed states from fresh writes", () => {
    const owner = openMemoryDatabase();
    setLatestState(owner.db, "github", { source: "github", ok: true, data: { issues: [] } }, 1000);
    const states = parsedLatestStates(owner.db);
    expect(states).toHaveLength(1);
    expect(states[0].source).toBe("github");
    owner.close();
  });

  test("returns cached version on second call without writes", () => {
    const owner = openMemoryDatabase();
    setLatestState(owner.db, "github", { source: "github", ok: true, data: { issues: [] } }, 1000);
    const first = parsedLatestStates(owner.db);
    const second = parsedLatestStates(owner.db);
    // Same object identity — the cache was hit
    expect(second).toBe(first);
    owner.close();
  });

  test("invalidates after a new write", () => {
    const owner = openMemoryDatabase();
    const source = { source: "github", ok: true, data: { issues: [] } };
    setLatestState(owner.db, "github", source, 1000);
    const first = parsedLatestStates(owner.db);
    setLatestState(owner.db, "github", { source: "github", ok: true, data: { issues: [], pulls: [] } }, 2000);
    const second = parsedLatestStates(owner.db);
    expect(second).not.toBe(first);
    expect(second[0].data).toHaveProperty("pulls");
    owner.close();
  });

  test("filters out non-ok states", () => {
    const owner = openMemoryDatabase();
    setLatestState(owner.db, "github", { source: "github", ok: false, data: null }, 1000);
    setLatestState(owner.db, "hermes", { source: "hermes", ok: true, data: { usage: null } }, 1000);
    const states = parsedLatestStates(owner.db);
    expect(states).toHaveLength(1);
    expect(states[0].source).toBe("hermes");
    owner.close();
  });
});

describe("getRefreshMetaMany batch reader", () => {
  test("reads multiple keys in one query", () => {
    const owner = openMemoryDatabase();
    setRefreshMeta(owner.db, "a", 1, 1000);
    setRefreshMeta(owner.db, "b", "hello", 1000);
    setRefreshMeta(owner.db, "c", { x: 1 }, 1000);
    const map = getRefreshMetaMany(owner.db, ["a", "b", "c"]);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe("hello");
    expect((map.get("c") as Record<string, unknown>).x).toBe(1);
    owner.close();
  });

  test("missing keys are absent from the map", () => {
    const owner = openMemoryDatabase();
    setRefreshMeta(owner.db, "a", 1, 1000);
    const map = getRefreshMetaMany(owner.db, ["a", "nope"]);
    expect(map.get("a")).toBe(1);
    expect(map.has("nope")).toBe(false);
    owner.close();
  });

  test("returns empty map for empty keys list", () => {
    const owner = openMemoryDatabase();
    expect(getRefreshMetaMany(owner.db, []).size).toBe(0);
    owner.close();
  });
});
