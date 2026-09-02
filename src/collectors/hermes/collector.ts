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
import { utcDaysAgo } from "../../shared/dates";

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
      if (rows) day.byModel = [...rows.values()].sort(byCostDesc);
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

interface HermesDayRow {
  day: string;
  sessions: number;
  messages: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost: number | null;
}

interface HermesModelRow {
  model: string;
  provider: string | null;
  sessions: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost: number | null;
}

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

interface HermesModelDayRow extends HermesModelRow {
  day: string;
}

function queryUsageByDay(db: Database, sinceSec: number, nowSec: number): UsageDay[] {
  const rows = db.query(DAY_SQL).all(sinceSec, nowSec) as unknown as HermesDayRow[];
  return rows.map((r) => ({
    date: r.day,
    sessions: r.sessions,
    messages: r.messages ?? null,
    tokensInput: r.input_tokens ?? null,
    tokensOutput: r.output_tokens ?? null,
    tokensCacheRead: r.cache_read_tokens ?? null,
    tokensCacheWrite: r.cache_write_tokens ?? null,
    tokensReasoning: r.reasoning_tokens ?? null,
    cost: r.cost ?? null,
  }));
}

function queryModelBreakdown(db: Database, sinceSec: number, nowSec: number): ModelUsageRow[] {
  const rows = db.query(MODEL_SQL).all(sinceSec, nowSec) as unknown as HermesModelRow[];
  return rows.map((r) => ({
    model: r.model ?? "unknown",
    provider: r.provider ?? null,
    sessions: r.sessions,
    messages: null,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
    cacheReadTokens: r.cache_read_tokens ?? null,
    cacheWriteTokens: r.cache_write_tokens ?? null,
    reasoningTokens: r.reasoning_tokens ?? null,
    cost: r.cost ?? null,
  }));
}

/** Per-UTC-day model rows, keyed by day — the per-day breakdown the
 *  orchestrator persists into daily_metrics. */
function queryModelBreakdownByDay(db: Database, sinceSec: number, nowSec: number): Map<string, ModelUsageRow[]> {
  const rows = db.query(MODEL_BY_DAY_SQL).all(sinceSec, nowSec) as unknown as HermesModelDayRow[];
  const byDay = new Map<string, ModelUsageRow[]>();
  for (const r of rows) {
    if (!r.day) continue;
    let list = byDay.get(r.day);
    if (!list) {
      list = [];
      byDay.set(r.day, list);
    }
    list.push({
      model: r.model ?? "unknown",
      provider: r.provider ?? null,
      sessions: r.sessions,
      messages: null,
      inputTokens: r.input_tokens ?? null,
      outputTokens: r.output_tokens ?? null,
      cacheReadTokens: r.cache_read_tokens ?? null,
      cacheWriteTokens: r.cache_write_tokens ?? null,
      reasoningTokens: r.reasoning_tokens ?? null,
      cost: r.cost ?? null,
    });
  }
  return byDay;
}

/** Sum two nullable numbers; null only when BOTH are null. */
function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Match the SQL grouping key: (model, billing_provider). */
function modelKey(model: string, provider: string | null): string {
  return `${model}\u0000${provider ?? ""}`;
}

function mergeUsageDay(map: Map<string, UsageDay>, incoming: UsageDay): void {
  const existing = map.get(incoming.date);
  if (!existing) {
    map.set(incoming.date, { ...incoming });
    return;
  }
  existing.sessions += incoming.sessions;
  existing.messages = sumNullable(existing.messages, incoming.messages);
  existing.tokensInput = sumNullable(existing.tokensInput, incoming.tokensInput);
  existing.tokensOutput = sumNullable(existing.tokensOutput, incoming.tokensOutput);
  existing.tokensCacheRead = sumNullable(existing.tokensCacheRead, incoming.tokensCacheRead);
  existing.tokensCacheWrite = sumNullable(existing.tokensCacheWrite, incoming.tokensCacheWrite);
  existing.tokensReasoning = sumNullable(existing.tokensReasoning, incoming.tokensReasoning);
  existing.cost = sumNullable(existing.cost, incoming.cost);
}

function mergeModelRow(target: ModelUsageRow, incoming: ModelUsageRow): void {
  target.sessions += incoming.sessions;
  target.messages = sumNullable(target.messages, incoming.messages);
  target.inputTokens = sumNullable(target.inputTokens, incoming.inputTokens);
  target.outputTokens = sumNullable(target.outputTokens, incoming.outputTokens);
  target.cacheReadTokens = sumNullable(target.cacheReadTokens, incoming.cacheReadTokens);
  target.cacheWriteTokens = sumNullable(target.cacheWriteTokens, incoming.cacheWriteTokens);
  target.reasoningTokens = sumNullable(target.reasoningTokens, incoming.reasoningTokens);
  target.cost = sumNullable(target.cost, incoming.cost);
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