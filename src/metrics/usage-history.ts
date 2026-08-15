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
  let windowCacheRead = 0;
  let windowInput = 0;

  const merge = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  for (const [source, metrics] of perSource) {
    const sessions = metrics.get("sessions.total") ?? 0;
    const messages = metrics.get("messages.total") ?? null;
    const tokens = knownSum(TOKEN_METRICS.map((k) => metrics.get(k) ?? null));
    const cost = metrics.get("cost.total") ?? null;
    const inputTokens = metrics.get("tokens.input") ?? 0;
    const cacheReadTokens = metrics.get("tokens.cache_read") ?? 0;
    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;
    bySource[source] = { sessions, cost, tokens, cacheReadTokens, cacheHitRate, cacheSavings: 0 };
    totalSessions += sessions;
    totalMessages = merge(totalMessages, messages);
    totalTokens = merge(totalTokens, tokens);
    totalCost = merge(totalCost, cost);
    windowCacheRead += cacheReadTokens;
    windowInput += inputTokens;
  }

  const byModel = queryModelRows(db, from, to);
  let windowSavings = 0;
  for (const m of byModel) {
    windowSavings += m.cacheSavings ?? 0;
    for (const [source, data] of Object.entries(m.bySource ?? {})) {
      const src = bySource[source];
      if (src) {
        src.cacheSavings = (src.cacheSavings ?? 0) + data.cacheSavings;
      }
    }
  }

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalCost,
    cacheReadTokens: windowCacheRead,
    cacheHitRate: windowCacheRead + windowInput > 0 ? windowCacheRead / (windowCacheRead + windowInput) : 0,
    cacheSavings: windowSavings,
    bySource,
    byModel,
  };
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
    source: string;
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
      row = { model: r.model, source: r.source, sessions: 0, cost: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningTokens: null };
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

  return mergeModelRows(
    [...byKey.values()].map((r) => ({
      model: r.model,
      provider: null,
      source: r.source,
      sessions: r.sessions,
      messages: null,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      reasoningTokens: r.reasoningTokens,
      cost: r.cost,
    })),
  );
}
