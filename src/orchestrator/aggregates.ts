/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { canonicalMachineKey, machineKey, modelFamily, modelLabel, stripDateSnapshot } from "../shared/models";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import { resolvePrivacyMap, isRepoVisible } from "../privacy/privacy";
import type { CostEstimationOpts, CostSource, ModelRates, ModelUsageRow, UsageDay } from "../shared/types";

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
  /** Per-source token breakdown. Used to slice the model-row estimated cost
   *  across sources so bySource.<src>.cost is internally consistent with
   *  byModel[].cost (every cost number on the dashboard comes from the
   *  same estimator). */
  inputTokens: number;
  outputTokens: number;
  /** Per-source slice of the model-row cost. When estimation is enabled
   *  this is the estimator's number (tokens × rates). When disabled it's
   *  the upstream value. */
  cost: number;
}

export interface ModelUsageMetrics {
  model: string;
  family: string | null;
  /** Canonical grouping key (shared/models.canonicalMachineKey). Lets the
   *  UI address this row's per-day history on /api/daily/model with the
   *  same key the aggregator grouped it under. */
  machineKey?: string;
  sessions: number;
  cost: number | null;
  tokens: number | null;
  /** Additive token breakdown — always populated by the server aggregate
   *  layer, surfaced for the expanded by-model panel. */
  inputTokens?: number;
  outputTokens?: number;
  /** Additive cache metrics — always populated by the server aggregate layer. */
  cacheReadTokens?: number;
  cacheHitRate?: number;
  cacheSavings?: number;
  /**
   * How `cost` was derived. Set by the aggregator when `estimateCosts=true`;
   * absent (undefined) when the upstream cost passed through unchanged.
   * Computed at merge time, not persisted.
   */
  costSource?: CostSource;
  /**
   * Cost per 1M "effective" tokens. Effective tokens discount cache reads by
   * the model's own cache-read-vs-input price ratio (a cached token costs
   * less than a fresh one), so models with high cache hit rates aren't
   * unfairly penalised next to cache-heavy ones. null when the ratio is not
   * meaningful (no cost telemetry, free tier, or <3 sessions).
   */
  effPerM?: number | null;
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

export function computeAggregates(states: PersistedState[], config: RuntimeConfig, days: number = DEFAULT_WINDOW_DAYS, usageOverride: UsageAggregate | null = null, costOpts: CostEstimationOpts = { rates: new Map(), enabled: false }): Aggregates {
  const end = utcDay();
  const start = utcDaysAgo(days);
  const window = { start, end, days };

  const github = states.find((s) => s.source === "github")?.data ?? null;
  const git = states.find((s) => s.source === "git")?.data ?? null;
  const usageStates = states.filter((s) => (s.data?.usage?.byDay.length ?? 0) > 0);

  // Privacy — every github-derived summary stat must respect the same
  // visibility rule as the attention queue: when showPrivateRepoItems is
  // off, private/unknown repos are excluded from stale counts, throughput,
  // cycle time, and CI. Otherwise the cards leak counts the queue hides.
  const privacyMap = resolvePrivacyMap(github?.repositories ?? []);
  const visibleRepo = (repoKey: string): boolean =>
    config.privacy.showPrivateRepoItems || isRepoVisible(repoKey, privacyMap, false);
  const ghIssues = (github?.issues ?? []).filter((i) => visibleRepo(i.repoKey));
  const ghPulls = (github?.pullRequests ?? []).filter((p) => visibleRepo(p.repoKey));
  const ghRuns = (github?.workflowRuns ?? []).filter((w) => visibleRepo(w.repoKey));

  // Throughput — counts inside the window (issues/PRs from github, commits from git).
  const inWindow = (iso: string | null): boolean => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;
  const inWindowDay = (d: UsageDay): boolean => d.date >= start && d.date <= end;
  const throughput = github
    ? {
        issuesOpened: ghIssues.filter((i) => inWindow(i.createdAt)).length,
        issuesClosed: ghIssues.filter((i) => inWindow(i.closedAt)).length,
        prsCreated: ghPulls.filter((p) => inWindow(p.createdAt)).length,
        prsMerged: ghPulls.filter((p) => inWindow(p.mergedAt)).length,
        totalCommits: windowCommits(git, start, end),
      }
    : null;

  // Cycle time — merged PRs inside the window: mergedAt − createdAt (seconds).
  const merged = ghPulls.filter((p) => p.mergedAt && p.createdAt && inWindow(p.mergedAt));
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
  const runs = ghRuns.filter((w) => inWindow(w.createdAt));
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

  // Stale work — open items untouched past the threshold. Same filtered
  // issue/PR lists as throughput/cycle-time so the card can never count
  // items the attention queue is not allowed to show.
  const thresholdMs = Date.now() - config.staleness.staleThresholdDays * 86_400_000;
  const staleIssues = ghIssues.filter((i) => i.state === "open" && Date.parse(i.updatedAt) < thresholdMs).length;
  const stalePrs = ghPulls.filter((p) => p.state === "open" && Date.parse(p.updatedAt) < thresholdMs).length;
  const staleWork =
    github !== null
      ? { staleIssues, stalePrs, thresholdDays: config.staleness.staleThresholdDays }
      : null;

  // Usage — signal-house's OWN daily_metrics history wins when it exists
    // (it accumulates 90 days independent of upstream retention); the snapshot
    // derivation below is the fallback for a fresh DB before the first refresh.
    const rawUsage: UsageAggregate | null = usageOverride ?? (usageStates.length > 0
      ? buildSnapshotUsage(usageStates, inWindowDay, costOpts)
      : null);
    const usage = rawUsage ? fillUsageDefaults(rawUsage) : null;

  return { window, throughput, cycleTime, ci, staleWork, usage };
}

function buildSnapshotUsage(usageStates: PersistedState[], inWindowDay: (d: UsageDay) => boolean, costOpts: CostEstimationOpts): UsageAggregate {
  const bySource: Record<string, SourceUsageMetrics> = {};
  let windowCacheRead = 0;
  let windowInput = 0;
  let windowCost = 0;

  for (const s of usageStates) {
    const days = s.data!.usage!.byDay.filter(inWindowDay);
    const inputTokens = days.reduce((a, d) => a + (d.tokensInput ?? 0), 0);
    const cacheReadTokens = days.reduce((a, d) => a + (d.tokensCacheRead ?? 0), 0);
    windowCacheRead += cacheReadTokens;
    windowInput += inputTokens;
    // Source-level cost: pass-through when estimation is off; falls to 0
    // when estimation is on (the merged model rows carry the computed totals,
    // and we don't double-count here). The aggregator's per-row costSource
    // flag tells downstream code which path produced the value.
    const sourceCost: number = costOpts.enabled ? 0 : sum(days.map((d) => d.cost)) ?? 0;
    windowCost += sourceCost;
    bySource[s.source] = {
      sessions: days.reduce((a, d) => a + d.sessions, 0),
      cost: sourceCost,
      tokens: sum(days.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning])),
      cacheReadTokens,
      cacheHitRate: cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0,
      cacheSavings: 0, // populated from merged model rows below
    };
  }

  const mergedByModel = combineModels(usageStates, costOpts);
  let windowSavings = 0;
  // When estimation is on, replace each source's upstream cost with the
  // estimator's per-source contribution (sum of per-source costs across
  // the merged model rows). When off, leave the upstream byDay sum in
  // place — that's what the source tiles should show.
  const bySourceCostFromMerge = new Map<string, number>();
  for (const m of mergedByModel) {
    windowSavings += m.cacheSavings ?? 0;
    for (const [src, data] of Object.entries(m.bySource ?? {})) {
      const srcMetrics = bySource[src];
      if (srcMetrics) {
        srcMetrics.cacheSavings = (srcMetrics.cacheSavings ?? 0) + data.cacheSavings;
        if (costOpts.enabled) {
          bySourceCostFromMerge.set(src, (bySourceCostFromMerge.get(src) ?? 0) + data.cost);
        }
      }
    }
  }
  if (costOpts.enabled) {
    for (const [src, cost] of bySourceCostFromMerge) {
      const srcMetrics = bySource[src];
      if (srcMetrics) srcMetrics.cost = cost;
    }
  }

  // totalCost: prefer the model-row totals (they carry the right value
  // whether estimated or passthrough) when estimation is enabled and
  // byModel is non-empty. Fall back to windowCost (the upstream byDay sum)
  // when estimation is off or when byModel is empty (tests' usageDays()
  // fixture, or real usage where a source has data but no per-model detail).
  const totalCost =
    costOpts.enabled && mergedByModel.length > 0
      ? sum(mergedByModel.map((m) => m.cost ?? 0)) ?? 0
      : windowCost;

  return {
    totalSessions: sum(usageStates.map((s) => s.data?.usage?.byDay.filter(inWindowDay).reduce((a, d) => a + d.sessions, 0) ?? null)) ?? 0,
    totalMessages: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.filter(inWindowDay).map((d) => d.messages) ?? []))),
    totalTokens: sum(
      usageStates.map((s) =>
        sum(s.data?.usage?.byDay.filter(inWindowDay).flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]) ?? []),
      ),
    ),
    totalCost,
    cacheReadTokens: windowCacheRead,
    cacheHitRate: windowCacheRead + windowInput > 0 ? windowCacheRead / (windowCacheRead + windowInput) : 0,
    cacheSavings: windowSavings,
    bySource,
    byModel: mergedByModel,
    // anyUnknown is set post-fill by computeAggregates so both data paths
    // (snapshot derivation here + queryUsageAggregate override) report
    // it consistently.
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
function combineModels(states: PersistedState[], costOpts: CostEstimationOpts): UsageAggregate["byModel"] {
  // Stamp each snapshot row with its source so mergeModelRows can keep a
  // per-source cache breakdown (opencode vs hermes) instead of collapsing it.
  return mergeModelRows(
    states.flatMap((s) => s.data!.usage!.byModel.map((m) => ({ ...m, source: s.source }))),
    costOpts,
  );
}

/** Core merge for model rows from ANY source (snapshot byModel or the
 *  accumulated daily_metrics history) — shared by combineModels and
 *  metrics/usage-history. Preserves per-source cache totals in `bySource`
 *  and derives savings from the server-side cost.input lookup.
 *
 *  When `estimateCosts=true`, the per-row `cost` is recomputed from
 *  tokens × resolver rates (overriding any upstream-reported value).
 *  `costSource` is set per row to indicate the derivation. The upstream
 *  `cost` field is read for cache-savings math only.
 */
export function mergeModelRows(
  rows: ModelUsageRow[],
  costOpts: CostEstimationOpts,
): UsageAggregate["byModel"] {
  type Acc = {
    model: string;
    family: string | null;
    sessions: number;
    cost: number | null;
    costSource: CostSource | undefined;
    tokens: number | null;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheSavings: number;
    /** The rate sheet this key's rows were priced with (from the winning
     *  estimated row). Used by the effPerM discount below so the ratio
     *  derives from the same price source as `cost`. Undefined when no
     *  rate was found (unknown rows) or estimation is off. */
    rates: ModelRates | undefined;
    bySource: Record<string, ModelSourceCacheMetrics>;
    best: number;
  };
  const map = new Map<string, Acc>();

  for (const row of rows) {
    const rawKey = machineKey(row.model);
    if (!rawKey) continue;
    // Group aliases together without re-keying pricing; cost lookup must stay raw.
    const key = canonicalMachineKey(row.model);
    // "unknown" carries no signal — drop it from the display entirely.
    if (key === "unknown") continue;

    const source = row.source ?? row.provider ?? "unknown";
    const inputTokens = row.inputTokens ?? 0;
    const outputTokens = row.outputTokens ?? 0;
    const cacheReadTokens = row.cacheReadTokens ?? 0;

    // Cost derivation:
    //   - estimateCosts=true:  recompute cost from tokens × rates.
    //                           "estimated" if openrouter or local had the model,
    //                           "unknown" if no rate was found anywhere,
    //                           "skipped" if the row has no tokens.
    //                           (For v1 we don't distinguish openrouter-source from
    //                           local-source in costSource; both are "estimated".
    //                           Future: per-row provenance via the resolver.)
    //   - estimateCosts=false: passthrough — use the upstream cost as-is.
    let rowCost: number | null;
    let rowCostSource: CostSource | undefined;
    // The rate set this row was priced with. Kept so cacheSavings and the
    // effPerM discount below derive from the SAME source as `cost` — one
    // price sheet per row, not a mix of estimator + legacy local rates.
    let rowRates: ModelRates | undefined;
    if (costOpts.enabled) {
      // Dated variant first, stripped base as a fallback — mirrors the
      // resolver's lookup order (D1). The rates map is keyed by FULL
      // machine key (dated keys survive the parser), so a dated row must
      // hit its own dated entry before the base.
      const rates = costOpts.rates.get(rawKey) ?? costOpts.rates.get(stripDateSnapshot(rawKey));
      if (rates && (rates.input > 0 || rates.output > 0)) {
        rowRates = rates;
        rowCost = (inputTokens * rates.input + outputTokens * rates.output + cacheReadTokens * rates.cacheRead) / 1_000_000;
        rowCostSource = "estimated";
      } else if (inputTokens + outputTokens + cacheReadTokens === 0) {
        rowCost = 0;
        rowCostSource = "skipped";
      } else {
        rowCost = 0;
        rowCostSource = "unknown";
      }
    } else {
      rowCost = row.cost;
      rowCostSource = row.cost !== null && row.cost !== undefined ? "passthrough" : undefined;
    }

    // Net savings = tokens read from cache × (input − cache_read) price delta,
    // priced from the SAME rate sheet as `cost` above. When no rate was found
    // (unknown/passthrough rows) there is no defensible discount number —
    // savings stay 0 rather than mixing a second price source in.
    const cacheSavings =
      rowRates && rowCostSource === "estimated"
        ? (cacheReadTokens * Math.max(0, rowRates.input - rowRates.cacheRead)) / 1_000_000
        : 0;

    // Per-source slice of this row's cost. When estimation is on, slice
    // proportionally to per-source tokens × rates (so bySource.<src>.cost
    // is internally consistent with byModel[].cost and the same data
    // flows everywhere). When estimation is off, slice proportionally to
    // the row's total upstream cost (so the sum matches the upstream
    // value without forcing each source to independently know the rate).
    const rowSourceCost = rowCost ?? 0;

    const existing = map.get(key);
    if (existing) {
      existing.sessions += row.sessions;
      existing.cost = mergeNullSum(existing.cost, rowCost);
      existing.tokens = mergeNullSum(existing.tokens, rowTokens(row));
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cacheReadTokens += cacheReadTokens;
      existing.cacheSavings += cacheSavings;
      if (rowRates) existing.rates = rowRates;
      const src = existing.bySource[source] ?? { cacheReadTokens: 0, cacheSavings: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      src.cacheReadTokens += cacheReadTokens;
      src.inputTokens += inputTokens;
      src.outputTokens += outputTokens;
      src.cacheSavings += cacheSavings;
      // Per-source cost: estimator computes from per-source tokens × rates
      // (so it lines up with the estimator's own number on the row); passthrough
      // distributes the row's upstream cost by per-source token share.
      if (costOpts.enabled && rowCostSource !== "unknown" && rowCostSource !== "skipped") {
        const rates = costOpts.rates.get(rawKey) ?? costOpts.rates.get(stripDateSnapshot(rawKey));
        if (rates && (rates.input > 0 || rates.output > 0)) {
          src.cost += (inputTokens * rates.input + outputTokens * rates.output + cacheReadTokens * rates.cacheRead) / 1_000_000;
        }
      } else if (!costOpts.enabled && rowCost !== null && rowCost > 0) {
        // Distribute upstream cost by token share: each source's tokens
        // divided by total row tokens, times the row's total upstream cost.
        const totalRowTokens = inputTokens + outputTokens + cacheReadTokens;
        if (totalRowTokens > 0) {
          const share = (inputTokens + outputTokens + cacheReadTokens) / totalRowTokens;
          src.cost += rowCost * share;
        }
      }
      existing.bySource[source] = src;
      if (row.sessions > existing.best) {
        existing.best = row.sessions;
        existing.model = modelLabel(row.model);
        existing.family = modelFamily(row.model);
      }
      // If any row in this group is "unknown", the rolled-up cost is unknown.
      if (rowCostSource === "unknown") existing.costSource = "unknown";
    } else {
      map.set(key, {
        model: modelLabel(row.model),
        family: modelFamily(row.model),
        sessions: row.sessions,
        cost: rowCost,
        costSource: rowCostSource,
        tokens: rowTokens(row),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheSavings,
        rates: rowRates,
        bySource: (() => {
          const entry: { cacheReadTokens: number; cacheSavings: number; inputTokens: number; outputTokens: number; cost: number } = {
            cacheReadTokens,
            inputTokens,
            outputTokens,
            cacheSavings,
            cost: 0,
          };
          if (costOpts.enabled && rowCostSource !== "unknown" && rowCostSource !== "skipped") {
            const rates = costOpts.rates.get(rawKey) ?? costOpts.rates.get(stripDateSnapshot(rawKey));
            if (rates && (rates.input > 0 || rates.output > 0)) {
              entry.cost = (inputTokens * rates.input + outputTokens * rates.output + cacheReadTokens * rates.cacheRead) / 1_000_000;
            }
          } else if (!costOpts.enabled && rowSourceCost > 0) {
            entry.cost = rowSourceCost;
          }
          return { [source]: entry };
        })(),
        best: row.sessions,
      });
    }
  }

  return [...map.entries()]
    .map(([key, { best: _best, inputTokens, outputTokens, rates, ...m }]) => {
      const denom = m.cacheReadTokens + inputTokens;
      // Effective cost per 1M tokens: output tokens count at face value,
      // cache reads are discounted by the model's cache-read-vs-input price
      // ratio (they're cheaper per token, so counting them full-price would
      // unfairly punish high-cache-rate models). The ratio comes from the
      // SAME rate sheet that priced `cost` — no second price source. When
      // no rate sheet exists (passthrough/unknown), the discount is neutral
      // (1) so effTokens equals raw token count.
      const disc = rates && rates.input > 0 ? rates.cacheRead / rates.input : 1;
      const effTokens = inputTokens + outputTokens + m.cacheReadTokens * Math.min(1, Math.max(0, disc));
      const effPerM =
        m.cost !== null && m.cost > 0 && effTokens > 0 && m.sessions >= 3 ? (m.cost / (effTokens / 1_000_000)) : null;
      return {
        ...m,
        machineKey: key,
        inputTokens,
        outputTokens,
        cacheHitRate: denom > 0 ? m.cacheReadTokens / denom : 0,
        effPerM,
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
