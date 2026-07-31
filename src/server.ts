/**
 * Signal House server — one Bun process serving the dashboard, API, poller,
 * collectors, and SQLite. Graceful shutdown on SIGTERM/SIGINT.
 */

import type { Server } from "bun";
import { DatabaseOwner } from "./db/client";
import { readConfig } from "./config/config";
import { createCollectors } from "./collectors";
import { RefreshLock } from "./orchestrator/lock";
import { runRefresh } from "./orchestrator/refresh";
import { startPoller } from "./poller/poller";
import { stateHandler, diagnosticsHandler, healthHandler, refreshHandler, resetLockHandler, dailyTrendHandler, type ApiDeps } from "./api/handlers";
import { withAuth } from "./auth/basic";
import { jsonError, notFound } from "./shared/http";
import { log } from "./shared/logger";

import dashboardHtml from "./web/index.html";

const config = readConfig({
  env: { get: (name) => process.env[name] },
  cwd: process.cwd(),
  dev: process.env.SIGNAL_HOUSE_DEV === "1",
});
const owner = DatabaseOwner.open(config.db.path);
const collectors = createCollectors(config);
const lock = new RefreshLock(owner.db, config.refresh.lockStaleMs);

const apiDeps: ApiDeps = {
  db: owner.db,
  config,
  collectors,
  lock,
  refreshCtx: () => ({ owner, config, collectors, lock }),
};

const api = (handler: (deps: ApiDeps) => Response | Promise<Response>) => withAuth(() => handler(apiDeps), config);

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  development: config.dev,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      if (path === "/api/state" && req.method === "GET") return api(stateHandler)(req);
      if (path === "/api/diagnostics" && req.method === "GET") return api(diagnosticsHandler)(req);
      if (path === "/api/health" && req.method === "GET") return api(healthHandler)(req);
      if (path === "/api/refresh" && req.method === "POST") return api(refreshHandler)(req);
      if (path === "/api/refresh/reset-lock" && req.method === "POST") return api(resetLockHandler)(req);
      if (path === "/api/daily/spend" && req.method === "GET") return withAuth(() => dailyTrendHandler(apiDeps, req), config)(req);
      return req.method === "GET" || req.method === "POST" ? notFound() : jsonError(405, "Method Not Allowed");
    }

    // SPA fallback: any non-API GET serves the dashboard.
    if (req.method === "GET") {
      const authed = withAuth(() => new Response(dashboardHtml as unknown as BodyInit, { headers: { "content-type": "text/html; charset=utf-8" } }), config);
      return authed(req);
    }
    return notFound();
  },
});

log.info("server", `listening on ${server.url.host} (${config.environment}, port ${config.port})`);

// Optional background refresh loop (disabled by default).
let pollerStop: (() => void) | null = null;

// First-run backfill: a fresh DB gets one automatic refresh so the last
// 30 days of usage history populate immediately (user requirement 2026-07-31).
const snapshotCount = (owner.db.query("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number }).n;
const isFreshDb = snapshotCount === 0;
const startupRefresh = (): void => void runRefresh({ owner, config, collectors, lock }, "poller");

if (config.poller.enabled) {
  pollerStop = startPoller(config, () => ({ owner, config, collectors, lock })).stop;
} else if (config.poller.runOnStartup || isFreshDb) {
  const t = setTimeout(startupRefresh, config.poller.startupDelaySeconds * 1000);
  t.unref?.();
  if (isFreshDb && !config.poller.runOnStartup) {
    log.info("server", "fresh database detected — scheduling first-run backfill refresh");
  }
}

// Graceful shutdown: stop timers, checkpoint WAL, close.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("server", `received ${signal}, shutting down`);
  pollerStop?.();
  server.stop(true);
  owner.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
