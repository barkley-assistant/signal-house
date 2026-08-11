/**
 * Usage aggregate derived from signal-house's OWN daily_metrics history.
 *
 * The dashboard's usage numbers (hero, ledger, by-model table) read from
 * here, not the snapshot. daily_metrics accumulates per-day rows (and now
 * per-day per-model rows) with a 90-day retention, so the 7/30/90-day
 * windows stay fully populated even when upstream tools prune their own
 * session history — signal-house keeps its own historical records. The
 * snapshot-derived path in computeAggregates remains the fallback for a
 * fresh DB before the first refresh has written any rows.
 *
 * Value semantics mirror shared/math.sum(): SQL SUM ignores NULL cells and
 * returns NULL when every row is NULL — "unknown for a day that otherwise
 * has data" never becomes a confident zero.
 */

import type { Database } from "bun:sqlite";
import type { UsageAggregate } from "../orchestrator/aggregates";
import { mergeModelRows } from "../orchestrator/aggregates";
import { cacheSavingsUsdForModel } from "../shared/model-costs";

const DAY_METRICS = [
  "sessions.total",
  "messages.total",
  "cost.total",
  "tokens.input",
  "tokens.output",
  "tokens.cache_read",
  "tokens.cache_write",
  "tokens.reasoning",
] as const;

const TOKEN_METRICS = ["tokens.input", "tokens.output", "tokens.cache_read", "tokens.cache_write", "tokens.reasoning"] as const;

/** Sum a group of metric values with null-safe semantics: null when every
 *  metric is unknown, else the sum of the known ones. */
function knownSum(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
}

export function queryUsageAggregate(db: Database, from: string, to: string): UsageAggregate | null {
  const placeholders = DAY_METRICS.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT source, metric, SUM(value) AS value
       FROM daily_metrics
       WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
         AND metric IN (${placeholders})
       GROUP BY source, metric`,
    )
    .all(from, to, ...DAY_METRICS) as Array<{ source: string; metric: string; value: number | null }>;

  if (rows.length === 0) return null;

  const perSource = new Map<string, Map<string, number | null>>();
  for (const r of rows) {
    let metrics = perSource.get(r.source);
    if (!metrics) {
      metrics = new Map();
      perSource.set(r.source, metrics);
    }
    metrics.set(r.metric, r.value);
  }

  const bySource: UsageAggregate["bySource"] = {};
  let totalSessions = 0;
  let totalMessages: number | null = null;
  let totalTokens: number | null = null;
  let totalCost: number | null = null;
  let totalInputTokens: number | null = null;
  // totalCacheReadTokens is a numeric token count (sum of observed values,
  // default 0 when no source had any cache_read telemetry). Confident zero
  // when no source has cache rows — the UI renders "0" (not "—").
  let totalCacheReadTokens = 0;
  // sawCacheReadTelemetry tracks whether ANY source had a cache_read row.
  // null cacheHitRate when no source has any cache telemetry at all (the
  // rate is genuinely unknown, not 0%).
  let sawCacheReadTelemetry = false;

  const merge = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  for (const [source, metrics] of perSource) {
    const sessions = metrics.get("sessions.total") ?? 0;
    const messages = metrics.get("messages.total") ?? null;
    const tokens = knownSum(TOKEN_METRICS.map((k) => metrics.get(k) ?? null));
    const cost = metrics.get("cost.total") ?? null;
    const input = metrics.get("tokens.input") ?? null;
    const cacheReadTokens = metrics.get("tokens.cache_read") ?? null;
    // Per-source cache_read defaults to 0 when no telemetry row exists (the
    // issue body's contract: "No cache activity → 0 for tokens saved"). The
    // rate computation uses sawCacheReadTelemetry to distinguish "no
    // activity" from "some activity but the formula gives 0".
    const cacheReadValue: number = cacheReadTokens ?? 0;
    if (cacheReadTokens !== null) sawCacheReadTelemetry = true;
    bySource[source] = { sessions, cost, tokens, cacheReadTokens: cacheReadValue, cacheSavingsUsd: null };
    totalCacheReadTokens += cacheReadValue;
    totalSessions += sessions;
    totalMessages = merge(totalMessages, messages);
    totalTokens = merge(totalTokens, tokens);
    totalCost = merge(totalCost, cost);
    totalInputTokens = merge(totalInputTokens, input);
  }

  const byModel = queryModelRows(db, from, to);

  // Per-source cache savings: re-query the per-(source, model) breakdown so
  // we attribute savings to each source without leaking the source into the
  // model rows that the byModel table is built from. The map carries:
  //   • source absent → source had no priced-model cache_read rows at all
  //     (legitimate zero, UI shows $0.00).
  //   • source present with a number → sum of per-model savings for that source.
  //   • source present with null → at least one unpriced model poisoned it
  //     (UI shows —, since "no price" is not the same as "no savings").
  const sourceModelSavings = querySourceModelSavings(db, from, to);
  for (const source of Object.keys(bySource)) {
    if (sourceModelSavings.has(source)) {
      bySource[source] = { ...bySource[source], cacheSavingsUsd: sourceModelSavings.get(source) ?? null };
    } else {
      bySource[source] = { ...bySource[source], cacheSavingsUsd: 0 };
    }
  }

  // Window total: sum of per-model savings, ignoring nulls (unpriced models
  // contribute nothing, but a priced model with cache_read still does). Only
  // when ALL models are unpriced does the total become null.
  let totalCacheSavingsUsd: number | null = null;
  for (const m of byModel) {
    if (m.cacheSavingsUsd === null) continue;
    totalCacheSavingsUsd = (totalCacheSavingsUsd ?? 0) + m.cacheSavingsUsd;
  }

  // Cache hit rate: only meaningful when at least one source has cache_read
  // telemetry. Otherwise the rate is genuinely unknown (UI → "—").
  const cacheHitRate = sawCacheReadTelemetry ? totalCacheReadTokens / ((totalInputTokens ?? 0) + totalCacheReadTokens) : null;

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalCost,
    cacheHitRate,
    totalCacheReadTokens,
    totalCacheSavingsUsd,
    bySource,
    byModel,
  };
}

/** Per-(source, model) cache_read sums so we can attribute savings to each
 *  source without leaking the source into the merged byModel rows. Returns
 *  null-poisoned savings: any unpriced model in a source → null savings. */
function querySourceModelSavings(db: Database, from: string, to: string): Map<string, number | null> {
  const rows = db
    .query(
      `SELECT source, json_extract(tags, '$.model') AS model,
              SUM(CASE WHEN metric = 'model.tokens_cache_read' THEN value END) AS cache_read
       FROM daily_metrics
       WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
         AND metric = 'model.tokens_cache_read'
       GROUP BY source, model`,
    )
    .all(from, to) as Array<{ source: string; model: string | null; cache_read: number | null }>;

  const result = new Map<string, number | null>();
  for (const r of rows) {
    if (!r.model) continue;
    const savings = cacheSavingsUsdForModel(r.model, r.cache_read);
    const existing = result.get(r.source);
    if (savings === null) {
      result.set(r.source, null);
    } else if (existing === null) {
      // already poisoned — keep null
    } else if (existing === undefined) {
      result.set(r.source, savings);
    } else {
      result.set(r.source, existing + savings);
    }
  }
  // Sources with no cache_read → confident 0 savings.
  return result;
}

/** Per-model rows from the accumulated daily_metrics model history, merged
 *  across sources into one row per normalized model (labels/families from
 *  the curated map, "unknown" dropped, sessions desc). */
function queryModelRows(db: Database, from: string, to: string): UsageAggregate["byModel"] {
  const rows = db
    .query(
      `SELECT source, json_extract(tags, '$.model') AS model, metric, SUM(value) AS value
       FROM daily_metrics
       WHERE date >= ? AND date <= ? AND source IN ('opencode', 'hermes')
         AND metric LIKE 'model.%'
       GROUP BY source, model, metric`,
    )
    .all(from, to) as Array<{ source: string; model: string | null; metric: string; value: number | null }>;

  const byKey = new Map<string, {
    model: string;
    sessions: number;
    cost: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
  }>();

  const merge = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  for (const r of rows) {
    if (!r.model) continue;
    const key = `${r.source}\u0000${r.model}`;
    let row = byKey.get(key);
    if (!row) {
      row = { model: r.model, sessions: 0, cost: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
      byKey.set(key, row);
    }
    switch (r.metric) {
      case "model.sessions":
        row.sessions += r.value ?? 0;
        break;
      case "model.cost":
        row.cost = merge(row.cost, r.value);
        break;
      case "model.tokens_input":
        row.inputTokens = merge(row.inputTokens, r.value);
        break;
      case "model.tokens_output":
        row.outputTokens = merge(row.outputTokens, r.value);
        break;
      case "model.tokens_cache_read":
        row.cacheReadTokens = merge(row.cacheReadTokens, r.value);
        break;
      case "model.tokens_cache_write":
        row.cacheWriteTokens = merge(row.cacheWriteTokens, r.value);
        break;
      case "model.tokens_reasoning":
        row.reasoningTokens = merge(row.reasoningTokens, r.value);
        break;
    }
  }

  // Cache savings is computed per-model via cacheSavingsUsdForModel — no need
  // to thread it through the daily_metrics schema; the daily_metrics writer
  // already emits `model.tokens_cache_read` and `model.tokens_input`, which
  // is all the formula needs. We compute the savings lazily in rowCacheSavings.
  return mergeModelRows(
    [...byKey.values()].map((r) => ({
      model: r.model,
      provider: null,
      sessions: r.sessions,
      messages: null,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      reasoningTokens: r.reasoningTokens,
      cost: r.cost,
      cacheSavingsUsd: cacheSavingsUsdForModel(r.model, r.cacheReadTokens),
    })),
  );
}
