/** API route handlers — thin HTTP layer over domain functions. */

import pkg from "../../package.json";
import type { Database } from "bun:sqlite";
import type { RuntimeConfig } from "../config/types";
import type { Collector } from "../collectors";
import type { RefreshContext } from "../orchestrator/refresh";
import type { RefreshLock } from "../orchestrator/lock";
import type { CostEstimationOpts } from "../shared/types";
import { runRefresh } from "../orchestrator/refresh";
import { json, jsonError } from "../shared/http";
import { buildState } from "./build-state";
import { buildDiagnostics } from "../diagnostics/sources";
import { setRefreshMeta } from "../db/refresh-meta";
import { queryDailyTrend } from "../db/daily-metrics";
import { utcDay, utcDaysAgo } from "../shared/dates";
import { buildDeliveryTrend } from "../metrics/delivery";
import { ensureHostMetricsFresh, getHostMetricsPoints } from "../server/host-metrics-fetcher";
import { parseWindowDays } from "../shared/window";

export interface ApiDeps {
  db: Database;
  config: RuntimeConfig;
  collectors: Collector[];
  refreshCtx: () => RefreshContext;
  lock: RefreshLock;
}

/** GET /api/state — optional `?days=7|30|90` scopes every windowed metric. */
export async function stateHandler(deps: ApiDeps, req: Request): Promise<Response> {
  const days = parseWindowDays(new URL(req.url).searchParams.get("days"));
  const payload = await buildState(deps.db, deps.config, deps.collectors, Date.now(), days);
  return json(req, payload);
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
    version: pkg.version,
    time: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
}

/** GET /api/daily/spend — per-day cost+tokens trend for the Agent Spend chart.
 *  `?days=7|30|90` picks the window (default 30).
 *
 *  When `SIGNAL_HOUSE_ESTIMATE_COSTS=true` (the default), per-day costs are
 *  recomputed from tokens × litellm rates so the chart matches the by-model
 *  rollup in `/api/state`. When false, falls through to the upstream-reported
 *  `cost.total` per day (today's behavior).
 *
 *  Rates are fetched fresh inside queryDailyTrend (via the resolver), so a
 *  pricing refresh between dashboard polls is picked up immediately. */
export async function dailyTrendHandler(deps: ApiDeps, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const days = parseWindowDays(url.searchParams.get("days"));
  const to = url.searchParams.get("to") ?? utcDay();
  const from = url.searchParams.get("from") ?? utcDaysAgo(days);
  const costOpts: CostEstimationOpts = {
    rates: new Map(),
    enabled: deps.config.estimateCosts,
  };
  const points = await queryDailyTrend(deps.db, from, to, costOpts);
  return json(req, { from, to, days, points });
}

/** GET /api/daily/delivery — per-day CI pass-rate + commits + PRs-merged for the
 *  Delivery panel. Mirrors /api/daily/spend window semantics. */
export function deliveryTrendHandler(deps: ApiDeps, req: Request): Response {
  const url = new URL(req.url);
  const days = parseWindowDays(url.searchParams.get("days"));
  const to = url.searchParams.get("to") ?? utcDay();
  const from = url.searchParams.get("from") ?? utcDaysAgo(days);
  return json(req, buildDeliveryTrend(deps.db, from, to));
}

/** GET /api/daily/resource — per-day mem/swap/cpu percentages for the
 *  Delivery panel's optional third chart. Mirrors the sibling daily windows.
 *
 *  Gated on SIGNAL_HOUSE_HOST_METRICS_ENABLED (default off): when disabled
 *  the fetcher has never run and the payload is `{ enabled: false, points: [] }`
 *  — the UI hides the chart instead of rendering an empty one. When enabled,
 *  this evaluates the pmlogsummary cache (cheap no-op within the same clock
 *  hour) and returns a dense day list; days without data carry nulls. */
export async function resourceTrendHandler(deps: ApiDeps, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const days = parseWindowDays(url.searchParams.get("days"));
  const to = url.searchParams.get("to") ?? utcDay();
  const from = url.searchParams.get("from") ?? utcDaysAgo(days);

  if (!deps.config.hostMetrics.enabled) {
    return json(req, { from, to, days, enabled: false, points: [] });
  }
  await ensureHostMetricsFresh();
  return json(req, { from, to, days, enabled: true, points: getHostMetricsPoints(from, to) });
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
