/**
 * Shared row-mappers for the SQLite usage collectors (hermes + opencode).
 *
 * The two collectors' SQL is genuinely different (different tables,
 * different epoch units, different JSON extraction), but the three
 * aggregate-row mappers are verbatim copies apart from column names:
 * hermes names its aggregate columns `input_tokens`/`output_tokens`/…,
 * opencode names them `tokens_input`/`tokens_output`/…. The column
 * aliases are parameterized so each collector's SQL keeps its natural
 * names while the mapping code lives in ONE place.
 *
 * The epoch-unit difference (hermes seconds vs opencode ms, contract #10)
 * stays in each collector's query call — never normalized here.
 */

import type { ModelUsageRow, UsageDay } from "../shared/types";

/** SQL column aliases for the aggregate fields. */
export interface UsageColumns {
  tokensInput: string;
  tokensOutput: string;
  tokensReasoning: string;
  tokensCacheRead: string;
  tokensCacheWrite: string;
  cost: string;
  /** Column holding the day's message count, or null when the source has
   *  no message telemetry (opencode's session table has none). */
  messages: string | null;
}

type RawRow = Record<string, unknown>;

/** Aggregate day row → UsageDay. `messages` comes from the configured
 *  column when the source has it; otherwise it stays null (unknown, not 0). */
export function dayToUsageDay(r: RawRow, cols: UsageColumns): UsageDay {
  return {
    date: String(r.day),
    sessions: Number(r.sessions),
    messages: cols.messages ? (r[cols.messages] as number | null) ?? null : null,
    tokensInput: (r[cols.tokensInput] as number | null) ?? null,
    tokensOutput: (r[cols.tokensOutput] as number | null) ?? null,
    tokensCacheRead: (r[cols.tokensCacheRead] as number | null) ?? null,
    tokensCacheWrite: (r[cols.tokensCacheWrite] as number | null) ?? null,
    tokensReasoning: (r[cols.tokensReasoning] as number | null) ?? null,
    cost: (r[cols.cost] as number | null) ?? null,
  };
}

/** Aggregate model row → ModelUsageRow. `messages` is always null: neither
 *  collector's model-level query exposes a message count. */
export function modelToModelUsageRow(r: RawRow, cols: UsageColumns): ModelUsageRow {
  return {
    model: (r.model as string | null) ?? "unknown",
    provider: (r.provider as string | null) ?? null,
    sessions: Number(r.sessions),
    messages: null,
    inputTokens: (r[cols.tokensInput] as number | null) ?? null,
    outputTokens: (r[cols.tokensOutput] as number | null) ?? null,
    cacheReadTokens: (r[cols.tokensCacheRead] as number | null) ?? null,
    cacheWriteTokens: (r[cols.tokensCacheWrite] as number | null) ?? null,
    reasoningTokens: (r[cols.tokensReasoning] as number | null) ?? null,
    cost: (r[cols.cost] as number | null) ?? null,
  };
}

/** Per-UTC-day model rows, keyed by day — the per-day breakdown the
 *  orchestrator persists into daily_metrics. Rows without a `day` are
 *  skipped (defensive; the SQL always groups by day). */
export function modelBreakdownByDay(rows: RawRow[], cols: UsageColumns): Map<string, ModelUsageRow[]> {
  const byDay = new Map<string, ModelUsageRow[]>();
  for (const r of rows) {
    if (!r.day) continue;
    const day = String(r.day);
    let list = byDay.get(day);
    if (!list) {
      list = [];
      byDay.set(day, list);
    }
    list.push(modelToModelUsageRow(r, cols));
  }
  return byDay;
}