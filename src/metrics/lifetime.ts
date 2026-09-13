/**
 * Window-less lifetime ("to date") aggregates over daily_metrics.
 *
 * "Lifetime" means everything retention hasn't pruned — a rolling window
 * (90 days at default config), NOT collector-era all-time totals. The
 * payload carries sinceDay so the UI states the actual bound; these
 * numbers are never labelled "all time".
 *
 * Null semantics mirror queryUsageAggregate: SQL SUM ignores NULL cells
 * and returns NULL only when every row is NULL, so unknown history stays
 * null and renders "—", never 0.
 */

import type { Database } from "bun:sqlite";
import type { CostEstimationOpts } from "../shared/types";
import { queryModelRows } from "./usage-history";

export interface LifetimeStats {
  /** First retained day across ALL sources — the honest bound behind every
   *  number below. Null only when the table has no rows at all. */
  sinceDay: string | null;
  /** Sum of git commits.total over all retained history. null = no git rows. */
  totalCommits: number | null;
  /** 5-term token sum (input+output+cache_read+cache_write+reasoning) over
   *  all retained opencode+hermes history — the same definition as the
   *  chart's Tokens series and the hero meta, so the numbers stay
   *  comparable across the card. null = no known token rows. */
  totalTokens: number | null;
  /** Sum of sessions.total over all retained opencode+hermes history. */
  totalSessions: number | null;
  /** Most-used model by sessions — same canonical merge as the by-model
   *  table, so the two always agree. null = no model rows. */
  topModel: { label: string; sessions: number } | null;
  /** Highest 5-term token day. null = no known token totals. */
  busiestDay: { date: string; tokens: number } | null;
}

export function computeLifetimeStats(db: Database, costOpts: CostEstimationOpts): LifetimeStats | null {
  const sinceRow = db
    .query("SELECT MIN(date) AS sinceDay FROM daily_metrics")
    .get() as { sinceDay: string | null } | null;
  // No rows at all → no lifetime section; the UI renders "—" for every line.
  if (!sinceRow || sinceRow.sinceDay === null) return null;

  const commits = db
    .query("SELECT SUM(value) AS total FROM daily_metrics WHERE source = 'git' AND metric = 'commits.total'")
    .get() as { total: number | null } | null;
  const totalCommits = commits?.total ?? null;

  const usage = db
    .query(
      `SELECT
         SUM(CASE WHEN metric = 'sessions.total' THEN value END) AS sessions,
         -- knownSum semantics, mirroring usage-history's totalTokens: sum the
         -- known terms; NULL only when EVERY token cell is NULL (a bare
         -- SUM(A)+SUM(B)+... would collapse to NULL as soon as one term's
         -- rows are all unknown, erasing the known ones).
         CASE WHEN COUNT(CASE WHEN metric IN ('tokens.input', 'tokens.output', 'tokens.cache_read', 'tokens.cache_write', 'tokens.reasoning') AND value IS NOT NULL THEN 1 END) > 0 THEN
           COALESCE(SUM(CASE WHEN metric = 'tokens.input'       THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.output'      THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.cache_read'  THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.cache_write' THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.reasoning'   THEN value END), 0)
         ELSE NULL END AS tokens
       FROM daily_metrics
       WHERE source IN ('opencode', 'hermes')`,
    )
    .get() as { tokens: number | null; sessions: number | null } | null;
  const totalTokens = usage?.tokens ?? null;
  const totalSessions = usage?.sessions ?? null;

  // Window-less model rows through the shared canonical merge — the same
  // grouping (and sessions-desc sort) as the by-model table.
  const byModel = queryModelRows(db, null, null, costOpts);
  const top = byModel[0] ?? null;
  const topModel = top !== null ? { label: top.model, sessions: top.sessions } : null;

  const busiest = db
    .query(
      `SELECT date,
         -- Per-day knownSum: same guard as the total above so a day with
         -- only input/output known still ranks by what it actually has.
         CASE WHEN COUNT(CASE WHEN metric IN ('tokens.input', 'tokens.output', 'tokens.cache_read', 'tokens.cache_write', 'tokens.reasoning') AND value IS NOT NULL THEN 1 END) > 0 THEN
           COALESCE(SUM(CASE WHEN metric = 'tokens.input'       THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.output'      THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.cache_read'  THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.cache_write' THEN value END), 0) +
           COALESCE(SUM(CASE WHEN metric = 'tokens.reasoning'   THEN value END), 0)
         ELSE NULL END AS tokens
       FROM daily_metrics
       WHERE source IN ('opencode', 'hermes')
       GROUP BY date
       ORDER BY tokens DESC, date ASC
       LIMIT 1`,
    )
    .get() as { date: string; tokens: number | null } | null;
  // SQLite sorts NULLs last in DESC, so a NULL here means every day was
  // unknown — not a zero. Ties resolve to the earliest day (date ASC).
  const busiestDay = busiest && busiest.tokens !== null ? { date: busiest.date, tokens: busiest.tokens } : null;

  return { sinceDay: sinceRow.sinceDay, totalCommits, totalTokens, totalSessions, topModel, busiestDay };
}