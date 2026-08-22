/**
 * createApp — the whole Signal House application as a factory.
 *
 * Returns { server, owner, lock, stop }. The entry point (src/server.ts)
 * wires config + signals around it; tests build an app against a temp DB and
 * random port with zero environment gymnastics.
 */

import type { Server } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeConfig } from "./config/types";
import { DatabaseOwner } from "./db/client";
import { createCollectors } from "./collectors";
import { RefreshLock } from "./orchestrator/lock";
import { stateHandler, diagnosticsHandler, healthHandler, refreshHandler, resetLockHandler, dailyTrendHandler, deliveryTrendHandler, type ApiDeps } from "./api/handlers";
import { withAuth } from "./auth/basic";
import { jsonError, notFound } from "./shared/http";
import { buildWebBundle, serveWebAsset, publicDirFor } from "./shared/web-assets";
import { log } from "./shared/logger";
import { getPricingMapSnapshot } from "./server/model-pricing-fetcher";

export interface App {
  server: Server<unknown>;
  owner: DatabaseOwner;
  lock: RefreshLock;
  deps: ApiDeps;
  config: RuntimeConfig;
  collectors: ReturnType<typeof createCollectors>;
  publicDir: string;
  stop(): void;
}

export async function createApp(config: RuntimeConfig): Promise<App> {
  const owner = DatabaseOwner.open(config.db.path);
  const collectors = createCollectors(config);
  const lock = new RefreshLock(owner.db, config.refresh.lockStaleMs);

  // Build the rates map once at startup from the fetcher's in-memory cache
  // (the startup hook in src/server.ts warms it before app construction).
  // If the cache is empty at this moment, the map is empty and the first
  // refresh tick will repopulate it via setCostRates(); the aggregator handles
  // either case (missing rates → costSource: 'unknown').
  const costRates = getPricingMapSnapshot();

  const deps: ApiDeps = {
    db: owner.db,
    config,
    collectors,
    lock,
    refreshCtx: () => ({ owner, config, collectors, lock }),
    costRates,
  };

  const api = (handler: (deps: ApiDeps, req: Request) => Response | Promise<Response>) =>
    withAuth((req) => handler(deps, req), config);

  // Pre-bound route handlers — one closure per route, built once at startup
  // instead of re-allocating a wrapper per request.
  const apiState = api(stateHandler);
  const apiDiagnostics = api(diagnosticsHandler);
  const apiHealth = api(healthHandler);
  const apiRefresh = api(refreshHandler);
  const apiResetLock = api(resetLockHandler);
  const apiDailyTrend = withAuth((req) => dailyTrendHandler(deps, req), config);
  const apiDeliveryTrend = withAuth((req) => deliveryTrendHandler(deps, req), config);

  // The SPA is served as static files (dist/public) through the auth'd handler.
  const publicDir = publicDirFor(process.cwd());
  if (!existsSync(join(publicDir, "index.html"))) {
    try {
      await buildWebBundle(publicDir);
    } catch (err) {
      // Server still starts; / returns 500 until the bundle builds — surface
      // the failure so the operator knows why the dashboard is missing.
      log.warn("server", `web bundle missing and build failed: ${(err as Error).message}`);
    }
  }

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    development: config.dev,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        if (path === "/api/state" && req.method === "GET") return apiState(req);
        if (path === "/api/diagnostics" && req.method === "GET") return apiDiagnostics(req);
        if (path === "/api/health" && req.method === "GET") return apiHealth(req);
        if (path === "/api/refresh" && req.method === "POST") return apiRefresh(req);
        if (path === "/api/refresh/reset-lock" && req.method === "POST") return apiResetLock(req);
        if (path === "/api/daily/spend" && req.method === "GET") return apiDailyTrend(req);
        if (path === "/api/daily/delivery" && req.method === "GET") return apiDeliveryTrend(req);
        return req.method === "GET" || req.method === "POST" ? notFound(req) : jsonError(req, 405, "Method Not Allowed");
      }

      // SPA: serve built assets; any other GET falls back to index.html.
      if (req.method === "GET") {
        return withAuth(() => {
          const decoded = decodeURIComponent(path === "/" ? "/index.html" : path.slice(1));
          const asset = serveWebAsset(publicDir, decoded);
          if (asset) return asset;
          const index = serveWebAsset(publicDir, "index.html");
          return index ?? jsonError(req, 500, "web bundle not built");
        }, config)(req);
      }
      return notFound(req);
    },
  });

  return {
    server,
    owner,
    lock,
    deps,
    config,
    collectors,
    publicDir,
    stop() {
      server.stop(true);
      owner.close();
    },
  };
}
