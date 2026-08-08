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
import { parseWindowDays } from "../shared/window";

export interface ApiDeps {
  db: Database;
  config: RuntimeConfig;
  collectors: Collector[];
  refreshCtx: () => RefreshContext;
  lock: RefreshLock;
}

/** GET /api/state — optional `?days=7|30|90` scopes every windowed metric. */
export function stateHandler(deps: ApiDeps, req: Request): Response {
  const days = parseWindowDays(new URL(req.url).searchParams.get("days"));
  return json(req, buildState(deps.db, deps.config, deps.collectors, Date.now(), days));
}

/** GET /api/diagnostics — lazy; the UI only fetches when the panel opens. */
export function diagnosticsHandler(deps: ApiDeps, req: Request): Response {
  return json(req, buildDiagnostics(deps.db, deps.config, deps.collectors));
}

/** GET /api/health — lightweight, never triggers collectors. */
export function healthHandler(_deps: ApiDeps, req: Request): Response {
  return json(req, {
    status: "ok",
    service: "signal-house",
    version: "2.0.0",
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

/** GET /api/daily/spend — per-day cost+tokens trend for the Agent Spend chart.
 *  `?days=7|30|90` picks the window (default 30). */
export function dailyTrendHandler(deps: ApiDeps, req: Request): Response {
  const url = new URL(req.url);
  const days = parseWindowDays(url.searchParams.get("days"));
  const to = url.searchParams.get("to") ?? utcDay();
  const from = url.searchParams.get("from") ?? utcDaysAgo(days);
  return json(req, { from, to, days, points: queryDailyTrend(deps.db, from, to) });
}

/** POST /api/refresh — manual refresh through the SAME runner as the poller. */
export async function refreshHandler(deps: ApiDeps, req: Request): Promise<Response> {
  const outcome = await runRefresh(deps.refreshCtx(), "manual");
  setRefreshMeta(deps.db, "last_manual_refresh_at", new Date().toISOString());
  if (outcome.status === "failed" && outcome.results.length === 0) {
    // Lock refused (overlap) → 409 Conflict.
    return jsonError(req, 409, "refresh already in progress", { inProgress: true });
  }
  return json(req, {
    status: outcome.status,
    startedAt: outcome.startedAt,
    finishedAt: outcome.finishedAt,
    partialData: outcome.partialData,
    sources: outcome.results.map((r) => ({ source: r.source, ok: r.ok, unavailable: r.unavailable })),
  });
}

/** POST /api/refresh/reset-lock — clears ONLY lock state; never data. */
export function resetLockHandler(deps: ApiDeps, req: Request): Response {
  deps.lock.reset();
  return json(req, { status: "ok", message: "refresh lock cleared" });
}
