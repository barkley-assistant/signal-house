/**
 * Cache metric derivation tests — hit-rate formula, zero-guard, and the
 * server-side cost.input lookup that drives per-model savings.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryUsageAggregate } from "../../src/metrics/usage-history";
import { getCacheReadCostPerMillion, getInputCostPerMillion, resetCostConfigCache, setCostConfigPath } from "../../src/server/cost-input";
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-cache-metrics-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openDb(): Database {
  const db = new Database(join(dir, `cache-${Math.random().toString(36).slice(2)}.db`));
  db.exec(`
    CREATE TABLE daily_metrics (
      date TEXT NOT NULL, source TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
      tags TEXT NOT NULL DEFAULT '{}', observed_at INTEGER NOT NULL,
      PRIMARY KEY (date, source, metric, tags)
    );
  `);
  return db;
}

function put(db: Database, source: string, date: string, metric: string, value: number | null, tags = "{}"): void {
  db.query("INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    date, source, metric, value, tags, Date.now(),
  );
}

function seedDay(db: Database, source: string, date: string, opts: { input?: number; cacheRead?: number; model?: string; modelInput?: number; modelCacheRead?: number }): void {
  if (opts.input !== undefined) put(db, source, date, "tokens.input", opts.input);
  if (opts.cacheRead !== undefined) put(db, source, date, "tokens.cache_read", opts.cacheRead);
  if (opts.model) {
    const tags = JSON.stringify({ model: opts.model });
    put(db, source, date, "model.sessions", 1, tags);
    if (opts.modelInput !== undefined) put(db, source, date, "model.tokens_input", opts.modelInput, tags);
    if (opts.modelCacheRead !== undefined) put(db, source, date, "model.tokens_cache_read", opts.modelCacheRead, tags);
  }
}

describe("queryUsageAggregate cache metrics", () => {
  test("all cached window has hit rate 1.0", () => {
    const db = openDb();
    seedDay(db, "opencode", utcDay(), { input: 0, cacheRead: 1000, model: "kimi-k27-code", modelInput: 0, modelCacheRead: 1000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.cacheHitRate).toBeCloseTo(1, 5);
    expect(agg.bySource.opencode.cacheHitRate).toBeCloseTo(1, 5);
    expect(agg.cacheReadTokens).toBe(1000);
    db.close();
  });

  test("no-cache window has hit rate 0.0", () => {
    const db = openDb();
    seedDay(db, "opencode", utcDay(), { input: 1000, cacheRead: 0, model: "kimi-k27-code", modelInput: 1000, modelCacheRead: 0 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.cacheHitRate).toBeCloseTo(0, 5);
    expect(agg.bySource.opencode.cacheHitRate).toBeCloseTo(0, 5);
    expect(agg.cacheReadTokens).toBe(0);
    db.close();
  });

  test("empty window zero-guard returns 0, not NaN", () => {
    const db = openDb();
    seedDay(db, "opencode", utcDay(), { input: 0, cacheRead: 0, model: "kimi-k27-code", modelInput: 0, modelCacheRead: 0 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.cacheHitRate).toBe(0);
    expect(agg.cacheHitRate).not.toBeNaN();
    expect(agg.cacheHitRate).not.toBeNull();
    expect(agg.bySource.opencode.cacheHitRate).toBe(0);
    db.close();
  });

  test("mixed window computes weighted rate across sources", () => {
    const db = openDb();
    // opencode: 300 cache read / 1000 input + 300 cache read = 300/1300
    seedDay(db, "opencode", utcDay(), { input: 1000, cacheRead: 300, model: "kimi-k27-code", modelInput: 1000, modelCacheRead: 300 });
    // hermes: 100 cache read / 200 input + 100 cache read = 100/300
    seedDay(db, "hermes", utcDay(), { input: 200, cacheRead: 100, model: "kimi-k27-code", modelInput: 200, modelCacheRead: 100 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    // window total: 400 / (400 + 1200) = 0.25
    expect(agg.cacheHitRate).toBeCloseTo(0.25, 5);
    expect(agg.bySource.opencode.cacheHitRate).toBeCloseTo(300 / 1300, 5);
    expect(agg.bySource.hermes.cacheHitRate).toBeCloseTo(100 / 300, 5);
    db.close();
  });
});

describe("cost-input lookup", () => {
  function fixture(cfg: unknown): string {
    const path = join(dir, `opencode-${Math.random().toString(36).slice(2)}.jsonc`);
    writeFileSync(path, JSON.stringify(cfg, null, 2));
    setCostConfigPath(path);
    resetCostConfigCache();
    return path;
  }

  test("known model returns cost.input rate", () => {
    fixture({ models: { "kimi-k27-code": { cost: { input: 3.0 } } } });
    expect(getInputCostPerMillion("kimi-k27-code")).toBeCloseTo(3.0, 5);
    expect(getInputCostPerMillion("Kimi K2.7 Code")).toBeCloseTo(3.0, 5); // normalised label
  });

  test("raw model name fallback when machine key misses", () => {
    fixture({ models: { "custom-model-v1": { cost: { input: 1.5 } } } });
    expect(getInputCostPerMillion("custom-model-v1")).toBeCloseTo(1.5, 5);
  });

  test("missing rate returns 0, not NaN or null", () => {
    fixture({ models: { "other-model": { cost: { input: 1.0 } } } });
    expect(getInputCostPerMillion("unknown-model")).toBe(0);
  });

  test("savings formula produces expected USD", () => {
    // 1000 tokens * $3 / 1M = $0.003
    fixture({ models: { "kimi-k27-code": { cost: { input: 3.0 } } } });
    const rate = getInputCostPerMillion("kimi-k27-code");
    expect(rate).toBeCloseTo(3.0, 5);
    expect((1000 * rate) / 1_000_000).toBeCloseTo(0.003, 5);
  });

  test("display-name config key resolves via machine-key index", () => {
    // The real opencode.jsonc keys models by display name ("DeepSeek-V4-Pro"),
    // not by machine key. A collector-supplied label ("DeepSeek V4 Pro") must
    // still resolve — this is the bug that produced $0 savings everywhere.
    fixture({ models: { "DeepSeek-V4-Pro": { cost: { input: 1.32, cache_read: 0.003625 } } } });
    expect(getInputCostPerMillion("DeepSeek V4 Pro")).toBeCloseTo(1.32, 5);
    expect(getInputCostPerMillion("deepseek-v4-pro")).toBeCloseTo(1.32, 5);
    expect(getInputCostPerMillion("openference/DeepSeek-V4-Pro")).toBeCloseTo(1.32, 5);
  });

  test("models nested under provider.<id>.models resolve", () => {
    // opencode v1.x nests the model cost table under provider.<id>.models.
    // Reading only the top-level `models` key returned an empty map and $0
    // savings — the primary cause of the broken card.
    fixture({ provider: { openference: { models: { "DeepSeek-V4-Pro": { cost: { input: 1.32, cache_read: 0.003625 } } } } } });
    expect(getInputCostPerMillion("DeepSeek V4 Pro")).toBeCloseTo(1.32, 5);
    expect(getCacheReadCostPerMillion("deepseek-v4-pro")).toBeCloseTo(0.003625, 5);
  });

  test("dated snapshot variants fall back to the base model rate", () => {
    // "DeepSeek-V4-Flash-0731" has no config entry; it should resolve to the
    // base "DeepSeek-V4-Flash" rate rather than reporting $0 savings.
    fixture({ models: { "DeepSeek-V4-Flash": { cost: { input: 0.44, cache_read: 0.0028 } } } });
    expect(getInputCostPerMillion("DeepSeek-V4-Flash-0731")).toBeCloseTo(0.44, 5);
    expect(getCacheReadCostPerMillion("deepseek-v4-flash-0731")).toBeCloseTo(0.0028, 5);
  });

  test("cache_read rate is read when present, 0 when absent", () => {
    fixture({ models: { "GLM-5.2": { cost: { input: 1.4, cache_read: 0.26 } }, "Auto": { cost: { input: 0.3675 } } } });
    expect(getCacheReadCostPerMillion("GLM 5.2")).toBeCloseTo(0.26, 5);
    expect(getCacheReadCostPerMillion("Auto")).toBe(0);
    expect(getCacheReadCostPerMillion("unknown-model")).toBe(0);
  });

  test("net savings subtracts the cache_read rate", () => {
    // 1M cache-read tokens × (1.40 − 0.26) / 1M = $1.14 net.
    fixture({ models: { "GLM-5.2": { cost: { input: 1.4, cache_read: 0.26 } } } });
    const input = getInputCostPerMillion("glm-52");
    const cacheRead = getCacheReadCostPerMillion("glm-52");
    expect((1_000_000 * (input - cacheRead)) / 1_000_000).toBeCloseTo(1.14, 5);
  });

  test("JSONC comments are stripped before parsing", () => {
    const path = join(dir, `opencode-comments.jsonc`);
    writeFileSync(path, `// top comment\n{\n  "models": {\n    /* block */\n    "kimi-k27-code": {\n      "cost": {\n        // per 1M\n        "input": 2.5\n      }\n    }\n  }\n}`);
    setCostConfigPath(path);
    resetCostConfigCache();
    expect(getInputCostPerMillion("kimi-k27-code")).toBeCloseTo(2.5, 5);
  });
});
