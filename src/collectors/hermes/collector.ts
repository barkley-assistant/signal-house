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
 * by-model rows. Sessions/messages counts stay on the sessions table.
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
import { utcDaysAgo } from "../../shared/dates";
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
        for (const [date, rows] of queryModelBreakdownByDay(db, sinceSec, nowSec)) {
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
 *  orchestrator persists into daily_metrics. */
function queryModelBreakdownByDay(db: Database, sinceSec: number, nowSec: number): Map<string, ModelUsageRow[]> {
  return modelBreakdownByDay(db.query(MODEL_BY_DAY_SQL).all(sinceSec, nowSec) as unknown as Array<Record<string, unknown>>, COLUMNS);
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