/** API route handlers — thin HTTP layer over domain functions. */

import type { Database } from "bun:sqlite";
import type { RuntimeConfig } from "../config/types";
import type { Collector } from "../collectors";
import type { RefreshContext } from "../orchestrator/refresh";
import type { RefreshLock } from "../orchestrator/lock";
import { runRefresh } from "../orchestrator/refresh";
import { json, jsonError } from "../shared/http";
import { buildState } from "./build-state";
import { buildDiagnostics } from "../diagnostics/sources";
import { setRefreshMeta } from "../db/refresh-meta";
import { queryDailyTrend } from "../db/daily-metrics";
import { utcDay, utcDaysAgo } from "../shared/dates";

export interface ApiDeps {
  db: Database;
  config: RuntimeConfig;
  collectors: Collector[];
  refreshCtx: () => RefreshContext;
  lock: RefreshLock;
}

/** GET /api/state */
export function stateHandler(deps: ApiDeps): Response {
  return json(buildState(deps.db, deps.config, deps.collectors));
}

/** GET /api/diagnostics — lazy; the UI only fetches when the panel opens. */
export function diagnosticsHandler(deps: ApiDeps): Response {
  return json(buildDiagnostics(deps.db, deps.config, deps.collectors));
}

/** GET /api/health — lightweight, never triggers collectors. */
export function healthHandler(deps: ApiDeps): Response {
  return json({
    status: "ok",
    service: "signal-house",
    version: "2.0.0",
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

/** GET /api/daily/spend — per-day cost+tokens trend for the Agent Spend chart. */
export function dailyTrendHandler(deps: ApiDeps, req: Request): Response {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? utcDay();
  const from = url.searchParams.get("from") ?? utcDaysAgo(30);
  return json({ from, to, points: queryDailyTrend(deps.db, from, to) });
}

/** POST /api/refresh — manual refresh through the SAME runner as the poller. */
export async function refreshHandler(deps: ApiDeps): Promise<Response> {
  const outcome = await runRefresh(deps.refreshCtx(), "manual");
  setRefreshMeta(deps.db, "last_manual_refresh_at", new Date().toISOString());
  if (outcome.status === "failed" && outcome.results.length === 0) {
    // Lock refused (overlap) → 409 Conflict.
    return jsonError(409, "refresh already in progress", { inProgress: true });
  }
  return json({
    status: outcome.status,
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt,
    partialData: outcome.partialData,
    sources: outcome.results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable })),
  });
}

/** POST /api/refresh/reset-lock — clears ONLY lock state; never data. */
export function resetLockHandler(deps: ApiDeps): Response {
  deps.lock.reset();
  return json({ status: "ok", message: "refresh lock cleared" });
}
