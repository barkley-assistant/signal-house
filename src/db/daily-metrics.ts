/**
 * daily_metrics repository — the unified daily rollup.
 *
 * Semantics (contracts #4/#5/#9): a missing row = "no upstream activity that
 * day"; a `value NULL` cell = "unknown for a day that otherwise has data".
 * Same-day refreshes replace the current UTC day per source; earlier days are
 * insert-or-ignore so already-persisted days stay intact until retention.
 */

import type { Database } from "bun:sqlite";
import type { DailyWrite } from "../shared/types";

export interface DailyMetricRow {
  date: string;
  source: string;
  metric: string;
  value: number | null;
  tags: string;
  observed_at: number;
}

export interface DailyMetricPoint {
  date: string;
  source: string;
  metric: string;
  value: number | null;
  tags: Record<string, string | null>;
  observedAt: number;
}

export type { DailyWrite };

/** Replace every metric row for one (date, source) — used for the current UTC day. */
export function replaceDayForSource(db: Database, date: string, source: string, rows: DailyWrite[]): number {
  db.query("DELETE FROM daily_metrics WHERE date = ? AND source = ?").run(date, source);
  const insert = db.query(
    "INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const observedAt = Date.now();
  let n = 0;
  for (const r of rows) {
    insert.run(date, source, r.metric, r.value, JSON.stringify(r.tags), observedAt);
    n++;
  }
  return n;
}

/**
 * Backfill earlier days without touching existing rows.
 * INSERT OR IGNORE skips rows whose (date, source, metric, tags) already exist —
 * that is the "earlier days remain intact" guarantee.
 */
export function backfillDaysForSource(db: Database, date: string, source: string, rows: DailyWrite[]): number {
  if (rows.length === 0) return 0;
  const insert = db.query(
    "INSERT OR IGNORE INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const observedAt = Date.now();
  let n = 0;
  for (const r of rows) {
    insert.run(date, source, r.metric, r.value, JSON.stringify(r.tags), observedAt);
    n++;
  }
  return n;
}

export interface DailyQuery {
  from: string;
  to: string;
  source?: string;
  metric?: string;
}

export function queryDailyMetrics(db: Database, q: DailyQuery): DailyMetricPoint[] {
  const clauses: string[] = ["date >= ?", "date <= ?"];
  const params: Array<string | number> = [q.from, q.to];
  if (q.source) {
    clauses.push("source = ?");
    params.push(q.source);
  }
  if (q.metric) {
    clauses.push("metric = ?");
    params.push(q.metric);
  }
  const rows = db
    .query(
      `SELECT date, source, metric, value, tags, observed_at
       FROM daily_metrics WHERE ${clauses.join(" AND ")} ORDER BY date ASC`,
    )
    .all(...params) as unknown as DailyMetricRow[];

  return rows.map((r) => ({
    date: r.date,
    source: r.source,
    metric: r.metric,
    value: r.value,
    tags: parseTags(r.tags),
    observedAt: r.observed_at,
  }));
}

/** Aggregated per-day cost + token series for the Agent Spend trend chart. */
export function queryDailyTrend(db: Database, from: string, to: string): Array<{ date: string; cost: number | null; tokens: number | null }> {
  const rows = db
    .query(
      `SELECT date,
              SUM(CASE WHEN metric = 'cost.total' THEN value END) AS cost,
              SUM(CASE WHEN metric = 'tokens.input' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.output' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.cache_read' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.cache_write' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.reasoning' THEN value END) AS tokens
       FROM daily_metrics
       WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
       GROUP BY date ORDER BY date`,
    )
    .all(from, to) as Array<{ date: string; cost: number | null; tokens: number | null }>;
  return rows;
}

/** All distinct (date, source) pairs that have ANY rows in range. */
export function presentDaySources(db: Database, from: string, to: string): Array<{ date: string; source: string }> {
  return db
    .query("SELECT DISTINCT date, source FROM daily_metrics WHERE date >= ? AND date <= ? ORDER BY date")
    .all(from, to) as Array<{ date: string; source: string }>;
}

export function pruneDailyMetrics(db: Database, cutoffDay: string): number {
  const result = db.query("DELETE FROM daily_metrics WHERE date < ?").run(cutoffDay);
  return result.changes;
}

export function parseTags(tags: string): Record<string, string | null> {
  try {
    return JSON.parse(tags) as Record<string, string | null>;
  } catch {
    return {};
  }
}
