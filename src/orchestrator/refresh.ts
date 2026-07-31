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
import { insertSnapshot } from "../db/snapshots";
import { setLatestState } from "../db/latest-state";
import { setRefreshMeta } from "../db/refresh-meta";
import { replaceDayForSource, backfillDaysForSource } from "../db/daily-metrics";
import { runRetention } from "../db/retention";
import { deriveDailyRows } from "../metrics/daily";
import { resolvePrivacyMap, uncoveredRepos } from "../privacy/privacy";
import { RefreshLock, type LockOwner } from "./lock";
import { utcDay } from "../shared/dates";
import { log } from "../shared/logger";

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
}

const REFRESH_META_KEY = "refresh_state";

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
    };
  }

  const startedMs = Date.now();
  try {
    const results = await runCollectorPool(ctx.collectors, ctx.config.orchestrator.concurrency);

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
      };
    }

    const partialData = failed.length > 0 || privacyUncovered > 0;

    ctx.owner.transaction(() => {
      const nowMs = Date.now();
      const today = utcDay(new Date(nowMs));

      for (const result of succeeded) {
        const data = result.data!;
        const state: PersistedState = {
          source: result.source,
          ok: true,
          unavailable: result.unavailable,
          capturedAt: nowMs,
          window: { start: utcDay(new Date(nowMs - ctx.config.orchestrator.lookbackDays * 86_400_000)), end: today },
          data,
          warnings: result.warnings,
          errors: result.errors,
          usage: data.usage,
        };
        setLatestState(ctx.owner.db, result.source, state, nowMs);
        insertSnapshot(ctx.owner.db, result.source, nowMs, data);

        // Same-day metrics replace; earlier days insert-or-ignore (stay intact).
        const rows = deriveDailyRows(result.source, data);
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
      if (failed.length === 0) setRefreshMeta(ctx.owner.db, "last_success_at", startedAt, nowMs);
      if (failed.length > 0) {
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
          sourceResults: results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable, errors: r.errors.length })),
        },
        nowMs,
      );
    });

    runRetention(ctx.owner.db, ctx.config);
    log.info("refresh", `refresh completed: ${status}`, { sources: results.length, failed: failed.length });

    return {
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
      partialData,
      privacyUncoveredCount: privacyUncovered,
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
    };
  } finally {
    ctx.lock.release(acquired.token);
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
      const collector = collectors[i];
      const ctrl = new AbortController();
      try {
        results.push(await collector.collect(ctrl.signal));
      } catch (err) {
        results.push({
          source: collector.id as CollectorId,
          ok: false,
          data: null,
          durationMs: 0,
          warnings: [],
          errors: [{ message: (err as Error).message, code: "collector_crash", retryable: true }],
          unavailable: false,
        });
      } finally {
        ctrl.abort();
      }
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
      sourceResults: results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable, errors: r.errors.length })),
    },
    now,
  );
}
