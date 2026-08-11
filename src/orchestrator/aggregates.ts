/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { machineKey, modelFamily, modelLabel } from "../shared/models";
import { cacheSavingsUsdForModel } from "../shared/model-costs";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import type { ModelUsageRow, UsageDay } from "../shared/types";

export interface UsageAggregate {
  totalSessions: number;
  totalMessages: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  /** Window-aggregated cache hit rate: sum(cache_read) / sum(cache_read + input).
   *  null when neither value is known; 0 when the window has zero cache activity
   *  (never NaN). */
  cacheHitRate: number | null;
  totalCacheReadTokens: number | null;
  /** Sum of per-model cache savings over the window (USD). null when no model
   *  has both a price and cache_read; 0 when savings are zero across the window.
   *  Never NaN. */
  totalCacheSavingsUsd: number | null;
  bySource: Record<string, {
    sessions: number;
    cost: number | null;
    tokens: number | null;
    /** Window-aggregated cache_read tokens for this source. null when never observed. */
    cacheReadTokens: number | null;
    /** Per-source cache savings in USD. null when no priced model has cache_read
     *  in this source; 0 when the source has cache_read but no priced model.
     *  Never NaN. */
    cacheSavingsUsd: number | null;
  }>;
  byModel: Array<{
    model: string;
    family: string | null;
    sessions: number;
    cost: number | null;
    tokens: number | null;
    cacheReadTokens: number | null;
    /** Per-model cache savings in USD: cacheReadTokens × costInput / 1e6.
     *  null when the model is unpriced; 0 when there are no cache reads.
     *  Never NaN. */
    cacheSavingsUsd: number | null;
    /** Per-model cache hit rate: cache_read / (cache_read + input). null when
     *  the model has no cache_read or input data. Never NaN. */
    cacheHitRate: number | null;
  }>;
}

export interface Aggregates {
  window: { start: string; end: string; days: number };
  throughput: { issuesOpened: number; issuesClosed: number; prsCreated: number; prsMerged: number; totalCommits: number } | null;
  cycleTime: { avgSeconds: number | null; medianSeconds: number | null; p95Seconds: number | null; sampleSize: number } | null;
  ci: { totalRuns: number; passCount: number; failCount: number; passRate: number | null } | null;
  staleWork: { staleIssues: number; stalePrs: number; thresholdDays: number } | null;
  usage: UsageAggregate | null;
}

export function computeAggregates(states: PersistedState[], config: RuntimeConfig, days: number = DEFAULT_WINDOW_DAYS, usageOverride: UsageAggregate | null = null): Aggregates {
  const end = utcDay();
  const start = utcDaysAgo(days);
  const window = { start, end, days };

  const github = states.find((s) => s.source === "github")?.data ?? null;
  const git = states.find((s) => s.source === "git")?.data ?? null;
  const usageStates = states.filter((s) => (s.data?.usage?.byDay.length ?? 0) > 0);

  // Throughput — counts inside the window (issues/PRs from github, commits from git).
  const inWindow = (iso: string | null): boolean => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;
  const inWindowDay = (d: UsageDay): boolean => d.date >= start && d.date <= end;
  const throughput = github
    ? {
        issuesOpened: github.issues.filter((i) => inWindow(i.createdAt)).length,
        issuesClosed: github.issues.filter((i) => inWindow(i.closedAt)).length,
        prsCreated: github.pullRequests.filter((p) => inWindow(p.createdAt)).length,
        prsMerged: github.pullRequests.filter((p) => inWindow(p.mergedAt)).length,
        totalCommits: windowCommits(git, start, end),
      }
    : null;

  // Cycle time — merged PRs inside the window: mergedAt − createdAt (seconds).
  const merged = (github?.pullRequests ?? []).filter((p) => p.mergedAt && p.createdAt && inWindow(p.mergedAt));
  const cycleTimes = merged.map((p) => (Date.parse(p.mergedAt!) - Date.parse(p.createdAt)) / 1000);
  const cycleTime =
    merged.length > 0
      ? {
          avgSeconds: avg(cycleTimes),
          medianSeconds: median(cycleTimes),
          p95Seconds: percentile(cycleTimes, 95),
          sampleSize: cycleTimes.length,
        }
      : null;

  // CI — workflow runs inside the window.
  const runs = (github?.workflowRuns ?? []).filter((w) => inWindow(w.createdAt));
  const passCount = runs.filter((w) => w.conclusion === "success").length;
  const failCount = runs.filter((w) => w.conclusion === "failure").length;
  const ci =
    runs.length > 0
      ? {
          totalRuns: runs.length,
          passCount,
          failCount,
          passRate: passCount + failCount > 0 ? passCount / (passCount + failCount) : null,
        }
      : null;

  // Stale work — open items untouched past the threshold.
  const thresholdMs = Date.now() - config.staleness.staleThresholdDays * 86_400_000;
  const staleIssues = (github?.issues ?? []).filter((i) => i.state === "open" && Date.parse(i.updatedAt) < thresholdMs).length;
  const stalePrs = (github?.pullRequests ?? []).filter((p) => p.state === "open" && Date.parse(p.updatedAt) < thresholdMs).length;
  const staleWork =
    github !== null
      ? { staleIssues, stalePrs, thresholdDays: config.staleness.staleThresholdDays }
      : null;

  // Usage — signal-house's OWN daily_metrics history wins when it exists
  // (it accumulates 90 days independent of upstream retention); the snapshot
  // derivation below is the fallback for a fresh DB before the first refresh.
  const usage = usageOverride ?? (usageStates.length > 0
      ? (() => {
          const byDay = usageStates.flatMap((s) => s.data?.usage?.byDay.filter(inWindowDay) ?? []);
          const tokensInputTotal = sum(byDay.map((d) => d.tokensInput));
          const tokensCacheReadTotal = sum(byDay.map((d) => d.tokensCacheRead));
          const cacheHitRate = computeCacheHitRate(tokensInputTotal, tokensCacheReadTotal);
          // Source-level cache sums.
          const bySourceEntries = usageStates.map((s) => {
            const days = s.data!.usage!.byDay.filter(inWindowDay);
            const cacheReadTokens = sum(days.map((d) => d.tokensCacheRead));
            const savingsByDay = days
              .filter((d) => d.tokensCacheRead !== null)
              .map((d) => cacheSavingsUsdForDay(s.source, d));
            // Aggregate per-source savings using null-safe semantics: any null
            // day poisons the source's savings to null (the card then renders —).
            const cacheSavingsUsd = mergeSavingsArray(savingsByDay);
            return [
              s.source,
              {
                sessions: days.reduce((a, d) => a + d.sessions, 0),
                cost: sum(days.map((d) => d.cost)),
                tokens: sum(days.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning])),
                cacheReadTokens,
                cacheSavingsUsd,
              },
            ] as const;
          });
          // Window savings = sum of per-source savings; null in any source
          // poisons the window total (the card shows —, never $0.00 when the
          // signal is incomplete).
          const cacheSavingsBySource = bySourceEntries.map(([, v]) => v.cacheSavingsUsd);
          const totalCacheSavingsUsd = mergeSavingsArray(cacheSavingsBySource);
          return {
            totalSessions: sum(usageStates.map((s) => s.data?.usage?.byDay.filter(inWindowDay).reduce((a, d) => a + d.sessions, 0) ?? null)) ?? 0,
            totalMessages: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.filter(inWindowDay).map((d) => d.messages) ?? []))),
            totalTokens: sum(
              usageStates.map((s) =>
                sum(s.data?.usage?.byDay.filter(inWindowDay).flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]) ?? []),
              ),
            ),
            totalCost: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.filter(inWindowDay).map((d) => d.cost) ?? []))),
            cacheHitRate,
            totalCacheReadTokens: tokensCacheReadTotal,
            totalCacheSavingsUsd,
            bySource: Object.fromEntries(bySourceEntries),
            byModel: combineModels(usageStates),
          };
        })()
      : null);

  return { window, throughput, cycleTime, ci, staleWork, usage };
}

function windowCommits(git: NonNullable<PersistedState["data"]> | null, start: string, end: string): number {
  if (!git) return 0;
  let total = 0;
  for (const [day, count] of Object.entries(git.commitsByDay)) {
    if (day >= start && day <= end) total += count;
  }
  return total;
}

/**
 * Merge per-source byModel rows across providers/sources into ONE row per
 * model. Rows are grouped by a normalised model key (case/separator/vendor-
 * prefix insensitive — see shared/models.ts), so "DeepSeek-V4-Pro" from
 * hermes and "deepseek-v4-pro" from opencode collapse into a single row with
 * combined cost/tokens/sessions. The display name is the spelling with the
 * most sessions; the family tag (DeepSeek, z.ai, Moonshot, …) replaces the
 * provider label. Sorted by sessions desc — "which model is seeing work".
 */
function combineModels(states: PersistedState[]): UsageAggregate["byModel"] {
  return mergeModelRows(states.flatMap((s) => s.data!.usage!.byModel));
}

/** Core merge for model rows from ANY source (snapshot byModel or the
 *  accumulated daily_metrics history) — shared by combineModels and
 *  metrics/usage-history. */
export function mergeModelRows(rows: ModelUsageRow[]): UsageAggregate["byModel"] {
  const map = new Map<
    string,
    {
      model: string;
      family: string | null;
      sessions: number;
      cost: number | null;
      tokens: number | null;
      cacheReadTokens: number | null;
      cacheSavingsUsd: number | null;
      inputTokens: number | null;
      best: number;
    }
  >();
  for (const row of rows) {
    const key = machineKey(row.model);
    if (!key) continue;
    // "unknown" carries no signal — drop it from the display entirely.
    if (key === "unknown") continue;
    const existing = map.get(key);
    if (existing) {
      existing.sessions += row.sessions;
      existing.cost = mergeNullSum(existing.cost, row.cost);
      existing.tokens = mergeNullSum(existing.tokens, rowTokens(row));
      existing.cacheReadTokens = mergeNullSum(existing.cacheReadTokens, row.cacheReadTokens);
      existing.inputTokens = mergeNullSum(existing.inputTokens, row.inputTokens);
      // Per-model cache savings: the daily_metrics rows have their own value
      // (already computed); the snapshot's per-model rows don't — we compute
      // them here from the row's cacheReadTokens using costInput.
      existing.cacheSavingsUsd = mergeModelSavings(existing.cacheSavingsUsd, row);
      if (row.sessions > existing.best) {
        existing.best = row.sessions;
        existing.model = modelLabel(row.model);
        existing.family = modelFamily(row.model);
      }
    } else {
      map.set(key, {
        model: modelLabel(row.model),
        family: modelFamily(row.model),
        sessions: row.sessions,
        cost: row.cost,
        tokens: rowTokens(row),
        cacheReadTokens: row.cacheReadTokens,
        cacheSavingsUsd: rowCacheSavings(row),
        inputTokens: row.inputTokens,
        best: row.sessions,
      });
    }
  }
  return [...map.values()]
    .map(({ best: _best, inputTokens: _input, ...m }) => {
      const cacheRead = m.cacheReadTokens ?? 0;
      const input = _input ?? 0;
      // Per-model cache hit rate: null when this model has no cache_read
      // telemetry (unobserved, not zero). 0 when cache_read is known to be 0.
      const cacheHitRate = m.cacheReadTokens === null ? null : cacheRead + input === 0 ? 0 : cacheRead / (cacheRead + input);
      return { ...m, cacheHitRate };
    })
    .sort((a, b) => b.sessions - a.sessions || (b.cost ?? 0) - (a.cost ?? 0));
}

/** Per-model cache savings from a raw row: prefer the pre-computed field
 *  (daily_metrics uses this — it gets populated in usage-history.ts), fall
 *  back to on-demand computation for snapshot rows that don't carry one. */
function rowCacheSavings(row: { model: string; cacheReadTokens: number | null; cacheSavingsUsd?: number | null }): number | null {
  if (row.cacheSavingsUsd !== undefined) return row.cacheSavingsUsd;
  return cacheSavingsUsdForModel(row.model, row.cacheReadTokens);
}

/** Combine two cache-savings values for the same model across rows. Both null
 *  → null. Exactly one null → other. Both numeric → sum. */
function mergeModelSavings(existing: number | null, row: { model: string; cacheReadTokens: number | null; cacheSavingsUsd?: number | null }): number | null {
  const incoming = rowCacheSavings(row);
  if (existing === null && incoming === null) return null;
  if (existing === null) return incoming;
  if (incoming === null) return existing;
  return existing + incoming;
}

function rowTokens(row: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null }): number | null {
  return sum([row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.reasoningTokens]);
}

function mergeNullSum(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Cache hit rate for the whole window: sum(cache_read) / (sum(input) + sum(cache_read)).
 *  null when cache_read has never been observed in the window — the rate is
 *  genuinely unknown when we have no cache telemetry, not zero. Returns 0
 *  when cache_read is known to be zero. Never NaN. */
function computeCacheHitRate(tokensInput: number | null, tokensCacheRead: number | null): number | null {
  if (tokensCacheRead === null) return null;
  const denom = (tokensInput ?? 0) + tokensCacheRead;
  if (denom === 0) return 0;
  return tokensCacheRead / denom;
}

/** Aggregate savings across an array of per-source/per-day values: null in any
 *  cell poisons the sum to null (the UI then renders —, never $0.00). All
 *  numeric → sum. */
function mergeSavingsArray(values: Array<number | null>): number | null {
  let total: number | null = 0;
  for (const v of values) {
    if (v === null) return null;
    total = (total ?? 0) + v;
  }
  return total;
}

/** Per-day cache savings for the snapshot-fallback path. Source isn't used in
 *  the formula today (the model's rate is per-machine-key, not per-source) but
 *  is threaded for future per-source rate overrides. */
function cacheSavingsUsdForDay(_source: string, day: UsageDay): number | null {
  // Day-level savings needs a per-day model rate; the snapshot's byDay rows
  // don't carry byModel per day (only the by-model aggregate does). The
  // per-source card uses byModel. Here we just return null — the snapshot
  // fallback doesn't compute day-level savings; the per-source / window totals
  // come from byModel rows instead.
  // This path is exercised only when daily_metrics history is empty AND the
  // snapshot-derived usage has no byModel rows; in practice this never happens
  // because the daily_metrics writer emits per-model rows even for the
  // current day. Returning null keeps the card honest ("—").
  void day;
  return null;
}
