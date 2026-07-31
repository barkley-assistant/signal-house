/**
 * Hermes collector — reads Hermes Agent's state.db (read-only).
 *
 * `started_at` is epoch SECONDS (contract #10 — never mix with opencode's ms).
 * Cost comes from the DB's own columns (actual ?? estimated); when the DB has
 * no cost telemetry the value stays null and the UI renders "—".
 * Missing/locked/unsupported DB → degraded result, never a crash.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { Collector, CollectorResult, SourceData, UsageDay, ModelUsageRow } from "../../shared/types";
import { emptySourceData } from "../../shared/types";
import { utcDaysAgo } from "../../shared/dates";

export class HermesCollector implements Collector<SourceData> {
  readonly id = "hermes" as const;
  readonly tier = "agent" as const;
  readonly title = "Hermes Agent";

  constructor(private readonly dbPath: string, private readonly periodDays: number) {}

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    if (!existsSync(this.dbPath)) {
      return {
        source: "hermes",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: [`hermes state.db not found at ${this.dbPath}`],
        errors: [],
        unavailable: true,
      };
    }

    let db: Database;
    try {
      db = new Database(this.dbPath, { readonly: true, create: false });
    } catch (err) {
      return {
        source: "hermes",
        ok: false,
        data: null,
        durationMs: Date.now() - start,
        warnings: [],
        errors: [{ message: `cannot open hermes state.db: ${(err as Error).message}`, code: "open_failed", retryable: true }],
        unavailable: false,
      };
    }

    try {
      const hasSessions = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'").get();
      if (!hasSessions) {
        return {
          source: "hermes",
          ok: true,
          data: emptySourceData(),
          durationMs: Date.now() - start,
          warnings: ["hermes state.db has no sessions table — unsupported schema"],
          errors: [],
          unavailable: true,
        };
      }

      const sinceMs = Date.parse(`${utcDaysAgo(this.periodDays)}T00:00:00Z`);
      const sinceSec = sinceMs / 1000;
      const nowSec = Date.now() / 1000;
      const data = emptySourceData();
      data.usage = {
        source: "hermes",
        periodDays: this.periodDays,
        byDay: queryUsageByDay(db, sinceSec, nowSec),
        byModel: queryModelBreakdown(db, sinceSec, nowSec),
      };
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
      return { source: "hermes", ok: true, data, durationMs: Date.now() - start, warnings: [], errors: [], unavailable: false };
    } catch (err) {
      return {
        source: "hermes",
        ok: false,
        data: null,
        durationMs: Date.now() - start,
        warnings: [],
        errors: [{ message: `hermes query failed: ${(err as Error).message}`, code: "query_failed", retryable: true }],
        unavailable: false,
      };
    } finally {
      try {
        db.close();
      } catch {
        // already closed
      }
    }
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
  messages: number | null;
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
       SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) AS cost
FROM sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY day ORDER BY day`;

const MODEL_SQL = `
SELECT model,
       billing_provider AS provider,
       COUNT(*) AS sessions,
       SUM(message_count) AS messages,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens,
       SUM(cache_read_tokens) AS cache_read_tokens,
       SUM(cache_write_tokens) AS cache_write_tokens,
       SUM(reasoning_tokens) AS reasoning_tokens,
       SUM(COALESCE(actual_cost_usd, estimated_cost_usd)) AS cost
FROM sessions
WHERE started_at >= ? AND started_at < ?
GROUP BY model, billing_provider ORDER BY cost DESC NULLS LAST`;

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
    messages: r.messages ?? null,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
    cacheReadTokens: r.cache_read_tokens ?? null,
    cacheWriteTokens: r.cache_write_tokens ?? null,
    reasoningTokens: r.reasoning_tokens ?? null,
    cost: r.cost ?? null,
  }));
}
