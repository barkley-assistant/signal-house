/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, mergeNullSum, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { canonicalMachineKey, machineKey, modelFamily, modelLabel, stripDateSnapshot } from "../shared/models";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import { resolvePrivacyMap, isRepoVisible } from "../privacy/privacy";
import { costFromTokens } from "../shared/types";
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
  ci: { totalRuns: number; passCount: number; failCount: number; otherCount: number; passRate: number | null } | null;
  staleWork: { staleIssues: number; stalePrs: number; thresholdDays: number } | null;
  usage: UsageAggregate | null;
}

export interface AggregateOptions {
  states: PersistedState[];
  config: RuntimeConfig;
  days?: number;
  /** Precomputed usage aggregate from signal-house's own daily_metrics
   *  history; null falls back to snapshot derivation. */
  usageOverride?: UsageAggregate | null;
  costOpts?: CostEstimationOpts;
}

export function computeAggregates({
  states,
  config,
  days = DEFAULT_WINDOW_DAYS,
  usageOverride = null,
  costOpts = { rates: new Map(), enabled: false },
}: AggregateOptions): Aggregates {
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

  // CI — workflow runs inside the window. Every run is accounted for:
  // pass + fail + other === totalRuns, always. GitHub conclusions beyond
  // success/failure (skipped, cancelled, neutral, timed_out, startup_failure,
  // stale, plus in-flight runs with conclusion null) land in otherCount —
  // "unknown stays unknown" forbids silently dropping runs from the caption
  // arithmetic. Subtraction (not enumeration) because the collector passes
  // arbitrary conclusion strings through; subtraction is total by construction.
  const runs = ghRuns.filter((w) => inWindow(w.createdAt));
  const passCount = runs.filter((w) => w.conclusion === "success").length;
  const failCount = runs.filter((w) => w.conclusion === "failure").length;
  const otherCount = runs.length - passCount - failCount;
  const ci =
    runs.length > 0
      ? {
          totalRuns: runs.length,
          passCount,
          failCount,
          otherCount,
          // Terminal-only denominator: skipped/cancelled runs are not health
          // failures (GitHub required-check semantics), and the per-day
          // delivery chart computes the same rate from terminal runs only —
          // the window headline and the daily bars must agree.
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
  // When estimation is on, replace each source's upstream cost with the
  // estimator's per-source contribution (sum of per-source costs across
  // the merged model rows). When off, leave the upstream byDay sum in
  // place — that's what the source tiles should show. applyModelCostsToSources
  // owns that fold; it also accumulates the window savings.
  const windowSavings = applyModelCostsToSources(mergedByModel, bySource, costOpts);

  // totalCost: prefer the model-row totals (they carry the right value
  // whether estimated or passthrough) when estimation is enabled and
  // byModel is non-empty. Fall back to windowCost (the upstream byDay sum)
  // when estimation is off or when byModel is empty (tests' usageDays()
  // fixture, or real usage where a source has data but no per-model detail).
  const totalCost = preferModelTotalCost(mergedByModel, costOpts, windowCost);

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

    // Cost derivation + rate-sheet capture for this row (see priceRow):
    //   - estimateCosts=true:  recompute cost from tokens × rates.
    //                           "estimated" if openrouter or local had the model,
    //                           "unknown" if no rate was found anywhere,
    //                           "skipped" if the row has no tokens.
    //                           (For v1 we don't distinguish openrouter-source from
    //                           local-source in costSource; both are "estimated".
    //                           Future: per-row provenance via the resolver.)
    //   - estimateCosts=false: passthrough — use the upstream cost as-is.
    const { rowCost, rowCostSource, rowRates, cacheSavings } = priceRow(
      row,
      costOpts,
      rawKey,
      inputTokens,
      outputTokens,
      cacheReadTokens,
    );

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
      // adds the row's upstream cost gated on the source actually carrying tokens.
      src.cost += sourceCostSlice(inputTokens, outputTokens, cacheReadTokens, rowCost, rowCostSource, costOpts, rawKey, true);
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
        bySource: {
          [source]: {
            cacheReadTokens,
            inputTokens,
            outputTokens,
            cacheSavings,
            // First row for this model — the source owns all the tokens, so
            // passthrough takes the row's whole upstream cost (no share split).
            cost: sourceCostSlice(inputTokens, outputTokens, cacheReadTokens, rowCost, rowCostSource, costOpts, rawKey, false),
          },
        },
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

/** Cost derivation + rate-sheet capture for ONE row.
 *
 *  estimateCosts=true:  recompute cost from tokens × rates; "estimated" if
 *  a source had the model, "unknown" if no rate was found anywhere,
 *  "skipped" if the row has no tokens.
 *  estimateCosts=false: passthrough — the upstream cost as-is.
 *
 *  Also returns the rate sheet the row was priced with and the cache
 *  savings derived from it — kept together so cacheSavings and the effPerM
 *  discount derive from the SAME price source as `cost` (one price sheet
 *  per row, never a mix of estimator + legacy local rates).
 */
function priceRow(
  row: ModelUsageRow,
  costOpts: CostEstimationOpts,
  rawKey: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): { rowCost: number | null; rowCostSource: CostSource | undefined; rowRates: ModelRates | undefined; cacheSavings: number } {
  let rowCost: number | null;
  let rowCostSource: CostSource | undefined;
  let rowRates: ModelRates | undefined;
  if (costOpts.enabled) {
    // Dated variant first, stripped base as a fallback — mirrors the
    // resolver's lookup order (D1). The rates map is keyed by FULL
    // machine key (dated keys survive the parser), so a dated row must
    // hit its own dated entry before the base.
    const rates = costOpts.rates.get(rawKey) ?? costOpts.rates.get(stripDateSnapshot(rawKey));
    if (rates && (rates.input > 0 || rates.output > 0)) {
      rowRates = rates;
      rowCost = costFromTokens(inputTokens, outputTokens, cacheReadTokens, rates);
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
  return { rowCost, rowCostSource, rowRates, cacheSavings };
}

/** One source's slice of a row's cost.
 *
 *  Estimation mode: per-source tokens × rates, so bySource.<src>.cost is
 *  internally consistent with byModel[].cost (the same estimator number
 *  flows everywhere). Unknown/skipped rows contribute 0.
 *
 *  Passthrough: the row's upstream cost. The FIRST row for a model takes it
 *  whole (that source owns all the tokens); subsequent rows from other
 *  sources gate on the source carrying tokens — the token-share split
 *  collapses to the whole row cost because each row IS one source's slice.
 */
function sourceCostSlice(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  rowCost: number | null,
  rowCostSource: CostSource | undefined,
  costOpts: CostEstimationOpts,
  rawKey: string,
  distributeByShare: boolean,
): number {
  if (costOpts.enabled && rowCostSource !== "unknown" && rowCostSource !== "skipped") {
    const rates = costOpts.rates.get(rawKey) ?? costOpts.rates.get(stripDateSnapshot(rawKey));
    if (rates && (rates.input > 0 || rates.output > 0)) {
      return costFromTokens(inputTokens, outputTokens, cacheReadTokens, rates);
    }
    return 0;
  }
  if (!costOpts.enabled && rowCost !== null && rowCost > 0) {
    if (!distributeByShare) return rowCost;
    return inputTokens + outputTokens + cacheReadTokens > 0 ? rowCost : 0;
  }
  return 0;
}

/** Fold merged model rows' per-source costs + savings into the bySource map
 *  and return the window savings total.
 *
 *  Estimation mode REPLACES each source's upstream cost with the estimator's
 *  per-source contribution (the merged rows carry the computed totals; the
 *  upstream byDay sum would double-count). Passthrough keeps the upstream
 *  byDay sums and only adds savings.
 *
 *  Shared by the snapshot derivation (buildSnapshotUsage) and the
 *  daily-history aggregate (queryUsageAggregate) — the two data paths must
 *  stay numerically identical by contract, and sharing the fold is the only
 *  way to keep that true.
 */
export function applyModelCostsToSources(
  byModel: UsageAggregate["byModel"],
  bySource: Record<string, SourceUsageMetrics>,
  costOpts: CostEstimationOpts,
): number {
  let windowSavings = 0;
  const bySourceCostFromMerge = new Map<string, number>();
  for (const m of byModel) {
    windowSavings += m.cacheSavings ?? 0;
    for (const [source, data] of Object.entries(m.bySource ?? {})) {
      const src = bySource[source];
      if (src) {
        src.cacheSavings = (src.cacheSavings ?? 0) + data.cacheSavings;
        if (costOpts.enabled) {
          bySourceCostFromMerge.set(source, (bySourceCostFromMerge.get(source) ?? 0) + data.cost);
        }
      }
    }
  }
  if (costOpts.enabled) {
    for (const [source, cost] of bySourceCostFromMerge) {
      const src = bySource[source];
      if (src) src.cost = cost;
    }
  }
  return windowSavings;
}

/** Preferred totalCost: the estimator's by-model rollup when estimation is
 *  on and byModel is non-empty (it carries the right value whether
 *  estimated or passthrough), else the upstream per-day sum. Shared by the
 *  snapshot + daily-history paths so both report the same number. */
export function preferModelTotalCost(
  byModel: UsageAggregate["byModel"],
  costOpts: CostEstimationOpts,
  fallback: number | null,
): number | null {
  return costOpts.enabled && byModel.length > 0 ? sum(byModel.map((m) => m.cost ?? 0)) ?? 0 : fallback;
}
