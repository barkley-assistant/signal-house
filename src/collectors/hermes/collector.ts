/**
 * Hermes collector — reads Hermes Agent's state.db (read-only).
 *
 * Hermes runs one HOME per profile: the default profile's sessions live in
 * the primary `state.db` (default `~/.hermes/state.db`), and every other
 * profile (architect, builder, reviewer, …) keeps its own
 * `~/.hermes/profiles/<profile>/state.db`. Subagent and kanban-worker usage
 * is recorded in the profile DBs, never in the primary one — so the collector
 * merges every profile's state.db into one source.
 *
 * `started_at` is epoch SECONDS (contract #10 — never mix with opencode's ms).
 * Cost comes from the DB's own columns (actual ?? estimated); when the DB has
 * no cost telemetry the value stays null and the UI renders "—".
 * Day token/cost totals derive from session_model_usage (the superset): the
 * sessions row only carries main-task calls, while session_model_usage also
 * records auxiliary work (background_review forks, vision, approval, title
 * generation, compression) — so the day totals always equal the sum of their
 * by-model rows. When hermes records a usage row's activity window
 * (first_seen → last_seen), the row is split across the UTC days it was
 * active in (time-weighted) — long-running sessions attribute their tokens
 * to the days they were actually spent, not the session's start day.
 * Sessions/messages counts stay on the sessions table (start-day).
 * Missing/locked/unsupported DB → degraded result, never a crash: one broken
 * profile DB is a warning, not a source failure.
 */

import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Collector,
  CollectorError,
  CollectorResult,
  ModelUsageRow,
  SourceData,
  UsageDay,
} from "../../shared/types";
import { emptySourceData } from "../../shared/types";
import { mergeNullSum } from "../../shared/math";
import { utcDaysAgo, utcDay } from "../../shared/dates";
import { dayToUsageDay, modelBreakdownByDay, modelToModelUsageRow, type UsageColumns } from "../usage-mappers";

export class HermesCollector implements Collector<SourceData> {
  readonly id = "hermes" as const;
  readonly tier = "agent" as const;
  readonly title = "Hermes Agent";

  constructor(
    private readonly dbPath: string,
    private readonly periodDays: number,
    private readonly profilesDir: string | null = null,
  ) {}

  /**
   * Every existing state.db the collector should read: the primary path plus
   * `<profilesDir>/<profile>/state.db` for each profile. Profile names
   * containing a dot ("builder.pre-repair", hidden dirs) are stale copies or
   * backups — their state.db was copied from the live profile and including
   * it would double-count every session.
   */
  private resolveDbPaths(): string[] {
    const paths: string[] = [];
    if (existsSync(this.dbPath)) paths.push(this.dbPath);
    if (this.profilesDir) {
      try {
        for (const entry of readdirSync(this.profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name.includes(".")) continue;
          const profileDb = join(this.profilesDir, entry.name, "state.db");
          if (existsSync(profileDb)) paths.push(profileDb);
        }
      } catch {
        // profiles dir missing/unreadable — the primary db still works
      }
    }
    return paths;
  }

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    const paths = this.resolveDbPaths();
    if (paths.length === 0) {
      return {
        source: "hermes",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: [
          `no hermes state.db found (primary: ${this.dbPath}${
            this.profilesDir ? `, profiles: ${this.profilesDir}/*/state.db` : ""
          })`,
        ],
        errors: [],
        unavailable: true,
      };
    }

    const sinceSec = Date.parse(`${utcDaysAgo(this.periodDays)}T00:00:00Z`) / 1000;
    const nowSec = Date.now() / 1000;

    const warnings: string[] = [];
    const errors: CollectorError[] = [];
    const byDayMap = new Map<string, UsageDay>();
    const byModelMap = new Map<string, ModelUsageRow>();
    const modelsByDayMap = new Map<string, Map<string, ModelUsageRow>>();
    let anyOk = false;

    for (const path of paths) {
      if (signal.aborted) {
        return {
          source: "hermes",
          ok: false,
          data: null,
          durationMs: Date.now() - start,
          warnings: [],
          errors: [{ message: "cancelled", code: "cancelled", retryable: false }],
          unavailable: false,
        };
      }

      let db: Database;
      try {
        db = new Database(path, { readonly: true, create: false });
      } catch (err) {
        errors.push({
          message: `cannot open hermes state.db ${path}: ${(err as Error).message}`,
          code: "open_failed",
          retryable: true,
        });
        continue;
      }

      try {
        const hasSessions = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
        if (!hasSessions) {
          warnings.push(`hermes state.db ${path} has no sessions table — unsupported schema`);
          continue;
        }

        for (const day of queryUsageByDay(db, sinceSec, nowSec)) mergeUsageDay(byDayMap, day);
        const supportsSpans = hasUsageSpans(db);
        for (const [date, rows] of queryModelBreakdownByDay(db, sinceSec, nowSec, supportsSpans)) {
          for (const row of rows) mergeModelIntoDayMap(modelsByDayMap, date, row);
        }
        for (const row of queryModelBreakdown(db, sinceSec, nowSec)) mergeModelIntoMap(byModelMap, row);
        anyOk = true;
      } catch (err) {
        errors.push({
          message: `hermes query failed for ${path}: ${(err as Error).message}`,
          code: "query_failed",
          retryable: true,
        });
      } finally {
        try {
          db.close();
        } catch {
          // already closed
        }
      }
    }

    if (!anyOk) {
      return {
        source: "hermes",
        ok: errors.length === 0,
        data: null,
        durationMs: Date.now() - start,
        warnings,
        errors,
        unavailable: errors.length === 0,
      };
    }

    // Days may exist in the model breakdown without any session STARTED that
    // day — a long-running session's usage spans into them (activity-split
    // attribution). Emit those days too, with no session/message counts, so
    // the daily_metrics history covers every day the models actually worked.
    for (const date of modelsByDayMap.keys()) {
      if (!byDayMap.has(date)) {
        byDayMap.set(date, {
          date,
          sessions: 0,
          messages: null,
          tokensInput: null,
          tokensOutput: null,
          tokensCacheRead: null,
          tokensCacheWrite: null,
          tokensReasoning: null,
          cost: null,
        });
      }
    }
    const byDay = [...byDayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const day of byDay) {
      const rows = modelsByDayMap.get(day.date);
      if (rows) {
        const modelRows = [...rows.values()].sort(byCostDesc);
        day.byModel = modelRows;
        // Day totals must equal the sum of their by-model rows. The sessions
        // table only carries main-task tokens/cost; session_model_usage also
        // records auxiliary work (background_review forks, vision, approval,
        // title generation, compression — root-caused 2026-09-25). Deriving
        // the day totals from the model rows keeps the hero / daily chart
        // consistent with the by-model table by construction.
        day.tokensInput = sumModelRows(modelRows, (r) => r.inputTokens);
        day.tokensOutput = sumModelRows(modelRows, (r) => r.outputTokens);
        day.tokensCacheRead = sumModelRows(modelRows, (r) => r.cacheReadTokens);
        day.tokensCacheWrite = sumModelRows(modelRows, (r) => r.cacheWriteTokens);
        day.tokensReasoning = sumModelRows(modelRows, (r) => r.reasoningTokens);
        day.cost = sumModelRows(modelRows, (r) => r.cost);
      }
    }

    const data = emptySourceData();
    data.usage = {
      source: "hermes",
      periodDays: this.periodDays,
      byDay,
      byModel: [...byModelMap.values()].sort(byCostDesc),
    };
    return {
      source: "hermes",
      ok: true,
      data,
      durationMs: Date.now() - start,
      warnings,
      errors,
      unavailable: false,
    };
  }
}

/** Aggregate column aliases for hermes's SQL (epoch SECONDS — contract #10). */
const COLUMNS: UsageColumns = {
  tokensInput: "input_tokens",
  tokensOutput: "output_tokens",
  tokensReasoning: "reasoning_tokens",
  tokensCacheRead: "cache_read_tokens",
  tokensCacheWrite: "cache_write_tokens",
  cost: "cost",
  messages: "messages",
};

const DAY_SQL = `
SELECT strftime('%Y-%m-%d', started_at, 'unixepoch') AS day,
       COUNT(*) AS sessions,
       SUM(message_count) AS messages,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens,
       SUM(reasoning_tokens) AS reasoning_tokens,
       SUM(COALESCE(NULLIF(actual_cost_usd, 0), estimated_cost_usd)) AS cost
FROM sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY day ORDER BY day`;

const MODEL_SQL = `
SELECT model,
       billing_provider AS provider,
       COUNT(DISTINCT session_id) AS sessions,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(reasoning_tokens) AS reasoning_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens,
       SUM(COALESCE(NULLIF(actual_cost_usd, 0), estimated_cost_usd)) AS cost
FROM session_model_usage
WHERE session_id IN (SELECT id FROM sessions WHERE started_at >= ? AND started_at < ?)
GROUP BY model, billing_provider ORDER BY cost DESC NULLS LAST`;

/** Same breakdown grouped by UTC day — feeds signal-house's own per-day
 *  per-model history (daily_metrics), which accumulates 90 days of by-model
 *  data regardless of upstream retention.
 *
 *  Two modes, chosen per-DB by schema detection (hasUsageSpans):
 *  - Span mode (hermes with first_seen/last_seen): each usage row is split
 *    across the UTC days it was active in, time-weighted, so a long-running
 *    session's tokens land on the days they were actually spent rather than
 *    the session's start day.
 *  - Legacy mode (older schemas without the span columns): the whole row is
 *    attributed to the session's start day, as before. */
const MODEL_SPAN_SQL = `
SELECT u.session_id AS session_id,
       u.model AS model,
       u.billing_provider AS provider,
       s.started_at AS session_started_at,
       u.first_seen AS first_seen,
       u.last_seen AS last_seen,
       u.input_tokens AS input_tokens,
       u.output_tokens AS output_tokens,
       u.reasoning_tokens AS reasoning_tokens,
       u.cache_read_tokens AS cache_read_tokens,
       u.cache_write_tokens AS cache_write_tokens,
       COALESCE(NULLIF(u.actual_cost_usd, 0), u.estimated_cost_usd) AS cost
FROM session_model_usage u
JOIN sessions s ON s.id = u.session_id
WHERE s.started_at >= ? AND s.started_at < ?`;

/** Same breakdown grouped by UTC session day — feeds signal-house's own
 *  per-day per-model history (daily_metrics), which accumulates 90 days of
 *  by-model data regardless of upstream retention. */
const MODEL_BY_DAY_SQL = `
SELECT strftime('%Y-%m-%d', s.started_at, 'unixepoch') AS day,
       u.model AS model,
       u.billing_provider AS provider,
       COUNT(DISTINCT u.session_id) AS sessions,
       SUM(u.input_tokens) AS input_tokens,
       SUM(u.output_tokens) AS output_tokens,
       SUM(u.reasoning_tokens) AS reasoning_tokens,
       SUM(u.cache_read_tokens) AS cache_read_tokens,
       SUM(u.cache_write_tokens) AS cache_write_tokens,
       SUM(COALESCE(NULLIF(u.actual_cost_usd, 0), u.estimated_cost_usd)) AS cost
FROM session_model_usage u
JOIN sessions s ON s.id = u.session_id
WHERE s.started_at >= ? AND s.started_at < ?
GROUP BY 1, 2, 3
ORDER BY 1, cost DESC NULLS LAST`;

function queryUsageByDay(db: Database, sinceSec: number, nowSec: number): UsageDay[] {
  return (db.query(DAY_SQL).all(sinceSec, nowSec) as unknown as Array<Record<string, unknown>>).map((r) =>
    dayToUsageDay(r, COLUMNS),
  );
}

function queryModelBreakdown(db: Database, sinceSec: number, nowSec: number): ModelUsageRow[] {
  return (db.query(MODEL_SQL).all(sinceSec, nowSec) as unknown as Array<Record<string, unknown>>).map((r) =>
    modelToModelUsageRow(r, COLUMNS),
  );
}

/** Per-UTC-day model rows, keyed by day — the per-day breakdown the
 *  orchestrator persists into daily_metrics. Uses span mode when the DB's
 *  session_model_usage carries first_seen/last_seen, legacy grouping
 *  otherwise. */
function queryModelBreakdownByDay(
  db: Database,
  sinceSec: number,
  nowSec: number,
  supportsSpans: boolean,
): Map<string, ModelUsageRow[]> {
  if (!supportsSpans) {
    return modelBreakdownByDay(db.query(MODEL_BY_DAY_SQL).all(sinceSec, nowSec) as unknown as Array<Record<string, unknown>>, COLUMNS);
  }
  const raw = db.query(MODEL_SPAN_SQL).all(sinceSec, nowSec) as unknown as Array<Record<string, unknown>>;
  const byDay = new Map<string, Map<string, ModelUsageRow>>();
  // Distinct session count per (day, model, provider): the same session can
  // contribute several usage rows (model switches, task splits) and pieces on
  // several days — it must count ONCE per day it was active on, not once per
  // row or per piece.
  const seenSessions = new Map<string, Set<string>>();
  for (const r of raw) {
    for (const piece of splitModelUsageByDay(spanFromRow(r))) {
      mergeModelIntoDayMap(byDay, piece.day, piece.row);
      const key = `${piece.day}\u0000${modelKey(piece.row.model, piece.row.provider)}`;
      let set = seenSessions.get(key);
      if (!set) {
        set = new Set();
        seenSessions.set(key, set);
      }
      set.add(piece.sessionId);
    }
  }
  const out = new Map<string, ModelUsageRow[]>();
  for (const [day, rows] of byDay) {
    const list: ModelUsageRow[] = [];
    for (const [key, row] of rows) {
      list.push({ ...row, sessions: seenSessions.get(`${day}\u0000${key}`)?.size ?? 0 });
    }
    list.sort(byCostDesc);
    out.set(day, list);
  }
  return out;
}

/** True when the DB's session_model_usage has the span columns hermes uses
 *  to bound a usage row's activity window (first_seen → last_seen). */
function hasUsageSpans(db: Database): boolean {
  try {
    const cols = db.query("PRAGMA table_info(session_model_usage)").all() as Array<{ name: string }>;
    return cols.some((c) => c.name === "first_seen") && cols.some((c) => c.name === "last_seen");
  } catch {
    return false;
  }
}

/** Raw span-mode SQL row → ModelUsageSpan. */
function spanFromRow(r: Record<string, unknown>): ModelUsageSpan {
  return {
    sessionId: String(r.session_id),
    model: (r.model as string | null) ?? "unknown",
    provider: (r.provider as string | null) ?? null,
    sessionStartedAt: Number(r.session_started_at),
    firstSeen: (r.first_seen as number | null) ?? null,
    lastSeen: (r.last_seen as number | null) ?? null,
    inputTokens: (r.input_tokens as number | null) ?? null,
    outputTokens: (r.output_tokens as number | null) ?? null,
    reasoningTokens: (r.reasoning_tokens as number | null) ?? null,
    cacheReadTokens: (r.cache_read_tokens as number | null) ?? null,
    cacheWriteTokens: (r.cache_write_tokens as number | null) ?? null,
    cost: (r.cost as number | null) ?? null,
  };
}

/** One usage row's activity window, as read from hermes's DB. */
export interface ModelUsageSpan {
  sessionId: string;
  model: string;
  provider: string | null;
  /** Session start (epoch SECONDS) — fallback day when spans are missing. */
  sessionStartedAt: number;
  /** Epoch SECONDS (contract #10, never ms). */
  firstSeen: number | null;
  lastSeen: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
}

/** A split piece of a usage row: the (day, session) it belongs to plus the
 *  row fragment. `sessions` is always 0 here — distinct session counts are
 *  applied by the caller after de-duplicating per (day, model). */
export interface ModelUsagePiece {
  day: string;
  sessionId: string;
  row: ModelUsageRow;
}

/** Split a usage row across the UTC days its activity window overlaps,
 *  time-weighted. Rows that never span a day boundary (the common case)
 *  return one piece with the full values; rows without span columns fall
 *  back to the session's start day. Token/cost totals are conserved exactly:
 *  fractions are rounded and the last piece absorbs the rounding remainder.
 *  Without per-call timestamps this is the honest estimate — hermes only
 *  records the aggregate window (first_seen → last_seen) per row. */
export function splitModelUsageByDay(span: ModelUsageSpan): ModelUsagePiece[] {
  const fallbackDay = utcDay(new Date(span.sessionStartedAt * 1000));
  const first = span.firstSeen;
  const last = span.lastSeen;
  if (first == null || last == null || last <= first) {
    return [{ day: fallbackDay, sessionId: span.sessionId, row: spanRow(span) }];
  }
  const spanSec = last - first;
  const bounds: Array<{ day: string; start: number; end: number }> = [];
  let cursor = first;
  while (cursor < last) {
    const dayStart = Math.floor(cursor / 86_400) * 86_400;
    const dayEnd = dayStart + 86_400;
    const end = Math.min(last, dayEnd);
    bounds.push({ day: utcDay(new Date(cursor * 1000)), start: cursor, end });
    cursor = end;
  }
  const fractions = bounds.map((b) => (b.end - b.start) / spanSec);
  const cols: Array<[keyof ModelUsageRow, number | null, number]> = [
    ["inputTokens", span.inputTokens, 1],
    ["outputTokens", span.outputTokens, 1],
    ["reasoningTokens", span.reasoningTokens, 1],
    ["cacheReadTokens", span.cacheReadTokens, 1],
    ["cacheWriteTokens", span.cacheWriteTokens, 1],
    ["cost", span.cost, 100],
  ];
  const splitCols = new Map(cols.map(([col, total, unit]) => [col, splitProportional(total, fractions, unit)]));
  return bounds.map((b, i) => ({
    day: b.day,
    sessionId: span.sessionId,
    row: {
      model: span.model,
      provider: span.provider,
      sessions: 0,
      messages: null,
      inputTokens: splitCols.get("inputTokens")![i],
      outputTokens: splitCols.get("outputTokens")![i],
      cacheReadTokens: splitCols.get("cacheReadTokens")![i],
      cacheWriteTokens: splitCols.get("cacheWriteTokens")![i],
      reasoningTokens: splitCols.get("reasoningTokens")![i],
      cost: splitCols.get("cost")![i],
    },
  }));
}

/** Whole-row values for the no-span fallback (used when the row never
 *  crosses a day boundary or the DB lacks span columns). */
function spanRow(span: ModelUsageSpan): ModelUsageRow {
  return {
    model: span.model,
    provider: span.provider,
    sessions: 0,
    messages: null,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    cacheReadTokens: span.cacheReadTokens,
    cacheWriteTokens: span.cacheWriteTokens,
    reasoningTokens: span.reasoningTokens,
    cost: span.cost,
  };
}

/** Round `total * fraction` per piece (to `unit` granularity); the last
 *  piece absorbs the rounding remainder so the pieces always sum to exactly
 *  `total`. Null totals split into nulls (unknown stays unknown). */
function splitProportional(total: number | null, fractions: number[], unit = 1): Array<number | null> {
  if (total == null) return fractions.map(() => null);
  const parts = fractions.map((f) => Math.round(total * f * unit) / unit);
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}

/** Match the SQL grouping key: (model, billing_provider). */
function modelKey(model: string, provider: string | null): string {
  return `${model}\u0000${provider ?? ""}`;
}

/** Null-safe sum of one field across model rows — null when every row is null. */
function sumModelRows(rows: ModelUsageRow[], pick: (r: ModelUsageRow) => number | null): number | null {
  return rows.reduce<number | null>((acc, r) => mergeNullSum(acc, pick(r)), null);
}

function mergeUsageDay(map: Map<string, UsageDay>, incoming: UsageDay): void {
  const existing = map.get(incoming.date);
  if (!existing) {
    map.set(incoming.date, { ...incoming });
    return;
  }
  existing.sessions += incoming.sessions;
  existing.messages = mergeNullSum(existing.messages, incoming.messages);
  existing.tokensInput = mergeNullSum(existing.tokensInput, incoming.tokensInput);
  existing.tokensOutput = mergeNullSum(existing.tokensOutput, incoming.tokensOutput);
  existing.tokensCacheRead = mergeNullSum(existing.tokensCacheRead, incoming.tokensCacheRead);
  existing.tokensCacheWrite = mergeNullSum(existing.tokensCacheWrite, incoming.tokensCacheWrite);
  existing.tokensReasoning = mergeNullSum(existing.tokensReasoning, incoming.tokensReasoning);
  existing.cost = mergeNullSum(existing.cost, incoming.cost);
}

function mergeModelRow(target: ModelUsageRow, incoming: ModelUsageRow): void {
  target.sessions += incoming.sessions;
  target.messages = mergeNullSum(target.messages, incoming.messages);
  target.inputTokens = mergeNullSum(target.inputTokens, incoming.inputTokens);
  target.outputTokens = mergeNullSum(target.outputTokens, incoming.outputTokens);
  target.cacheReadTokens = mergeNullSum(target.cacheReadTokens, incoming.cacheReadTokens);
  target.cacheWriteTokens = mergeNullSum(target.cacheWriteTokens, incoming.cacheWriteTokens);
  target.reasoningTokens = mergeNullSum(target.reasoningTokens, incoming.reasoningTokens);
  target.cost = mergeNullSum(target.cost, incoming.cost);
}

/** Merge a model row into the window-wide byModel map. */
function mergeModelIntoMap(map: Map<string, ModelUsageRow>, incoming: ModelUsageRow): void {
  const key = modelKey(incoming.model, incoming.provider);
  const existing = map.get(key);
  if (existing) mergeModelRow(existing, incoming);
  else map.set(key, { ...incoming });
}

/** Merge a model row into the per-day modelsByDay map (date → rows). */
function mergeModelIntoDayMap(
  map: Map<string, Map<string, ModelUsageRow>>,
  date: string,
  incoming: ModelUsageRow,
): void {
  let dayMap = map.get(date);
  if (!dayMap) {
    dayMap = new Map();
    map.set(date, dayMap);
  }
  const key = modelKey(incoming.model, incoming.provider);
  const existing = dayMap.get(key);
  if (existing) mergeModelRow(existing, incoming);
  else dayMap.set(key, { ...incoming });
}

/** Mirrors the SQL `ORDER BY cost DESC NULLS LAST`. */
function byCostDesc(a: ModelUsageRow, b: ModelUsageRow): number {
  return (b.cost ?? -Infinity) - (a.cost ?? -Infinity);
}