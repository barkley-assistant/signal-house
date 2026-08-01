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
import { stateHandler, diagnosticsHandler, healthHandler, refreshHandler, resetLockHandler, dailyTrendHandler, type ApiDeps } from "./api/handlers";
import { withAuth } from "./auth/basic";
import { jsonError, notFound } from "./shared/http";
import { buildWebBundle, serveWebAsset, publicDirFor } from "./shared/web-assets";
import { log } from "./shared/logger";

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

  const deps: ApiDeps = {
    db: owner.db,
    config,
    collectors,
    lock,
    refreshCtx: () => ({ owner, config, collectors, lock }),
  };

  const api = (handler: (deps: ApiDeps) => Response | Promise<Response>) => withAuth(() => handler(deps), config);

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
        if (path === "/api/state" && req.method === "GET") return api(stateHandler)(req);
        if (path === "/api/diagnostics" && req.method === "GET") return api(diagnosticsHandler)(req);
        if (path === "/api/health" && req.method === "GET") return api(healthHandler)(req);
        if (path === "/api/refresh" && req.method === "POST") return api(refreshHandler)(req);
        if (path === "/api/refresh/reset-lock" && req.method === "POST") return api(resetLockHandler)(req);
        if (path === "/api/daily/spend" && req.method === "GET") return withAuth(() => dailyTrendHandler(deps, req), config)(req);
        return req.method === "GET" || req.method === "POST" ? notFound() : jsonError(405, "Method Not Allowed");
      }

      // SPA: serve built assets; any other GET falls back to index.html.
      if (req.method === "GET") {
        return withAuth(() => {
          const decoded = decodeURIComponent(path === "/" ? "/index.html" : path.slice(1));
          const asset = serveWebAsset(publicDir, decoded);
          if (asset) return asset;
          const index = serveWebAsset(publicDir, "index.html");
          return index ?? jsonError(500, "web bundle not built");
        }, config)(req);
      }
      return notFound();
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
