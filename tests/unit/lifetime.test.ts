/**
 * lifetime stats tests — window-less aggregation over daily_metrics.
 *
 * Pins the /api/state `lifetime` section: sums span ALL retained history
 * (no date predicates), the 5-term token definition, canonical top-model
 * merge, busiest-day pick, and the null contract (empty/unknown history
 * stays null, never a confident zero).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeLifetimeStats } from "../../src/metrics/lifetime";
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sh-lifetime-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function openDb(): Database {
  const db = new Database(join(dir, `lifetime-${Math.random().toString(36).slice(2)}.db`));
  db.exec(`
    CREATE TABLE daily_metrics (
      date TEXT NOT NULL, source TEXT NOT NULL, metric TEXT NOT NULL, value REAL,
      tags TEXT NOT NULL DEFAULT '{}', observed_at INTEGER NOT NULL,
      PRIMARY KEY (date, source, metric, tags)
    );
  `);
  return db;
}

function seed(db: Database, date: string, source: string, metric: string, value: number | null, tags = "{}"): void {
  db.query("INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(date, source, metric, value, tags, Date.now());
}

/** One usage day: day-level rows + optional per-model rows, mirroring
 *  src/metrics/daily.ts writers. sessions/tokens null = the "activity but
 *  unknown" NULL-cell case (contract #5). */
function seedUsageDay(db: Database, source: string, date: string, opts: { sessions?: number | null; tokens?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number } | null; model?: string; modelSessions?: number }): void {
  const t = opts.tokens;
  // `?? 1` would swallow an explicit null (the NULL-cell case) — only
  // undefined means "default to 1".
  seed(db, date, source, "sessions.total", opts.sessions === undefined ? 1 : opts.sessions);
  seed(db, date, source, "tokens.input", t?.input ?? null);
  seed(db, date, source, "tokens.output", t?.output ?? null);
  seed(db, date, source, "tokens.cache_read", t?.cacheRead ?? null);
  seed(db, date, source, "tokens.cache_write", t?.cacheWrite ?? null);
  seed(db, date, source, "tokens.reasoning", t?.reasoning ?? null);
  if (opts.model) {
    const tags = JSON.stringify({ model: opts.model });
    seed(db, date, source, "model.sessions", opts.modelSessions ?? 1, tags);
  }
}

const NO_COST = { rates: new Map(), enabled: false };

describe("computeLifetimeStats", () => {
  test("returns null when daily_metrics is empty", () => {
    const db = openDb();
    expect(computeLifetimeStats(db, NO_COST)).toBeNull();
    db.close();
  });

  test("sums across the full retained history — no window slicing", () => {
    const db = openDb();
    // A day far outside any 7/30-day window still counts: lifetime is window-less.
    seedUsageDay(db, "hermes", utcDaysAgo(40), { sessions: 2, tokens: { input: 1000 } });
    seedUsageDay(db, "hermes", utcDay(), { sessions: 1, tokens: { output: 200 } });
    seed(db, utcDaysAgo(40), "git", "commits.total", 5);
    seed(db, utcDay(), "git", "commits.total", 7);

    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.sinceDay).toBe(utcDaysAgo(40));
    expect(stats.totalCommits).toBe(12);
    expect(stats.totalSessions).toBe(3);
    expect(stats.totalTokens).toBe(1200);
    db.close();
  });

  test("total tokens is the 5-term sum (same definition as the chart)", () => {
    const db = openDb();
    seedUsageDay(db, "opencode", utcDay(), {
      sessions: 1,
      tokens: { input: 1000, output: 200, cacheRead: 5000, cacheWrite: 50, reasoning: 20 },
    });
    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.totalTokens).toBe(6270);
    db.close();
  });

  test("unknown values stay null, never confident zeros", () => {
    const db = openDb();
    // Usage day exists but every value cell is NULL; no git rows at all.
    seedUsageDay(db, "hermes", utcDay(), { sessions: null, tokens: null });
    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.totalCommits).toBeNull(); // no git rows
    expect(stats.totalTokens).toBeNull(); // all cells NULL
    expect(stats.totalSessions).toBeNull();
    expect(stats.topModel).toBeNull();
    expect(stats.busiestDay).toBeNull();
    // The table has rows, so the bound is still known.
    expect(stats.sinceDay).toBe(utcDay());
    db.close();
  });

  test("top model merges spellings across sources and drops unknown", () => {
    const db = openDb();
    seedUsageDay(db, "hermes", utcDay(), { sessions: 2, tokens: { input: 100 }, model: "DeepSeek-V4-Pro", modelSessions: 2 });
    seedUsageDay(db, "opencode", utcDay(), { sessions: 1, tokens: { input: 50 }, model: "deepseek-v4-pro", modelSessions: 1 });
    // "unknown" carries no signal — must be dropped, not crowned.
    // (Separate day from the other opencode row: daily_metrics PK is
    // (date, source, metric, tags), so two usage days per source can't
    // share a date.)
    seedUsageDay(db, "opencode", utcDaysAgo(1), { sessions: 9, tokens: { input: 9 }, model: "unknown", modelSessions: 9 });

    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.topModel).toEqual({ label: "DeepSeek V4 Pro", sessions: 3 });
    db.close();
  });

  test("topModel is null when only day-level rows exist", () => {
    const db = openDb();
    seedUsageDay(db, "hermes", utcDay(), { sessions: 4, tokens: { input: 10 } });
    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.topModel).toBeNull();
    db.close();
  });

  test("busiest day is the highest 5-term day; earliest wins ties", () => {
    const db = openDb();
    seedUsageDay(db, "opencode", "2026-08-30", { sessions: 1, tokens: { input: 100 } });
    seedUsageDay(db, "opencode", "2026-08-31", { sessions: 1, tokens: { input: 400, cacheRead: 100 } });
    seedUsageDay(db, "hermes", "2026-09-01", { sessions: 1, tokens: { output: 50 } });
    // Tie for the max (500): the EARLIER day wins — deterministic pick.
    seedUsageDay(db, "opencode", "2026-08-29", { sessions: 1, tokens: { input: 500 } });

    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.busiestDay).toEqual({ date: "2026-08-29", tokens: 500 });
    db.close();
  });

  test("git-only days do not leak into usage stats and vice versa", () => {
    const db = openDb();
    seed(db, utcDay(), "git", "commits.total", 3);
    seed(db, utcDay(), "github", "prs.merged", 10);
    const stats = computeLifetimeStats(db, NO_COST)!;
    expect(stats.totalCommits).toBe(3);
    expect(stats.totalSessions).toBeNull(); // github/git rows are not usage
    expect(stats.totalTokens).toBeNull();
    db.close();
  });
});