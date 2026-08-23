/**
 * Refresh runner — the single path used by manual refresh AND the poller.
 *
 * Responsibilities (instruction §Refresh Semantics):
 * - one in-process + persisted concurrency guard (RefreshLock)
 * - run enabled collectors with a concurrency limit
 * - combine results, resolve privacy (null → private, fail-closed)
 * - atomic snapshot persistence (latest_state + snapshots + daily_metrics +
 *   refresh metadata in ONE transaction)
 * - last-good preservation: failed sources keep their previous latest_state
 * - failure journaling; partial results persist when some collectors succeed
 * - retention after each refresh
 */

import type { Database } from "bun:sqlite";
import type { Collector, CollectorResult, SourceData, RefreshStatusKind, CollectorId } from "../shared/types";
import type { RuntimeConfig } from "../config/types";
import type { PersistedState } from "../config/types";
import type { DatabaseOwner } from "../db/client";
import { insertSnapshotIfChanged } from "../db/snapshots";
import { setLatestState, getAllLatestState } from "../db/latest-state";
import { setRefreshMeta } from "../db/refresh-meta";
import { replaceDayForSource, backfillDaysForSource } from "../db/daily-metrics";
import { runRetention } from "../db/retention";
import { deriveDailyRows } from "../metrics/daily";
import { ensurePricingCacheFresh } from "../server/model-pricing-fetcher";
import { resolvePrivacyMap, uncoveredRepos } from "../privacy/privacy";
import { RefreshLock, type LockOwner } from "./lock";
import { extractGithubTargets } from "../collectors/github/collector";
import { utcDay } from "../shared/dates";
import { log } from "../shared/logger";

/** Drop `byDay[].byModel` from a collector payload before snapshot
 *  persistence. The per-day model detail has already been written to
 *  daily_metrics (signal-house's own history) by the time this runs; keeping
 *  it in latest_state/snapshots would bloat every persisted blob (and every
 *  snapshot row, ~720/day) with data nothing else reads. */
function stripUsageDayModels(data: SourceData): SourceData {
  if (!data.usage?.byDay?.some((d) => d.byModel !== undefined)) return data;
  return {
    ...data,
    usage: {
      ...data.usage,
      byDay: data.usage.byDay.map(({ byModel: _byModel, ...day }) => day),
    },
  };
}

export interface RefreshContext {
  owner: DatabaseOwner;
  config: RuntimeConfig;
  collectors: Collector[];
  lock: RefreshLock;
}

export interface RefreshOutcome {
  status: RefreshStatusKind;
  startedAt: string;
  finishedAt: string;
  results: CollectorResult<SourceData>[];
  partialData: boolean;
  privacyUncoveredCount: number;
  /** Sources skipped this pass because their cadence hadn't elapsed. */
  skipped: string[];
}

const REFRESH_META_KEY = "refresh_state";

/**
 * Refresh semantics:
 * - `manual` forces every collector (operator override of cadence).
 * - `poller` respects per-source cadence (issue #361): fast sources every
 *   tick, github only when orchestrator.githubIntervalSeconds has elapsed
 *   since its last successful capture.
 */
export async function runRefresh(ctx: RefreshContext, owner: LockOwner): Promise<RefreshOutcome> {
  const startedAt = new Date().toISOString();
  const acquired = ctx.lock.acquire(owner);
  if (!acquired.ok) {
    log.warn("refresh", `refresh skipped: another refresh is in progress (${owner})`);
    return {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      results: [],
      partialData: false,
      privacyUncoveredCount: 0,
      skipped: [],
    };
  }

  try {
    // Warm the pricing cache before collectors run. Best-effort: a fetch
    // failure is logged inside the fetcher and never aborts the refresh.
    await ensurePricingCacheFresh();

    const forceAll = owner === "manual";
    const { results, skipped } = await runCollectors(ctx, forceAll);

    const succeeded = results.filter((r) => r.ok && r.data !== null);
    const failed = results.filter((r) => !r.ok);

    // Privacy resolution over everything collected this pass.
    const allRepos = succeeded.flatMap((r) => r.data!.repositories);
    const privacyMap = resolvePrivacyMap(allRepos);
    const privacyUncovered = uncoveredRepos(allRepos, privacyMap);

    const status: RefreshStatusKind =
      failed.length === 0 ? "success" : succeeded.length > 0 ? "partial" : "failed";

    if (status === "failed") {
      // Complete failure: journal it, touch nothing else — the dashboard keeps
      // showing the last good state.
      journalFailure(ctx.owner.db, startedAt, results);
      log.error("refresh", `refresh failed (${results.length} collectors)`, { failed: failed.length });
      return {
        status,
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        partialData: true,
        privacyUncoveredCount: privacyUncovered,
        skipped,
      };
    }

    const partialData = failed.length > 0 || privacyUncovered > 0;

    ctx.owner.transaction(() => {
      const nowMs = Date.now();
      const today = utcDay(new Date(nowMs));

      for (const result of succeeded) {
        const data = result.data!;
        // Per-day model breakdowns feed daily_metrics (signal-house's own
        // by-model history) but are stripped before snapshot persistence —
        // latest_state/snapshots stay lean (day totals + period byModel).
        const rows = deriveDailyRows(result.source, data);
        const persisted = stripUsageDayModels(data);
        const state: PersistedState = {
          source: result.source,
          ok: true,
          unavailable: result.unavailable,
          capturedAt: nowMs,
          window: { start: utcDay(new Date(nowMs - ctx.config.orchestrator.lookbackDays * 86_400_000)), end: today },
          data: persisted,
          warnings: result.warnings,
          errors: result.errors,
          usage: persisted.usage,
        };
        setLatestState(ctx.owner.db, result.source, state, nowMs);
        // Append-only history: skip the row when nothing changed (issue
        // #361 phase 2) — an absent snapshot means "identical to previous".
        insertSnapshotIfChanged(ctx.owner.db, result.source, nowMs, persisted);

        // Same-day metrics replace; earlier days upsert (refresh rows whose
        // values changed, leave pruned-upstream days untouched).
        const todayRows = rows.filter((r) => r.date === today);
        const olderRows = rows.filter((r) => r.date !== today);
        if (todayRows.length > 0) replaceDayForSource(ctx.owner.db, today, result.source, todayRows);
        if (olderRows.length > 0) {
          const byDay = new Map<string, typeof olderRows>();
          for (const r of olderRows) {
            const list = byDay.get(r.date) ?? [];
            list.push(r);
            byDay.set(r.date, list);
          }
          for (const [day, dayRows] of byDay) backfillDaysForSource(ctx.owner.db, day, result.source, dayRows);
        }
      }

      setRefreshMeta(ctx.owner.db, "last_run_started_at", startedAt, nowMs);
      setRefreshMeta(ctx.owner.db, "last_run_finished_at", new Date().toISOString(), Date.now());
      if (failed.length === 0) {
        setRefreshMeta(ctx.owner.db, "last_success_at", startedAt, nowMs);
        // A fully successful refresh supersedes any prior failure — clear it
        // so the dashboard never surfaces stale failure archaeology.
        setRefreshMeta(ctx.owner.db, "last_failure_at", null, nowMs);
        setRefreshMeta(ctx.owner.db, "last_failure_message", null, nowMs);
      } else {
        setRefreshMeta(ctx.owner.db, "last_failure_at", new Date().toISOString(), Date.now());
        setRefreshMeta(ctx.owner.db, "last_failure_message", failed.map((f) => f.errors.map((e) => e.message).join("; ")).join(" | "), Date.now());
      }
      setRefreshMeta(
        ctx.owner.db,
        REFRESH_META_KEY,
        {
          status,
          partialData,
          privacyUncoveredCount: privacyUncovered,
          sourceResults: results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable, errors: r.errors.length, durationMs: r.durationMs })),
        },
        nowMs,
      );
    });

    runRetention(ctx.owner.db, ctx.config);
    // One-line per-refresh latency summary — the "where did the time go"
    // surface for the cadence work (issue #361). Sorted slowest-first so
    // the expensive source is always the first thing you read.
    const timing = [...results].sort((a, b) => b.durationMs - a.durationMs).map((r) => `${r.source}=${r.durationMs}ms`);
    log.info("refresh", `collector timings: ${timing.join(" ")}`, { skippedCount: skipped.length });

    return {
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
      partialData,
      privacyUncoveredCount: privacyUncovered,
      skipped,
    };
  } catch (err) {
    log.error("refresh", `refresh crashed: ${(err as Error).message}`);
    journalFailure(ctx.owner.db, startedAt, []);
    return {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      results: [],
      partialData: true,
      privacyUncoveredCount: 0,
      skipped: [],
    };
  } finally {
    ctx.lock.release(acquired.token);
  }
}

/**
 * Run all collectors. The git collector runs FIRST so the GitHub collector
 * can fetch issues/PRs/CI for every repo git discovered locally; everything
 * else (github, hermes, opencode, sessions) runs in a bounded pool.
 *
 * Per-source cadence (issue #361): when `forceAll` is false, a collector is
 * SKIPPED unless it is due — see isCollectorDue. Skipped sources are absent
 * from the returned results entirely (they are neither successes nor
 * failures this pass).
 */
async function runCollectors(ctx: RefreshContext, forceAll: boolean): Promise<{ results: CollectorResult<SourceData>[]; skipped: string[] }> {
  const collectors = [...ctx.collectors];
  const results: CollectorResult<SourceData>[] = [];

  // Phase 0: git discovery alone.
  const gitIdx = collectors.findIndex((c) => c.id === "git");
  if (gitIdx >= 0) {
    const [gitCollector] = collectors.splice(gitIdx, 1);
    const gitResult = await collectOne(gitCollector);
    results.push(gitResult);
    // Feed discovered github remotes into the github collector.
    if (gitResult.ok && gitResult.data) {
      const gh = collectors.find((c) => c.id === "github");
      if (gh && "setCandidates" in gh) {
        (gh as { setCandidates(r: Array<{ owner: string; repo: string }>): void }).setCandidates(extractGithubTargets(gitResult.data));
      }
    }
  }

  // Phase 1: everything else (including github, now with candidates),
  // filtered to sources that are actually due this pass.
  const nowMs = Date.now();
  const skipped: string[] = [];
  const due: Collector[] = [];
  if (forceAll) {
    due.push(...collectors);
  } else {
    const lastSuccess = sourceLastSuccessMs(ctx.owner.db);
    for (const c of collectors) {
      if (isCollectorDue(c.id, lastSuccess.get(c.id) ?? null, nowMs, ctx.config)) due.push(c);
      else skipped.push(String(c.id));
    }
  }
  if (skipped.length > 0) {
    log.info("refresh", "cadence: skipping not-yet-due sources", { skipped });
  }

  results.push(...(await runCollectorPool(due, ctx.config.orchestrator.concurrency)));
  return { results, skipped };
}

/** Map of source → last SUCCESSFUL capture time (latest_state.updated ms).
 *  Rows only exist for sources that completed and persisted data, so an
 *  absent row means "never succeeded". */
function sourceLastSuccessMs(db: Database): Map<string, number> {
  return new Map(getAllLatestState(db).map((r) => [r.source, r.updated]));
}

/** Whether a collector should run in THIS pass (poller path; manual passes
 *  force everything and never consult this).
 *
 *  Fast local sources (everything except github) run on every tick. GitHub
 *  — a dozen-plus API calls per repo — only re-runs once
 *  `orchestrator.githubIntervalSeconds` has elapsed since its last
 *  successful capture.
 *
 *  Failure semantics fall out of keying off latest_state: a failed pass
 *  persists nothing, so `lastOkAt` stays at the previous success and the
 *  source remains due on every subsequent tick until it succeeds. A blip
 *  delays the cadence rather than skipping data. */
export function isCollectorDue(
  id: CollectorId | string,
  lastOkAtMs: number | null,
  nowMs: number,
  config: RuntimeConfig,
): boolean {
  if (id !== "github") return true;
  if (lastOkAtMs === null) return true;
  const intervalMs = config.orchestrator.githubIntervalSeconds * 1000;
  return nowMs - lastOkAtMs >= intervalMs;
}

/** Collect one collector with the standard abort + error wrapping. */
async function collectOne(collector: Collector): Promise<CollectorResult<SourceData>> {
  const ctrl = new AbortController();
  try {
    return await collector.collect(ctrl.signal);
  } catch (err) {
    return {
      source: collector.id as CollectorId,
      ok: false,
      data: null,
      durationMs: 0,
      warnings: [],
      errors: [{ message: (err as Error).message, code: "collector_crash", retryable: true }],
      unavailable: false,
    };
  } finally {
    ctrl.abort();
  }
}

/** Run collectors with a bounded concurrency pool. */
async function runCollectorPool(collectors: Collector[], concurrency: number): Promise<CollectorResult<SourceData>[]> {
  const results: CollectorResult<SourceData>[] = [];
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= collectors.length) return;
      results.push(await collectOne(collectors[i]));
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, collectors.length)) }, worker);
  await Promise.all(workers);
  return results;
}

function journalFailure(db: Database, startedAt: string, results: CollectorResult<SourceData>[]): void {
  const now = Date.now();
  setRefreshMeta(db, "last_run_started_at", startedAt, now);
  setRefreshMeta(db, "last_run_finished_at", new Date().toISOString(), now);
  setRefreshMeta(db, "last_failure_at", new Date().toISOString(), now);
  const message =
    results.length > 0
      ? results.filter((r) => !r.ok).map((r) => `${r.source}: ${r.errors.map((e) => e.message).join("; ")}`).join(" | ")
      : "refresh runner crashed before collectors completed";
  setRefreshMeta(db, "last_failure_message", message, now);
  setRefreshMeta(
    db,
    REFRESH_META_KEY,
    {
      status: "failed",
      partialData: true,
      privacyUncoveredCount: 0,
      sourceResults: results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable, errors: r.errors.length, durationMs: r.durationMs })),
    },
    now,
  );
}
