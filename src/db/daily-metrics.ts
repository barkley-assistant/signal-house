/**
 * daily_metrics repository — the unified daily rollup.
 *
 * Semantics (contracts #4/#5/#9): a missing row = "no upstream activity that
 * day"; a `value NULL` cell = "unknown for a day that otherwise has data".
 * Same-day refreshes replace the current UTC day per source; earlier days are
 * insert-or-ignore so already-persisted days stay intact until retention.
 */

import type { Database } from "bun:sqlite";
import type { CostEstimationOpts, DailyWrite } from "../shared/types";
import { fetchAllRates } from "../server/model-pricing";

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
 * Backfill earlier days, refreshing rows when the collector has newer truth.
 *
 * Upsert semantics: an existing (date, source, metric, tags) row is updated
 * only when the value differs — upstream cost corrections (hermes estimated
 * → actual, etc.) propagate into signal-house's history, while identical
 * values cause no write at all. Days the collector no longer emits (upstream
 * pruned the sessions) are left untouched, so signal-house's own history
 * survives upstream retention.
 */
export function backfillDaysForSource(db: Database, date: string, source: string, rows: DailyWrite[]): number {
  if (rows.length === 0) return 0;
  const upsert = db.query(
    `INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, source, metric, tags) DO UPDATE SET
       value = excluded.value,
       observed_at = excluded.observed_at
     WHERE daily_metrics.value IS NOT excluded.value`,
  );
  const observedAt = Date.now();
  let n = 0;
  for (const r of rows) {
    upsert.run(date, source, r.metric, r.value, JSON.stringify(r.tags), observedAt);
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

/** Aggregated per-day cost + token series for the Agent Spend trend chart.
 *  The `tokens` column keeps its original 5-term sum semantics; `cacheRead`
 *  is an additive column for the cache-read chart series.
 *
 *  When `costOpts.enabled` is true, `cost` is recomputed per-(date, model)
 *  from tokens × rates so the chart tracks the estimator's value, not the
 *  upstream-reported one. When disabled, it falls through to the upstream
 *  sum (today's behavior). Either way the per-day series matches the
 *  estimator's by-model rollup that buildState surfaces. */
export async function queryDailyTrend(
  db: Database,
  from: string,
  to: string,
  costOpts: CostEstimationOpts,
): Promise<Array<{ date: string; cost: number | null; tokens: number | null; cacheRead: number | null }>> {
  // Tokens series: aggregated per day across both sources (matches the
  // pre-existing chart contract).
  const tokenRows = db
    .query(
      `SELECT date,
              SUM(CASE WHEN metric = 'tokens.input' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.output' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.cache_read' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.cache_write' THEN value END) +
              SUM(CASE WHEN metric = 'tokens.reasoning' THEN value END) AS tokens,
              SUM(CASE WHEN metric = 'tokens.cache_read' THEN value END) AS cacheRead
       FROM daily_metrics
       WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
       GROUP BY date ORDER BY date`,
    )
    .all(from, to) as Array<{ date: string; tokens: number | null; cacheRead: number | null }>;
  const tokensByDate = new Map(tokenRows.map((r) => [r.date, r]));

  if (!costOpts.enabled) {
    // Passthrough: read upstream cost.total per day, the original behavior.
    const costRows = db
      .query(
        `SELECT date, SUM(CASE WHEN metric = 'cost.total' THEN value END) AS cost
         FROM daily_metrics
         WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
         GROUP BY date ORDER BY date`,
      )
      .all(from, to) as Array<{ date: string; cost: number | null }>;
    return tokenRows.map((r) => {
      const cost = costRows.find((c) => c.date === r.date)?.cost ?? null;
      return { date: r.date, cost, tokens: r.tokens, cacheRead: r.cacheRead };
    });
  }

  // Estimator on: per-(date, model) tokens, lookup rates, sum per day.
  // First query the per-model metric rows (model.tokens_input, etc.),
  // dedupe to unique model names, fetch rates once via the resolver, then
  // sum per-day per-model cost. Models missing from the resolver return
  // zero rates (matches the by-model rollup's costSource: 'unknown' carve-out
  // — the daily chart silently omits rows the estimator can't price).
  const perModelRows = db
    .query(
      `SELECT date,
              json_extract(tags, '$.model') AS model,
              SUM(CASE WHEN metric = 'model.tokens_input'       THEN value END) AS inputTokens,
              SUM(CASE WHEN metric = 'model.tokens_output'      THEN value END) AS outputTokens,
              SUM(CASE WHEN metric = 'model.tokens_cache_read' THEN value END) AS cacheReadTokens
       FROM daily_metrics
       WHERE date >= ? AND date <= ?
         AND source IN ('opencode', 'hermes')
         AND metric LIKE 'model.tokens_%'
       GROUP BY date, json_extract(tags, '$.model')`,
    )
    .all(from, to) as Array<{
      date: string;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
      cacheReadTokens: number | null;
    }>;

  const uniqueModels = Array.from(
    new Set(perModelRows.map((r) => r.model).filter((m): m is string => !!m)),
  );
  const rates = await fetchAllRates(uniqueModels);

  const costByDate = new Map<string, number>();
  for (const row of perModelRows) {
    if (!row.model) continue;
    // Strip date-snapshot suffixes before lookup so variants like
    // 'DeepSeek V4 Flash 0731' or 'gpt-5.6-luna-20250815' resolve against
    // the same rate entry as their base model.
    const lookupKey = row.model.replace(/-[0-9]{4,}$/, "");
    const r = rates.get(row.model) ?? rates.get(lookupKey);
    if (!r || (r.input === 0 && r.output === 0)) continue;
    const input = row.inputTokens ?? 0;
    const output = row.outputTokens ?? 0;
    const cacheRead = row.cacheReadTokens ?? 0;
    const modelCost = (input * r.input + output * r.output + cacheRead * r.cacheRead) / 1_000_000;
    costByDate.set(row.date, (costByDate.get(row.date) ?? 0) + modelCost);
  }

  return tokenRows.map((r) => {
    const cost = costByDate.has(r.date) ? costByDate.get(r.date)! : null;
    return { date: r.date, cost, tokens: r.tokens, cacheRead: r.cacheRead };
  });
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
