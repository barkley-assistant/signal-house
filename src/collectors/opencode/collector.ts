/**
 * OpenCode collector — reads opencode's own SQLite DB (read-only).
 *
 * Contracts honoured:
 * - #6: `session.cost` is read faithfully — never recomputed, rescaled, or
 *   fallen back. Cost math is upstream's responsibility.
 * - #8: `providerID` is read from the JSON in `session.model`
 *   (json_extract), never inferred from a slash-split on the id.
 * - #10: `time_created` is epoch MILLISECONDS (divide by 1000 for SQLite's
 *   unixepoch), unlike hermes's epoch seconds.
 * - #9: no synthetic zero-row days — absent rows are the "no activity" signal.
 * `messages` is null: opencode's session table has no message count column.
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { Collector, CollectorResult, SourceData, UsageDay, ModelUsageRow, UsageSummary } from "../../shared/types";
import { emptySourceData } from "../../shared/types";
import { utcDaysAgo } from "../../shared/dates";
import { WINDOW_PRESETS } from "../../shared/window";

export class OpencodeCollector implements Collector<SourceData> {
  readonly id = "opencode" as const;
  readonly tier = "tool" as const;
  readonly title = "OpenCode";

  constructor(private readonly dbPath: string, private readonly periodDays: number) {}

  async collect(signal: AbortSignal): Promise<CollectorResult<SourceData>> {
    const start = Date.now();
    if (!existsSync(this.dbPath)) {
      return {
        source: "opencode",
        ok: true,
        data: emptySourceData(),
        durationMs: Date.now() - start,
        warnings: [`opencode.db not found at ${this.dbPath}`],
        errors: [],
        unavailable: true,
      };
    }

    let db: Database;
    try {
      db = new Database(this.dbPath, { readonly: true, create: false });
    } catch (err) {
      return {
        source: "opencode",
        ok: false,
        data: null,
        durationMs: Date.now() - start,
        warnings: [],
        errors: [{ message: `cannot open opencode.db: ${(err as Error).message}`, code: "open_failed", retryable: true }],
        unavailable: false,
      };
    }

    try {
      const hasSession = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='session'").get();
      if (!hasSession) {
        return {
          source: "opencode",
          ok: true,
          data: emptySourceData(),
          durationMs: Date.now() - start,
          warnings: ["opencode.db has no session table — unsupported schema"],
          errors: [],
          unavailable: true,
        };
      }

      const sinceMs = Date.parse(`${utcDaysAgo(this.periodDays)}T00:00:00Z`);
      const data = emptySourceData();
      // Per-window model breakdowns (7/30/90 days) so the dashboard filter can
      // show an exact by-model table per window. The period query stays the
      // fallback for sources that predate this field.
      const byModelByWindow: NonNullable<UsageSummary["byModelByWindow"]> = {};
      for (const days of WINDOW_PRESETS) {
        byModelByWindow[days] = queryModelBreakdown(db, Date.parse(`${utcDaysAgo(days)}T00:00:00Z`));
      }
      data.usage = {
        source: "opencode",
        periodDays: this.periodDays,
        byDay: queryUsageByDay(db, sinceMs),
        byModel: queryModelBreakdown(db, sinceMs),
        byModelByWindow,
      };
      if (signal.aborted) {
        return {
          source: "opencode",
          ok: false,
          data: null,
          durationMs: Date.now() - start,
          warnings: [],
          errors: [{ message: "cancelled", code: "cancelled", retryable: false }],
          unavailable: false,
        };
      }
      return { source: "opencode", ok: true, data, durationMs: Date.now() - start, warnings: [], errors: [], unavailable: false };
    } catch (err) {
      return {
        source: "opencode",
        ok: false,
        data: null,
        durationMs: Date.now() - start,
        warnings: [],
        errors: [{ message: `opencode query failed: ${(err as Error).message}`, code: "query_failed", retryable: true }],
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

interface OpencodeDayRow {
  day: string;
  sessions: number;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  cost: number | null;
}

interface OpencodeModelRow {
  model: string | null;
  provider: string | null;
  sessions: number;
  tokens_input: number | null;
  tokens_output: number | null;
  tokens_reasoning: number | null;
  tokens_cache_read: number | null;
  tokens_cache_write: number | null;
  cost: number | null;
}

const DAY_SQL = `
SELECT strftime('%Y-%m-%d', time_created / 1000, 'unixepoch') AS day,
       COUNT(*) AS sessions,
       SUM(tokens_input) AS tokens_input,
       SUM(tokens_output) AS tokens_output,
       SUM(tokens_reasoning) AS tokens_reasoning,
       SUM(tokens_cache_read) AS tokens_cache_read,
       SUM(tokens_cache_write) AS tokens_cache_write,
       SUM(cost) AS cost
FROM session
WHERE time_created >= ? AND time_created < ?
GROUP BY day ORDER BY day`;

const MODEL_SQL = `
SELECT COALESCE(NULLIF(json_extract(m.data, '$.modelID'), ''), json_extract(s.model, '$.id')) AS model,
       COALESCE(NULLIF(json_extract(m.data, '$.providerID'), ''), json_extract(s.model, '$.providerID')) AS provider,
       COUNT(DISTINCT m.session_id) AS sessions,
       SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0)) AS tokens_input,
       SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0)) AS tokens_output,
       SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0)) AS tokens_reasoning,
       SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0)) AS tokens_cache_read,
       SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0)) AS tokens_cache_write,
       SUM(COALESCE(json_extract(m.data, '$.cost'), 0)) AS cost
FROM message m
JOIN session s ON s.id = m.session_id
WHERE json_extract(m.data, '$.role') = 'assistant'
  AND s.time_created >= ? AND s.time_created < ?
GROUP BY 1, 2
ORDER BY cost DESC NULLS LAST`;

function queryUsageByDay(db: Database, sinceMs: number): UsageDay[] {
  const rows = db.query(DAY_SQL).all(sinceMs, Date.now()) as unknown as OpencodeDayRow[];
  return rows.map((r) => ({
    date: r.day,
    sessions: r.sessions,
    messages: null,
    tokensInput: r.tokens_input ?? null,
    tokensOutput: r.tokens_output ?? null,
    tokensCacheRead: r.tokens_cache_read ?? null,
    tokensCacheWrite: r.tokens_cache_write ?? null,
    tokensReasoning: r.tokens_reasoning ?? null,
    cost: r.cost ?? null,
  }));
}

function queryModelBreakdown(db: Database, sinceMs: number): ModelUsageRow[] {
  const rows = db.query(MODEL_SQL).all(sinceMs, Date.now()) as unknown as OpencodeModelRow[];
  return rows.map((r) => ({
    model: r.model ?? "unknown",
    provider: r.provider ?? null,
    sessions: r.sessions,
    messages: null,
    inputTokens: r.tokens_input ?? null,
    outputTokens: r.tokens_output ?? null,
    cacheReadTokens: r.tokens_cache_read ?? null,
    cacheWriteTokens: r.tokens_cache_write ?? null,
    reasoningTokens: r.tokens_reasoning ?? null,
    cost: r.cost ?? null,
  }));
}
