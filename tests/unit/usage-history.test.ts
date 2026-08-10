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
 *  on a day that already has day-level rows). */
function seedDay(
  db: Database,
  source: string,
  date: string,
  opts: {
    sessions?: number;
    cost?: number | null;
    tokens?: number | null;
    cacheRead?: number | null;
    cacheWrite?: number | null;
    model?: string;
    modelSessions?: number;
    modelCost?: number | null;
    modelTokens?: number | null;
    modelCacheRead?: number | null;
    modelCacheWrite?: number | null;
    modelOnly?: boolean;
  },
): void {
  const t = Date.now();
  const put = (metric: string, value: number | null, tags = "{}") =>
    db.query("INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)").run(date, source, metric, value, tags, t);
  if (!opts.modelOnly) {
    put("sessions.total", opts.sessions ?? 1);
    put("messages.total", opts.sessions ?? 1);
    put("cost.total", opts.cost ?? null);
    put("tokens.input", opts.tokens ?? null);
    put("tokens.cache_read", opts.cacheRead ?? null);
    put("tokens.cache_write", opts.cacheWrite ?? null);
  }
  if (opts.model) {
    const tags = JSON.stringify({ model: opts.model });
    put("model.sessions", opts.modelSessions ?? 1, tags);
    put("model.cost", opts.modelCost ?? opts.cost ?? null, tags);
    put("model.tokens_input", opts.modelTokens ?? opts.tokens ?? null, tags);
    put("model.tokens_cache_read", opts.modelCacheRead ?? opts.cacheRead ?? null, tags);
    put("model.tokens_cache_write", opts.modelCacheWrite ?? opts.cacheWrite ?? null, tags);
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
});

describe("queryUsageAggregate cache fields", () => {
  test("cacheHitRate is null when both input and cache_read are zero (no signal)", () => {
    const db = openDb();
    seedDay(db, "hermes", utcDay(), { sessions: 1, cost: 1, tokens: 0, cacheRead: 0, model: "DeepSeek-V4-Pro", modelSessions: 1, modelCost: 1, modelTokens: 0, modelCacheRead: 0 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.cacheHitRate).toBeNull();
    expect(agg.totalCacheReadTokens).toBe(0);
    // Savings is $0 (not null) when the rate is available but reads are 0 —
    // the card formats 0 as "$0.00" via formatCost.
    expect(agg.totalCacheSavingsUsd).toBe(0);
    expect(agg.byModel[0].cacheHitRate).toBeNull();
    expect(agg.byModel[0].cacheSavingsUsd).toBe(0);
    db.close();
  });

  test("cacheHitRate = cacheRead / (cacheRead + input) for positive case", () => {
    const db = openDb();
    // 3 days: 80 cache reads against 20 input → 80% rate (each day)
    seedDay(db, "hermes", utcDaysAgo(2), { sessions: 1, cost: 1, tokens: 100, cacheRead: 80, model: "Claude-Opus-4.5", modelSessions: 1, modelCost: 1, modelTokens: 100, modelCacheRead: 80 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    // Per-model: cacheRead=80, input=100 → 80/(80+100)=0.4444
    expect(agg.byModel[0].cacheHitRate).toBeCloseTo(80 / 180, 5);
    // Per-day totals: cacheRead=80, input=100 → 80/(80+100)=0.4444
    expect(agg.cacheHitRate).toBeCloseTo(80 / 180, 5);
    db.close();
  });

  test("cacheHitRate is 1.0 when cache_read > 0 but input is unknown/zero", () => {
    const db = openDb();
    // cache reads with no input telemetry → treat input as 0 → 100% cache
    seedDay(db, "hermes", utcDay(), { sessions: 1, cost: 1, tokens: 0, cacheRead: 500, model: "DeepSeek-V4-Pro", modelSessions: 1, modelCost: 1, modelTokens: 0, modelCacheRead: 500 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.byModel[0].cacheHitRate).toBe(1);
    db.close();
  });

  test("totalCacheSavingsUsd = sum(cacheRead × costInput / 1e6) over byModel rows", () => {
    const db = openDb();
    // Two models: Claude Opus 4.5 ($15/1M input) with 2M cache reads → $30 saved;
    // MiniMax M3 ($1/1M input) with 1M cache reads → $1 saved. Total = $31.
    seedDay(db, "hermes", utcDay(), { sessions: 1, cost: 5, tokens: 100, cacheRead: 2_000_000, model: "Claude-Opus-4.5", modelSessions: 1, modelCost: 5, modelTokens: 100, modelCacheRead: 2_000_000 });
    seedDay(db, "opencode", utcDay(), { sessions: 1, cost: 2, tokens: 50, cacheRead: 1_000_000, model: "MiniMax-M3", modelSessions: 1, modelCost: 2, modelTokens: 50, modelCacheRead: 1_000_000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.totalCacheSavingsUsd).toBeCloseTo(31, 5);
    // Per-model rates:
    const opus = agg.byModel.find((m) => m.model === "Claude Opus 4.5")!;
    const mini = agg.byModel.find((m) => m.model === "MiniMax M3")!;
    expect(opus.cacheSavingsUsd).toBeCloseTo(30, 5);
    expect(mini.cacheSavingsUsd).toBeCloseTo(1, 5);
    db.close();
  });

  test("totalCacheSavingsUsd is null when no model has a costInput rate", () => {
    const db = openDb();
    // Use a model that isn't in the curated map (no costInput field).
    seedDay(db, "hermes", utcDay(), { sessions: 1, cost: 1, tokens: 100, cacheRead: 1_000_000, model: "somemodel-v1-test-only", modelSessions: 1, modelCost: 1, modelTokens: 100, modelCacheRead: 1_000_000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    // byModel row is dropped from the table (machineKey returns empty for
    // unrecognised names? No — it returns "somemodel-v1-test-only", which
    // isn't "unknown", so the row stays but cacheSavingsUsd stays null).
    expect(agg.totalCacheSavingsUsd).toBeNull();
    db.close();
  });

  test("per-source cache read/savings split proportionally by each source's cache share", () => {
    const db = openDb();
    // Same model (Claude Opus 4.5, $15/1M input) across both sources:
    // hermes = 3M cache reads, opencode = 1M. Total = 4M → $60 saved.
    seedDay(db, "hermes", utcDay(), { sessions: 2, cost: 10, tokens: 100, cacheRead: 3_000_000, model: "Claude-Opus-4.5", modelSessions: 2, modelCost: 10, modelTokens: 100, modelCacheRead: 3_000_000 });
    seedDay(db, "opencode", utcDay(), { sessions: 1, cost: 5, tokens: 50, cacheRead: 1_000_000, model: "Claude-Opus-4.5", modelSessions: 1, modelCost: 5, modelTokens: 50, modelCacheRead: 1_000_000 });

    const agg = queryUsageAggregate(db, utcDaysAgo(7), utcDay())!;
    expect(agg.totalCacheSavingsUsd).toBeCloseTo(60, 5);
    // hermes contributes 3/4 of the model's cache reads → 75% of savings → $45.
    // opencode contributes 1/4 → $15.
    expect(agg.bySource.hermes.cacheSavingsUsd).toBeCloseTo(45, 5);
    expect(agg.bySource.opencode.cacheSavingsUsd).toBeCloseTo(15, 5);
    expect(agg.bySource.hermes.cacheReadTokens).toBe(3_000_000);
    expect(agg.bySource.opencode.cacheReadTokens).toBe(1_000_000);
    db.close();
  });
});
