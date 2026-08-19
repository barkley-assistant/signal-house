/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { machineKey, modelFamily, modelLabel } from "../shared/models";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import type { ModelUsageRow, UsageDay } from "../shared/types";
import { getCacheReadCostPerMillion, getInputCostPerMillion } from "../server/cost-input";

export interface SourceUsageMetrics {
  sessions: number;
  cost: number | null;
  tokens: number | null;
  /** Additive cache metrics — always populated by the server aggregate layer. */
  cacheReadTokens?: number;
  cacheHitRate?: number;
  cacheSavings?: number;
}

export interface ModelSourceCacheMetrics {
  cacheReadTokens: number;
  cacheSavings: number;
}

export interface ModelUsageMetrics {
  model: string;
  family: string | null;
  sessions: number;
  cost: number | null;
  tokens: number | null;
  /** Additive cache metrics — always populated by the server aggregate layer. */
  cacheReadTokens?: number;
  cacheHitRate?: number;
  cacheSavings?: number;
  bySource?: Record<string, ModelSourceCacheMetrics>;
}

export interface UsageAggregate {
  totalSessions: number;
  totalMessages: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  /** Additive cache metrics — always populated by the server aggregate layer. */
  cacheReadTokens?: number;
  cacheHitRate?: number;
  cacheSavings?: number;
  bySource: Record<string, SourceUsageMetrics>;
  byModel: Array<ModelUsageMetrics>;
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
  const rawUsage: UsageAggregate | null = usageOverride ?? (usageStates.length > 0
      ? buildSnapshotUsage(usageStates, inWindowDay)
      : null);
  const usage = rawUsage ? fillUsageDefaults(rawUsage) : null;

  return { window, throughput, cycleTime, ci, staleWork, usage };
}

function buildSnapshotUsage(usageStates: PersistedState[], inWindowDay: (d: UsageDay) => boolean): UsageAggregate {
  const bySource: Record<string, SourceUsageMetrics> = {};
  let windowCacheRead = 0;
  let windowInput = 0;

  for (const s of usageStates) {
    const days = s.data!.usage!.byDay.filter(inWindowDay);
    const inputTokens = days.reduce((a, d) => a + (d.tokensInput ?? 0), 0);
    const cacheReadTokens = days.reduce((a, d) => a + (d.tokensCacheRead ?? 0), 0);
    windowCacheRead += cacheReadTokens;
    windowInput += inputTokens;
    bySource[s.source] = {
      sessions: days.reduce((a, d) => a + d.sessions, 0),
      cost: sum(days.map((d) => d.cost)),
      tokens: sum(days.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning])),
      cacheReadTokens,
      cacheHitRate: cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0,
      cacheSavings: 0, // populated from merged model rows below
    };
  }

  const mergedByModel = combineModels(usageStates);
  let windowSavings = 0;
  for (const m of mergedByModel) {
    windowSavings += m.cacheSavings ?? 0;
    for (const [src, data] of Object.entries(m.bySource ?? {})) {
      const srcMetrics = bySource[src];
      if (srcMetrics) {
        srcMetrics.cacheSavings = (srcMetrics.cacheSavings ?? 0) + data.cacheSavings;
      }
    }
  }

  return {
    totalSessions: sum(usageStates.map((s) => s.data?.usage?.byDay.filter(inWindowDay).reduce((a, d) => a + d.sessions, 0) ?? null)) ?? 0,
    totalMessages: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.filter(inWindowDay).map((d) => d.messages) ?? []))),
    totalTokens: sum(
      usageStates.map((s) =>
        sum(s.data?.usage?.byDay.filter(inWindowDay).flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]) ?? []),
      ),
    ),
    totalCost: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.filter(inWindowDay).map((d) => d.cost) ?? []))),
    cacheReadTokens: windowCacheRead,
    cacheHitRate: windowCacheRead + windowInput > 0 ? windowCacheRead / (windowCacheRead + windowInput) : 0,
    cacheSavings: windowSavings,
    bySource,
    byModel: mergedByModel,
  };
}

/** Ensure additive cache fields are concrete numbers so downstream UI and
 *  API consumers never need to handle missing keys. */
function fillUsageDefaults(u: UsageAggregate): UsageAggregate {
  return {
    ...u,
    cacheReadTokens: u.cacheReadTokens ?? 0,
    cacheHitRate: u.cacheHitRate ?? 0,
    cacheSavings: u.cacheSavings ?? 0,
    bySource: Object.fromEntries(
      Object.entries(u.bySource).map(([k, v]) => [
        k,
        {
          ...v,
          cacheReadTokens: v.cacheReadTokens ?? 0,
          cacheHitRate: v.cacheHitRate ?? 0,
          cacheSavings: v.cacheSavings ?? 0,
        },
      ]),
    ),
    byModel: u.byModel.map((m) => ({
      ...m,
      cacheReadTokens: m.cacheReadTokens ?? 0,
      cacheHitRate: m.cacheHitRate ?? 0,
      cacheSavings: m.cacheSavings ?? 0,
      bySource: m.bySource ?? {},
    })),
  };
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
  // Stamp each snapshot row with its source so mergeModelRows can keep a
  // per-source cache breakdown (opencode vs hermes) instead of collapsing it.
  return mergeModelRows(states.flatMap((s) => s.data!.usage!.byModel.map((m) => ({ ...m, source: s.source }))));
}

/** Core merge for model rows from ANY source (snapshot byModel or the
 *  accumulated daily_metrics history) — shared by combineModels and
 *  metrics/usage-history. Preserves per-source cache totals in `bySource`
 *  and derives savings from the server-side cost.input lookup. */
export function mergeModelRows(rows: ModelUsageRow[]): UsageAggregate["byModel"] {
  type Acc = {
    model: string;
    family: string | null;
    sessions: number;
    cost: number | null;
    tokens: number | null;
    inputTokens: number;
    cacheReadTokens: number;
    cacheSavings: number;
    bySource: Record<string, ModelSourceCacheMetrics>;
    best: number;
  };
  const map = new Map<string, Acc>();

  for (const row of rows) {
    const key = machineKey(row.model);
    if (!key) continue;
    // "unknown" carries no signal — drop it from the display entirely.
    if (key === "unknown") continue;

    const source = row.source ?? row.provider ?? "unknown";
    const inputTokens = row.inputTokens ?? 0;
    const cacheReadTokens = row.cacheReadTokens ?? 0;
    // Net savings = tokens read from cache × (input − cache_read) price delta.
    // Cache reads are discounted, not free; subtracting the cache_read rate
    // keeps the estimate honest. A missing cache_read rate falls back to the
    // gross input cost (treated as free reads).
    const inputRate = getInputCostPerMillion(row.model);
    const cacheReadRate = getCacheReadCostPerMillion(row.model);
    const cacheSavings = (cacheReadTokens * Math.max(0, inputRate - cacheReadRate)) / 1_000_000;

    const existing = map.get(key);
    if (existing) {
      existing.sessions += row.sessions;
      existing.cost = mergeNullSum(existing.cost, row.cost);
      existing.tokens = mergeNullSum(existing.tokens, rowTokens(row));
      existing.inputTokens += inputTokens;
      existing.cacheReadTokens += cacheReadTokens;
      existing.cacheSavings += cacheSavings;
      const src = existing.bySource[source] ?? { cacheReadTokens: 0, cacheSavings: 0 };
      src.cacheReadTokens += cacheReadTokens;
      src.cacheSavings += cacheSavings;
      existing.bySource[source] = src;
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
        inputTokens,
        cacheReadTokens,
        cacheSavings,
        bySource: { [source]: { cacheReadTokens, cacheSavings } },
        best: row.sessions,
      });
    }
  }

  return [...map.values()]
    .map(({ best: _best, inputTokens, ...m }) => {
      const denom = m.cacheReadTokens + inputTokens;
      return {
        ...m,
        cacheHitRate: denom > 0 ? m.cacheReadTokens / denom : 0,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || (b.cost ?? 0) - (a.cost ?? 0));
}

function rowTokens(row: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null }): number | null {
  return sum([row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.reasoningTokens]);
}

function mergeNullSum(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
