/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { machineKey, modelFamily, modelLabel, costInputForModel } from "../shared/models";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import type { ModelUsageRow, UsageDay } from "../shared/types";

export interface UsageAggregate {
  totalSessions: number;
  totalMessages: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  totalCacheReadTokens: number | null;
  totalCacheWriteTokens: number | null;
  totalCacheSavingsUsd: number | null;
  cacheHitRate: number | null;
  bySource: Record<string, { sessions: number; cost: number | null; tokens: number | null; cacheReadTokens: number | null; cacheSavingsUsd: number | null }>;
  byModel: Array<{ model: string; family: string | null; sessions: number; cost: number | null; tokens: number | null; cacheReadTokens: number | null; cacheHitRate: number | null; cacheSavingsUsd: number | null }>;
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
      ? buildSnapshotUsage(usageStates, inWindowDay)
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

/** Build a UsageAggregate from the snapshot path (persisted latest_state).
 *  Mirrors the daily_metrics path's field set so the dashboard doesn't have
 *  to branch on which source fed the aggregate. */
function buildSnapshotUsage(states: PersistedState[], inWindowDay: (d: UsageDay) => boolean): UsageAggregate {
  const bySource: UsageAggregate["bySource"] = {};
  let totalSessions = 0;
  let totalMessages: number | null = null;
  let totalTokens: number | null = null;
  let totalCost: number | null = null;
  let totalCacheReadTokens: number | null = null;
  let totalCacheWriteTokens: number | null = null;
  let totalInputTokens: number | null = null;

  for (const s of states) {
    const days = s.data!.usage!.byDay.filter(inWindowDay);
    const srcSessions = days.reduce((a, d) => a + d.sessions, 0);
    const srcMessages = sum(days.map((d) => d.messages));
    const srcTokens = sum(days.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]));
    const srcCost = sum(days.map((d) => d.cost));
    const srcCacheRead = sum(days.map((d) => d.tokensCacheRead));
    const srcCacheWrite = sum(days.map((d) => d.tokensCacheWrite));
    const srcInput = sum(days.map((d) => d.tokensInput));
    bySource[s.source] = {
      sessions: srcSessions,
      cost: srcCost,
      tokens: srcTokens,
      cacheReadTokens: srcCacheRead,
      cacheSavingsUsd: null,
    };
    totalSessions += srcSessions;
    totalMessages = mergeNullSum(totalMessages, srcMessages);
    totalTokens = mergeNullSum(totalTokens, srcTokens);
    totalCost = mergeNullSum(totalCost, srcCost);
    totalCacheReadTokens = mergeNullSum(totalCacheReadTokens, srcCacheRead);
    totalCacheWriteTokens = mergeNullSum(totalCacheWriteTokens, srcCacheWrite);
    totalInputTokens = mergeNullSum(totalInputTokens, srcInput);
  }

  const byModel = combineModels(states);
  const savingsBySource = splitSavingsBySource(bySource, byModel);
  for (const [src, savings] of Object.entries(savingsBySource)) {
    if (bySource[src]) bySource[src].cacheSavingsUsd = savings;
  }

  return {
    totalSessions,
    totalMessages,
    totalTokens,
    totalCost,
    totalCacheReadTokens,
    totalCacheWriteTokens,
    totalCacheSavingsUsd: sum(byModel.map((m) => m.cacheSavingsUsd)),
    cacheHitRate: computeHitRate(totalCacheReadTokens, totalInputTokens),
    bySource,
    byModel,
  };
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
      inputTokens: number | null;
      cacheReadTokens: number | null;
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
      existing.inputTokens = mergeNullSum(existing.inputTokens, row.inputTokens);
      existing.cacheReadTokens = mergeNullSum(existing.cacheReadTokens, row.cacheReadTokens);
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
        inputTokens: row.inputTokens,
        cacheReadTokens: row.cacheReadTokens,
        best: row.sessions,
      });
    }
  }
  return [...map.values()]
    .map(({ best: _best, inputTokens: _input, ...m }) => {
      const rate = computeHitRate(m.cacheReadTokens, _input);
      const cost = costInputForModel(m.model);
      const savings = m.cacheReadTokens !== null && cost !== null ? (m.cacheReadTokens * cost) / 1_000_000 : null;
      return { ...m, cacheHitRate: rate, cacheSavingsUsd: savings };
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

/** Clamped cache hit rate: `cacheRead / (cacheRead + input)`. Returns null
 *  when both sides are zero/unknown (no signal — never 0, never NaN). When
 *  input is null but cache_read > 0 the read is treated as 100% cached. */
function computeHitRate(cacheRead: number | null, input: number | null): number | null {
  const cr = cacheRead ?? 0;
  const inT = input ?? 0;
  if (cr === 0 && inT === 0) return null;
  if (inT === 0) return 1;
  return Math.max(0, Math.min(1, cr / (cr + inT)));
}

/** Per-source $ saved = sum of byModel savings for models that originated
 *  from this source. The byModel table is the merged cross-source view, so
 *  the per-source split is approximated proportionally by each source's
 *  share of the model's cache reads. Returns a map keyed by source id.
 *  Exported so usage-history can call the same routine (avoiding drift). */
export function splitSavingsBySource(
  bySource: UsageAggregate["bySource"],
  byModel: UsageAggregate["byModel"]
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  // For each source, sum (source_cache_read / model_cache_read) × model_savings.
  // When the model's cache reads are unknown, we can't split, so we leave
  // the source's savings as null.
  for (const [src, row] of Object.entries(bySource)) {
    if (row.cacheReadTokens === null || row.cacheReadTokens === 0) {
      out[src] = null;
      continue;
    }
    let total = 0;
    let contribute = false;
    for (const m of byModel) {
      if (m.cacheReadTokens === null || m.cacheReadTokens === 0 || m.cacheSavingsUsd === null) continue;
      // Approximate: this source's share of the model's cache reads is the
      // source's cache read total / the model's cache read total. The
      // byModel row is the merged view across sources; we don't track
      // per-source-per-model breakdowns in the byModel table, so this is
      // the best split we can do without changing the persisted shape.
      const share = m.cacheReadTokens > 0 ? row.cacheReadTokens / m.cacheReadTokens : 0;
      total += share * m.cacheSavingsUsd;
      contribute = true;
    }
    out[src] = contribute ? total : null;
  }
  return out;
}
