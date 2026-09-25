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
import { replaceDayForSource, backfillDaysForSource, replaceDayModelsForSource, queryDailyMetrics, queryDailyTrend, queryDailyModelTrend, queryDailyModelShare } from "../../src/db/daily-metrics";
import { setPricingCachePath, resetPricingCache } from "../../src/server/model-pricing-fetcher";
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
  hermes: { dbPath: "/tmp/hermes.db", profilesDir: null },
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
  // Hermeticity: the openference fetch is auth-only; when the parent shell
  // exports the key, trend tests that resolve rates would hit the REAL
  // authenticated endpoint instead of the seeded cache. Keep it out.
  delete process.env.OPENFERENCE_API_KEY;
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

  test("daily_metrics: replaceDayModelsForSource deletes phantom model rows the collector no longer emits", () => {
    const owner2 = openMemoryDatabase();
    const db = owner2.db;
    // previous pass emitted two models; day totals survive independently
    backfillDaysForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "tokens.input", value: 1000, tags: {} },
      { date: "2026-07-30", metric: "model.tokens_input", value: 700, tags: { model: "Model-A" } },
      { date: "2026-07-30", metric: "model.tokens_input", value: 300, tags: { model: "Model-B" } },
      { date: "2026-07-30", metric: "model.sessions", value: 2, tags: { model: "Model-A" } },
    ]);
    // new pass: activity-split attribution moved Model-B's usage off this day
    const n = replaceDayModelsForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "model.tokens_input", value: 700, tags: { model: "Model-A" } },
      { date: "2026-07-30", metric: "model.sessions", value: 1, tags: { model: "Model-A" } },
    ]);
    expect(n).toBe(2);
    const rows = queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes" });
    const models = rows.filter((r) => r.metric.startsWith("model."));
    // Model-B phantom is gone; Model-A re-inserted; non-model rows untouched
    expect(models.map((r) => r.tags.model)).toEqual(["Model-A", "Model-A"]);
    expect(rows.find((r) => r.metric === "tokens.input")!.value).toBe(1000);

    // no model emission → history stays intact (upstream-pruned day contract)
    const before = queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes" }).length;
    expect(replaceDayModelsForSource(db, "2026-07-30", "hermes", [
      { date: "2026-07-30", metric: "tokens.input", value: 1000, tags: {} },
    ])).toBe(0);
    expect(queryDailyMetrics(db, { from: "2026-07-30", to: "2026-07-30", source: "hermes" }).length).toBe(before);
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

  describe("daily trend estimator lookup order (dated variant first)", () => {
    /** Seed the fetcher's OpenRouter-format cache file and warm it, exactly
     *  like tests/unit/model-pricing.test.ts does. The openference tier stays
     *  empty (no key in the test env), so these tests exercise the resolver
     *  chain through the OpenRouter tier only. */
    async function seedPricingCache(models: Record<string, { input: number; output: number; cacheRead: number }>) {
      const cachePath = join(dir, "model-pricing.json");
      writeFileSync(
        cachePath,
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          source: "https://test/seed",
          providerFilter: "openai",
          modelCount: Object.keys(models).length,
          models,
        }),
      );
      const { getModelPricing: fetcherGet } = await import("../../src/server/model-pricing-fetcher");
      await fetcherGet("__warmup__");
    }

    test("queryDailyTrend prices dated and bare spellings with their own rates", async () => {
      setPricingCachePath(join(dir, "model-pricing.json"));
      resetPricingCache();
      await seedPricingCache({
        "deepseek-v4-flash": { input: 0.07938, output: 0.15876, cacheRead: 0.015876 },
        "deepseek-v4-flash-0731": { input: 0.14, output: 0.28, cacheRead: 0.014 },
      });

      const owner2 = openMemoryDatabase();
      const db = owner2.db;
      const date = "2026-09-01";
      replaceDayForSource(db, date, "hermes", [
        { date, metric: "model.tokens_input", value: 1_000_000, tags: { model: "DeepSeek-V4-Flash-0731" } },
        { date, metric: "model.tokens_output", value: 1_000_000, tags: { model: "DeepSeek-V4-Flash-0731" } },
        { date, metric: "model.tokens_cache_read", value: 1_000_000, tags: { model: "DeepSeek-V4-Flash-0731" } },
        { date, metric: "model.tokens_input", value: 1_000_000, tags: { model: "DeepSeek-V4-Flash" } },
      ]);
      const trend = await queryDailyTrend(db, date, date, { rates: new Map(), enabled: true });
      expect(trend).toHaveLength(1);
      // dated row: (1M×0.14 + 1M×0.28 + 1M×0.014)/1M; bare row: (1M×0.07938)/1M
      expect(trend[0].cost).toBeCloseTo(0.14 + 0.28 + 0.014 + 0.07938, 6);
      owner2.close();
    });

    test("queryDailyModelTrend prices a dated-only model with its own dated rate", async () => {
      setPricingCachePath(join(dir, "model-pricing.json"));
      resetPricingCache();
      await seedPricingCache({
        "gpt-56-luna": { input: 1.0, output: 6.0, cacheRead: 1.0 },
        "gpt-56-luna-20250815": { input: 2.0, output: 12.0, cacheRead: 2.0 },
      });

      const owner2 = openMemoryDatabase();
      const db = owner2.db;
      const date = "2026-09-01";
      replaceDayForSource(db, date, "hermes", [
        { date, metric: "model.tokens_input", value: 1_000_000, tags: { model: "gpt-5.6-luna-20250815" } },
        { date, metric: "model.tokens_output", value: 1_000_000, tags: { model: "gpt-5.6-luna-20250815" } },
      ]);
      const trend = await queryDailyModelTrend(db, "gpt-56-luna-20250815", date, date, { rates: new Map(), enabled: true });
      expect(trend).toHaveLength(1);
      expect(trend[0].cost).toBeCloseTo(2.0 + 12.0, 6); // dated rate (2.0/12.0), not the base (1.0/6.0)
      owner2.close();
    });
  });

  describe("queryDailyModelShare top-N rollup", () => {
    test("ranks by window tokens, rolls the rest into Others, 0-fills every day", async () => {
      const owner2 = openMemoryDatabase();
      const db = owner2.db;
      // replaceDayForSource wipes the (date, source) day, so every day's
      // rows must be written in ONE call per date.
      const days = new Map<string, Array<{ date: string; metric: string; value: number; tags: { model: string } }>>();
      const seed: Array<{ date: string; model: string; input: number; output: number }> = [
        { date: "2026-09-01", model: "DeepSeek-V4-Pro", input: 1_000_000, output: 500_000 },
        { date: "2026-09-01", model: "deepseek-v4-flash", input: 300_000, output: 100_000 },
        { date: "2026-09-01", model: "gpt-6-sol-900k", input: 200_000, output: 100_000 },
        { date: "2026-09-01", model: "kimi-k2.7-code", input: 100_000, output: 50_000 },
        { date: "2026-09-01", model: "GLM-5.2", input: 90_000, output: 10_000 },
        { date: "2026-09-01", model: "mimo-v2.5", input: 80_000, output: 10_000 },
        { date: "2026-09-02", model: "DeepSeek-V4-Pro", input: 2_000_000, output: 1_000_000 },
        { date: "2026-09-02", model: "gpt-6-sol", input: 1_000_000, output: 500_000 },
        { date: "2026-09-02", model: "GLM-5.2", input: 500_000, output: 100_000 },
        { date: "2026-09-03", model: "DeepSeek-V4-Pro", input: 1_000_000, output: 1_000_000 },
        { date: "2026-09-03", model: "mimo-v2.5", input: 400_000, output: 100_000 },
      ];
      for (const row of seed) {
        const list = days.get(row.date) ?? [];
        list.push(
          { date: row.date, metric: "model.tokens_input", value: row.input, tags: { model: row.model } },
          { date: row.date, metric: "model.tokens_output", value: row.output, tags: { model: row.model } },
        );
        days.set(row.date, list);
      }
      for (const [date, rows] of days) {
        replaceDayForSource(db, date, "hermes", rows);
      }

      const points = await queryDailyModelShare(db, "2026-09-01", "2026-09-03", { rates: new Map(), enabled: false }, 5);
      expect(points).toHaveLength(3);

      // Window totals: pro 6.5M > gpt-6-sol 1.8M > glm 0.7M > mimo 0.59M > flash 0.4M; kimi 0.15M → Others.
      const keys = points[0].models.map((m) => m.key);
      expect(keys).toEqual(["deepseek-v4-pro", "gpt-6-sol", "glm-52", "mimo-v25", "deepseek-v4-flash", "__others__"]);

      // Labels/families resolve through the model map — including the 900k
      // spelling, which must roll up to the base GPT 6 Sol entry.
      const sol = points[0].models[1];
      expect(sol.label).toBe("GPT 6 Sol");
      expect(sol.family).toBe("OpenAI");
      expect(points[0].models[0].family).toBe("DeepSeek");
      expect(points[0].models[5].label).toBe("Others");
      expect(points[0].models[5].family).toBeNull();

      // Day 1: pro 1.5M, sol 300k, glm 100k, mimo 90k, flash 400k, others(kimi) 150k.
      expect(points[0].models.map((m) => m.tokens)).toEqual([1_500_000, 300_000, 100_000, 90_000, 400_000, 150_000]);
      // Day 2: pro 3M, sol 1.5M (bare spelling merged with the 900k key), glm 600k; flash/mimo/kimi idle → 0.
      expect(points[1].models.map((m) => m.tokens)).toEqual([3_000_000, 1_500_000, 600_000, 0, 0, 0]);
      // Day 3: pro 2M, mimo 500k; the rest idle → 0.
      expect(points[2].models.map((m) => m.tokens)).toEqual([2_000_000, 0, 0, 500_000, 0, 0]);
      owner2.close();
    });

    test("no Others series when everything fits in the top N", async () => {
      const owner2 = openMemoryDatabase();
      const db = owner2.db;
      replaceDayForSource(db, "2026-09-01", "hermes", [
        { date: "2026-09-01", metric: "model.tokens_input", value: 1_000_000, tags: { model: "deepseek-v4-pro" } },
        { date: "2026-09-01", metric: "model.tokens_input", value: 100_000, tags: { model: "gpt-6-sol" } },
      ]);
      const points = await queryDailyModelShare(db, "2026-09-01", "2026-09-02", { rates: new Map(), enabled: false }, 5);
      expect(points).toHaveLength(2);
      expect(points[0].models.map((m) => m.key)).toEqual(["deepseek-v4-pro", "gpt-6-sol"]);
      // The idle second day still carries both series 0-filled.
      expect(points[1].models.map((m) => m.tokens)).toEqual([0, 0]);
      owner2.close();
    });
  });
