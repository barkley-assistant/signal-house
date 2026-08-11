/**
 * usage-history tests — signal-house's OWN accumulated daily_metrics history
 * as the source for the dashboard usage aggregate.
 *
 * The whole point: signal-house keeps its own 90-day per-day (+ per-model)
 * records, so the 7/30/90-day windows stay fully populated even when
 * upstream tools prune their session DBs. These pin the derivation:
 * window slicing, per-source pivots, null-safe cost/tokens, model rows
 * merged across sources by normalized key, "unknown" dropped.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryUsageAggregate } from "../../src/metrics/usage-history";
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-usage-history-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openDb(): Database {
  const db = new Database(join(dir, `usage-${Math.random().toString(36).slice(2)}.db`));
  db.exec(`
    CREATE TABLE daily_metrics (
      date TEXT NOT NULL, source TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
      tags TEXT NOT NULL DEFAULT '{}', observed_at INTEGER NOT NULL,
      PRIMARY KEY (date, source, metric, tags)
    );
  `);
  return db;
}

/** Write one day's worth of day-level + model rows for a source. With
 *  `modelOnly`, only the model rows are written (for seeding a second model
 *  on a day that already has day-level rows). `cacheRead` / `modelCacheRead`
 *  write `tokens.cache_read` / `model.tokens_cache_read` so the cache
 *  derivation has data to work with. */
function seedDay(db: Database, source: string, date: string, opts: { sessions?: number; cost?: number | null; tokens?: number | null; cacheRead?: number | null; model?: string; modelSessions?: number; modelCost?: number | null; modelTokens?: number | null; modelCacheRead?: number | null; modelOnly?: boolean }): void {
  const t = Date.now();
  const put = (metric: string, value: number | null, tags = "{}") =>
    db.query("INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)").run(date, source, metric, value, tags, t);
  if (!opts.modelOnly) {
    put("sessions.total", opts.sessions ?? 1);
    put("messages.total", opts.sessions ?? 1);
    put("cost.total", opts.cost ?? null);
    put("tokens.input", opts.tokens ?? null);
    if (opts.cacheRead !== undefined) put("tokens.cache_read", opts.cacheRead);
  }
  if (opts.model) {
    const tags = JSON.stringify({ model: opts.model });
    put("model.sessions", opts.modelSessions ?? 1, tags);
    put("model.cost", opts.modelCost ?? opts.cost ?? null, tags);
    put("model.tokens_input", opts.modelTokens ?? opts.tokens ?? null, tags);
    if (opts.modelCacheRead !== undefined) put("model.tokens_cache_read", opts.modelCacheRead, tags);
  }
}

describe("queryUsageAggregate", () => {
  test("returns null when the window has no rows at all", () => {
    const db = openDb();
    expect(queryUsageAggregate(db, utcDaysAgo(30), utcDay())).toBeNull();
    db.close();
  });

  test("sums day-level totals per source across the window", () => {
    const db = openDb();
    // 3 days for hermes ($1/day), 2 days for opencode ($2/day)
    seedDay(db, "hermes", utcDaysAgo(2), { sessions: 2, cost: 1, tokens: 1000, model: "DeepSeek-V4-Pro", modelSessions: 2, modelCost: 1 });
    seedDay(db, "hermes", utcDaysAgo(1), { sessions: 1, cost: 1, tokens: 500, model: "DeepSeek-V4-Pro", modelSessions: 1, modelCost: 1 });
    seedDay(db, "opencode", utcDaysAgo(1), { sessions: 3, cost: 2, tokens: 2000, model: "DeepSeek-V4-Pro", modelSessions: 3, modelCost: 2 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.totalSessions).toBe(6);
    expect(agg.totalCost).toBeCloseTo(4, 5);
    expect(agg.totalTokens).toBeCloseTo(3500, 5);
    expect(agg.bySource.hermes).toMatchObject({ sessions: 3, cost: 2, tokens: 1500 });
    expect(agg.bySource.opencode).toMatchObject({ sessions: 3, cost: 2, tokens: 2000 });
    db.close();
  });

  test("slices to the window (older days excluded)", () => {
    const db = openDb();
    seedDay(db, "hermes", utcDaysAgo(40), { sessions: 5, cost: 50, tokens: 5000, model: "Oldmodel", modelSessions: 5, modelCost: 50 });
    seedDay(db, "hermes", utcDay(), { sessions: 1, cost: 1, tokens: 100, model: "Weekmodel", modelSessions: 1, modelCost: 1 });

    const week = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(week.totalSessions).toBe(1);
    expect(week.totalCost).toBeCloseTo(1, 5);
    expect(week.byModel.map((m) => m.model)).toEqual(["Weekmodel"]);

    const ninety = queryUsageAggregate(db, utcDaysAgo(90), utcDay())!;
    expect(ninety.totalSessions).toBe(6);
    expect(ninety.byModel.map((m) => m.model).sort()).toEqual(["Oldmodel", "Weekmodel"]);
    db.close();
  });

  test("unknown cost/tokens stay null, never confident zeros", () => {
    const db = openDb();
    // cost.total and tokens written as NULL (telemetry absent that day)
    seedDay(db, "hermes", utcDay(), { sessions: 4, cost: null, tokens: null, model: "Nocost", modelSessions: 4, modelCost: null });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.totalSessions).toBe(4);
    expect(agg.totalCost).toBeNull();
    expect(agg.totalTokens).toBeNull();
    expect(agg.bySource.hermes.cost).toBeNull();
    expect(agg.bySource.hermes.tokens).toBeNull();
    expect(agg.byModel[0].cost).toBeNull();
    db.close();
  });

  test("merges the same model across sources by normalized key, drops unknown", () => {
    const db = openDb();
    // same model, different spellings (hermes "DeepSeek-V4-Pro" vs opencode "deepseek-v4-pro")
    seedDay(db, "hermes", utcDay(), { sessions: 2, cost: 3, tokens: 100, model: "DeepSeek-V4-Pro", modelSessions: 2, modelCost: 3 });
    seedDay(db, "opencode", utcDay(), { sessions: 1, cost: 4, tokens: 50, model: "deepseek-v4-pro", modelSessions: 1, modelCost: 4 });
    // "unknown" carries no signal and must be dropped from the table
    seedDay(db, "opencode", utcDay(), { model: "unknown", modelSessions: 9, modelCost: 9, modelTokens: 9, modelOnly: true });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.byModel).toHaveLength(1);
    expect(agg.byModel[0].model).toBe("DeepSeek V4 Pro"); // curated label
    expect(agg.byModel[0].sessions).toBe(3);
    expect(agg.byModel[0].cost).toBeCloseTo(7, 5);
    expect(agg.byModel[0].tokens).toBeCloseTo(150, 5);
    db.close();
  });

  test("cost stays null when only some days have telemetry absent", () => {
    const db = openDb();
    seedDay(db, "hermes", utcDaysAgo(2), { sessions: 1, cost: 5, tokens: 10 });
    seedDay(db, "hermes", utcDaysAgo(1), { sessions: 1, cost: null, tokens: 10 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    // known day contributes; unknown day does not fabricate a zero — but the
    // total must still reflect the known $5.
    expect(agg.totalCost).toBeCloseTo(5, 5);
    expect(agg.totalSessions).toBe(2);
    db.close();
  });

  test("cache hit rate is sum(cache_read) / sum(cache_read + input)", () => {
    const db = openDb();
    // Day 1: 30 cache reads, 70 input → 0.3 hit rate
    // Day 2: 10 cache reads, 90 input → 0.1 hit rate
    // Window total: 40 cache reads, 160 input → 40/(40+160) = 0.2
    seedDay(db, "hermes", utcDaysAgo(2), { sessions: 1, cost: 1, tokens: 70, cacheRead: 30 });
    seedDay(db, "hermes", utcDaysAgo(1), { sessions: 1, cost: 1, tokens: 90, cacheRead: 10 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.cacheHitRate).toBeCloseTo(0.2, 5);
    expect(agg.totalCacheReadTokens).toBe(40);
    db.close();
  });

  test("no cache activity → cacheHitRate=null, never NaN", () => {
    const db = openDb();
    seedDay(db, "hermes", utcDay(), { sessions: 2, cost: 1, tokens: 1000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    // No cache activity → hit rate is unknown (not 0, not NaN). The UI
    // renders —. Tokens are a confident 0 (this source never had cache).
    expect(agg.cacheHitRate).toBeNull();
    expect(agg.totalCacheReadTokens).toBe(0);
    expect(agg.bySource.hermes.cacheReadTokens).toBe(0);
    db.close();
  });

  test("per-source cache tokens and savings reflect the source split", () => {
    const db = openDb();
    // opencode: 1M cache_read on DeepSeek V4 Pro ($3/M) → $3
    seedDay(db, "opencode", utcDay(), { sessions: 5, cost: 5, tokens: 100, cacheRead: 1_000_000, model: "DeepSeek-V4-Pro", modelSessions: 5, modelCost: 5, modelCacheRead: 1_000_000 });
    // hermes: 2M cache_read on Kimi K2.7 Code (unpriced → null savings)
    seedDay(db, "hermes", utcDay(), { sessions: 3, cost: 3, tokens: 100, cacheRead: 2_000_000, model: "Kimi-K2.7-Code", modelSessions: 3, modelCost: 3, modelCacheRead: 2_000_000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.bySource.opencode.cacheReadTokens).toBe(1_000_000);
    expect(agg.bySource.opencode.cacheSavingsUsd).toBeCloseTo(3, 5);
    expect(agg.bySource.hermes.cacheReadTokens).toBe(2_000_000);
    // unpriced model → savings is null, not 0 — the card renders — not $0.00
    expect(agg.bySource.hermes.cacheSavingsUsd).toBeNull();
    // top-level: $3 from opencode + null from hermes → 3 (the null source
    // does not erase the priced one)
    expect(agg.totalCacheSavingsUsd).toBeCloseTo(3, 5);
    db.close();
  });

  test("per-model cache savings applies the cost formula", () => {
    const db = openDb();
    seedDay(db, "opencode", utcDay(), { sessions: 1, cost: 5, tokens: 100, cacheRead: 1_000_000, model: "DeepSeek-V4-Pro", modelSessions: 1, modelCost: 5, modelCacheRead: 1_000_000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.byModel).toHaveLength(1);
    expect(agg.byModel[0].cacheReadTokens).toBe(1_000_000);
    expect(agg.byModel[0].cacheSavingsUsd).toBeCloseTo(3, 5);
    expect(agg.byModel[0].cacheHitRate).toBeCloseTo(1_000_000 / (1_000_000 + 100), 5);
    db.close();
  });
});
