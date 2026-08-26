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
import { canonicalMachineKey, machineKey, stripDateSnapshot } from "../shared/models";
import { fetchAllRates, type ModelRates } from "../server/model-pricing";

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
    // The rates map is keyed by machine key (lowercase + dot-stripped, via
    // machineKey()). Strip date suffixes on top of that. Note that
    // machineKey also strips dots — so 'gpt-5.6-luna' becomes 'gpt-56-luna'.
    const mk = machineKey(row.model);
    if (!mk) continue;
    const lookupKey = stripDateSnapshot(mk);
    const r = rates.get(mk) ?? rates.get(lookupKey);
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

/**
 * Per-model daily cost + token trend — one model's slice of the same
 * daily_metrics history that feeds /api/daily/spend, addressed by canonical
 * machine key. Rows are grouped by canonicalMachineKey (the aggregator's
 * grouping), so dated variants and source spelling differences collapse
 * into a single series, matching how byModel rolls up on /api/state.
 *
 * Cost follows the SAME estimator contract as queryDailyTrend: when
 * `costOpts.enabled`, per-(date, model) tokens are priced from resolver
 * rates (per-1M semantics); models with no resolvable rate contribute no
 * cost for days where they're the only activity → null day (gap), never 0.
 * When disabled, the persisted `model.cost` passthrough sum is used.
 */
export async function queryDailyModelTrend(
  db: Database,
  key: string,
  from: string,
  to: string,
  costOpts: CostEstimationOpts,
): Promise<Array<{ date: string; cost: number | null; tokens: number | null; cacheRead: number | null }>> {
  // Per-(date, raw-model) token sums; the canonical-key filter happens in
  // JS because SQLite has no access to shared/models' alias tables.
  const rows = db
    .query(
      `SELECT date,
              json_extract(tags, '$.model') AS model,
              SUM(CASE WHEN metric = 'model.tokens_input'       THEN value END) AS inputTokens,
              SUM(CASE WHEN metric = 'model.tokens_output'      THEN value END) AS outputTokens,
              SUM(CASE WHEN metric = 'model.tokens_cache_read'  THEN value END) AS cacheReadTokens,
              SUM(CASE WHEN metric = 'model.tokens_cache_write' THEN value END) AS cacheWriteTokens,
              SUM(CASE WHEN metric = 'model.tokens_reasoning'   THEN value END) AS reasoningTokens
       FROM daily_metrics
       WHERE date >= ? AND date <= ?
         AND source IN ('opencode', 'hermes')
         AND metric LIKE 'model.tokens_%'
       GROUP BY date, json_extract(tags, '$.model')`,
    )
    .all(from, to) as Array<{
    date: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
  }>;

  // Per-date accumulator; built from rows that actually match the key so
  // neither tokens nor passthrough costs leak in from other models.
  const tokenByDate = new Map<string, { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }>();

  // Same-day rows from both sources under different spellings of one model
  // must merge into ONE series keyed by canonicalMachineKey.
  const matchedSpellings = new Set<string>();
  for (const row of rows) {
    if (!row.model || canonicalMachineKey(row.model) !== key) continue;
    matchedSpellings.add(row.model);
    let acc = tokenByDate.get(row.date);
    if (!acc) {
      acc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
      tokenByDate.set(row.date, acc);
    }
    acc.input += row.inputTokens ?? 0;
    acc.output += row.outputTokens ?? 0;
    acc.cacheRead += row.cacheReadTokens ?? 0;
    acc.cacheWrite += row.cacheWriteTokens ?? 0;
    acc.reasoning += row.reasoningTokens ?? 0;
  }

  // Passthrough mode: persisted per-(date, spelling) upstream cost summed
  // per day, restricted to the spellings that belong to this key.
  const upstreamCostByDate = new Map<string, number>();
  if (!costOpts.enabled && matchedSpellings.size > 0) {
    const placeholders = [...matchedSpellings].map(() => "?").join(", ");
    const costRows = db
      .query(
        `SELECT date, SUM(value) AS cost
         FROM daily_metrics
         WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
           AND metric = 'model.cost'
           AND json_extract(tags, '$.model') IN (${placeholders})
         GROUP BY date`,
      )
      .all(from, to, ...matchedSpellings) as Array<{ date: string; cost: number | null }>;
    for (const r of costRows) {
      if (r.cost !== null) upstreamCostByDate.set(r.date, r.cost);
    }
  }

  // Estimator mode: resolve rates once for this key. Spellings share the
  // canonical group but may normalise differently, so try each until one
  // hits the resolver's stripped-key map.
  let resolvedRates: ModelRates | undefined;
  if (costOpts.enabled && matchedSpellings.size > 0) {
    const rates = await fetchAllRates([...matchedSpellings]);
    for (const spelling of matchedSpellings) {
      const mk = machineKey(spelling);
      const r = rates.get(stripDateSnapshot(mk)) ?? rates.get(mk);
      if (r && (r.input > 0 || r.output > 0)) {
        resolvedRates = r;
        break;
      }
    }
  }

  return [...tokenByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => {
      const tokensSum = t.input + t.output + t.cacheRead + t.cacheWrite + t.reasoning;
      const cost =
        resolvedRates
          ? (t.input * resolvedRates.input + t.output * resolvedRates.output + t.cacheRead * resolvedRates.cacheRead) / 1_000_000
          : upstreamCostByDate.get(date) ?? null;
      return {
        date,
        cost,
        tokens: tokensSum > 0 ? tokensSum : null,
        // Cache-read series mirrors the main chart's gap semantics: a day
        // with no cache activity is a gap, not a zero baseline.
        cacheRead: t.cacheRead > 0 ? t.cacheRead : null,
      };
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
