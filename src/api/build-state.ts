/**
 * /api/state builder — reads latest_state + refresh_meta, derives aggregates,
 * applies the privacy filter, and produces the full dashboard payload.
 *
 * Freshness contract: fresh / stale / partial / missing are explicit;
 * unavailable metrics stay null; privacy fails closed (server-side only).
 */

import type { Database } from "bun:sqlite";
import type { RuntimeConfig } from "../config/types";
import type { Collector } from "../collectors";
import { parsedLatestStates } from "../db/latest-state";
import { getRefreshMetaMany } from "../db/refresh-meta";
import { computeAggregates, type UsageAggregate } from "../orchestrator/aggregates";
import { fetchAllRates } from "../server/model-pricing";
import { getPricingCacheStatus } from "../server/model-pricing-fetcher";
import type { ModelRates } from "../shared/types";
import { resolvePrivacyMap, isRepoVisible, uncoveredRepos } from "../privacy/privacy";
import { utcDaysAgo, utcDay } from "../shared/dates";
import { DEFAULT_WINDOW_DAYS } from "../shared/window";
import { queryUsageAggregate } from "../metrics/usage-history";
import type { RefreshState } from "../shared/types";

export interface AttentionItem {
  id: string;
  type: "issue" | "pr";
  repoKey: string;
  repo: string;
  title: string;
  url: string;
  state: "open" | "closed";
  updatedAt: string;
  ageDays: number;
  stale: boolean;
  ciStatus: string | null;
  labels: string[];
}

export interface StatePayload {
  window: { start: string; end: string; days: number };
  summary: {
    throughput: { issuesOpened: number; issuesClosed: number; prsCreated: number; prsMerged: number; totalCommits: number } | null;
    cycleTime: { avgSeconds: number | null; medianSeconds: number | null; p95Seconds: number | null; sampleSize: number } | null;
    ci: { totalRuns: number; passCount: number; failCount: number; passRate: number | null } | null;
    staleWork: { staleIssues: number; stalePrs: number; thresholdDays: number } | null;
    costAndTokens: {
      cost: number | null;
      tokens: number | null;
      costPerHour: number | null;
      tokensPerHour: number | null;
      /** Additive cache metrics — always populated by build-state. */
      cacheReadTokens?: number | null;
      cacheHitRate?: number | null;
      cacheSavings?: number | null;
    } | null;
  };
  usage: UsageAggregate | null;
  attention: AttentionItem[];
  status: {
    refresh: RefreshState;
    freshness: {
      state: "fresh" | "stale" | "missing";
      lastUpdatedAt: number | null;
      staleThresholdMinutes: number;
    };
    partialData: boolean;
    sources: Array<{
      id: string;
      title: string;
      tier: string;
      ok: boolean;
      unavailable: boolean;
      capturedAt: number | null;
      warnings: string[];
      errors: Array<{ message: string; code: string; retryable: boolean }>;
    }>;
    coverageWarnings: string[];
  };
}

const ATTENTION_LIMIT = 20;

export async function buildState(db: Database, config: RuntimeConfig, collectors: Collector[], now: number = Date.now(), days: number = DEFAULT_WINDOW_DAYS): Promise<StatePayload> {
  const states = parsedLatestStates(db);

  const bySource = new Map(states.map((s) => [s.source, s]));
  // Usage reads signal-house's own accumulated daily_metrics history for the
  // window (it keeps 90 days independent of upstream retention); the snapshot
  // derivation is the fallback inside computeAggregates.
  const start = utcDaysAgo(days);
  const end = utcDay();

  // Pre-fetch model rates for estimation. The aggregator reads from this map
  // per-row without awaiting (it's a sync lookup). Dedupes by machine key.
  // We collect the model keys from all per-source byModel rows. If estimation
  // is off, the map is unused but still cheap to build (empty if no rows).
  const allModelKeys = states.flatMap((s) =>
    (s.data?.usage?.byModel ?? []).map((m) => m.model),
  );
  const costRates: Map<string, ModelRates> = await fetchAllRates(allModelKeys);

  const aggregates = computeAggregates(
    states,
    config,
    days,
    queryUsageAggregate(db, start, end, costRates, config.estimateCosts),
    costRates,
  );

  const allRepos = states.flatMap((s) => s.data!.repositories);
  const privacyMap = resolvePrivacyMap(allRepos);
  const uncovered = uncoveredRepos(allRepos, privacyMap);

  const showPrivate = config.privacy.showPrivateRepoItems;
  const visible = (repoKey: string) => isRepoVisible(repoKey, privacyMap, showPrivate);

  // Attention queue — open issues/PRs from visible repos, newest-first.
  const attention: AttentionItem[] = [];
  const staleMs = now - config.staleness.staleThresholdDays * 86_400_000;
  const shaToCi = new Map<string, string>();
  for (const s of states) {
    for (const run of s.data!.workflowRuns) {
      if (run.conclusion && !shaToCi.has(run.headSha)) shaToCi.set(run.headSha, run.conclusion);
    }
  }
  for (const s of states) {
    const d = s.data!;
    for (const issue of d.issues) {
      if (issue.state !== "open" || !visible(issue.repoKey)) continue;
      attention.push({
        id: `issue:${issue.id}`,
        type: "issue",
        repoKey: issue.repoKey,
        repo: issue.repo,
        title: issue.title,
        url: issue.url,
        state: issue.state,
        updatedAt: issue.updatedAt,
        ageDays: Math.max(0, Math.floor((now - Date.parse(issue.createdAt)) / 86_400_000)),
        stale: Date.parse(issue.updatedAt) < staleMs,
        ciStatus: null,
        labels: issue.labels,
      });
    }
    for (const pr of d.pullRequests) {
      if (pr.state !== "open" || !visible(pr.repoKey)) continue;
      attention.push({
        id: `pr:${pr.id}`,
        type: "pr",
        repoKey: pr.repoKey,
        repo: pr.repo,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        updatedAt: pr.updatedAt,
        ageDays: Math.max(0, Math.floor((now - Date.parse(pr.createdAt)) / 86_400_000)),
        stale: Date.parse(pr.updatedAt) < staleMs,
        ciStatus: pr.headSha ? shaToCi.get(pr.headSha) ?? null : null,
        labels: pr.labels,
      });
    }
  }
  attention.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const refreshState = readRefreshState(db, config);
  const latestCapturedAt = states.reduce((max, s) => Math.max(max, s.capturedAt), 0);
  const staleThresholdMinutes = config.staleness.staleThresholdMinutes;
  const freshness =
    latestCapturedAt === 0
      ? { state: "missing" as const, lastUpdatedAt: null, staleThresholdMinutes }
      : {
          state: (now - latestCapturedAt > staleThresholdMinutes * 60_000 ? "stale" : "fresh") as "fresh" | "stale",
          lastUpdatedAt: latestCapturedAt,
          staleThresholdMinutes,
        };

  // Coverage warnings — operator-visible honesty about what's missing.
  const coverageWarnings: string[] = [];
  if (refreshState.status === "failed") coverageWarnings.push("Last refresh failed — showing last good data");
  if (refreshState.status === "partial") coverageWarnings.push("Last refresh was partial — some sources failed");
  if (uncovered > 0) coverageWarnings.push(`${uncovered} repository/privacy entries could not be verified (treated as private)`);
  for (const s of states) {
    if (s.unavailable) coverageWarnings.push(`${s.source} unavailable: ${s.warnings.join("; ")}`);
    for (const e of s.errors) coverageWarnings.push(`${s.source}: ${e.message}`);
  }

  const usage = aggregates.usage;
  const hours = aggregates.window.days * 24;

  return {
    window: aggregates.window,
    summary: {
      throughput: aggregates.throughput,
      cycleTime: aggregates.cycleTime,
      ci: aggregates.ci,
      staleWork: aggregates.staleWork,
      costAndTokens: usage
        ? {
            cost: usage.totalCost,
            tokens: usage.totalTokens,
            costPerHour: usage.totalCost !== null && hours > 0 ? usage.totalCost / hours : null,
            tokensPerHour: usage.totalTokens !== null && hours > 0 ? usage.totalTokens / hours : null,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheHitRate: usage.cacheHitRate ?? 0,
            cacheSavings: usage.cacheSavings ?? 0,
          }
        : null,
    },
    usage,
    attention: attention.slice(0, ATTENTION_LIMIT),
    status: {
      refresh: refreshState,
      freshness,
      partialData: refreshState.partialData ?? false,
      sources: collectors.map((c) => {
        const s = bySource.get(c.id);
        return {
          id: c.id,
          title: c.title,
          tier: c.tier,
          ok: s?.ok ?? false,
          unavailable: s?.unavailable ?? true,
          capturedAt: s?.capturedAt ?? null,
          warnings: s?.warnings ?? [],
          errors: s?.errors ?? [],
        };
      }),
      coverageWarnings,
    },
  };
}

function readRefreshState(db: Database, config: RuntimeConfig): RefreshState {
  // One batched query instead of 8 PK lookups per /api/state request.
  const meta = getRefreshMetaMany(db, [
    "refresh_state",
    "refresh_lock",
    "last_run_started_at",
    "last_run_finished_at",
    "last_success_at",
    "last_failure_at",
    "last_failure_message",
    "last_manual_refresh_at",
  ]);
  const refreshState = meta.get("refresh_state") as { status?: RefreshState["status"]; partialData?: boolean } | null | undefined;
  const status = (refreshState?.status ?? (meta.get("last_failure_at") ? "failed" : "idle")) as RefreshState["status"];
  const lock = meta.get("refresh_lock") as { token: string; owner: "manual" | "poller"; acquiredAt: number } | null | undefined;
  const staleLock = lock ? Date.now() - lock.acquiredAt > config.refresh.lockStaleMs : false;

  return {
    status,
    inProgress: !!(lock && !staleLock),
    lastRunStartedAt: (meta.get("last_run_started_at") as string | null | undefined) ?? null,
    lastRunFinishedAt: (meta.get("last_run_finished_at") as string | null | undefined) ?? null,
    lastSuccessAt: (meta.get("last_success_at") as string | null | undefined) ?? null,
    lastFailureAt: (meta.get("last_failure_at") as string | null | undefined) ?? null,
    lastFailureMessage: (meta.get("last_failure_message") as string | null | undefined) ?? null,
    lastManualRefreshAt: (meta.get("last_manual_refresh_at") as string | null | undefined) ?? null,
    lockOwner: lock && !staleLock ? lock.owner : null,
    partialData: Boolean(refreshState?.partialData),
  };
}

export { utcDaysAgo, utcDay };
