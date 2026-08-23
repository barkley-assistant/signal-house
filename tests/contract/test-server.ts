/**
 * Test harness: boots a real app via createApp() against a temp DB on a
 * random port — the exact production code path, zero env gymnastics.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { App } from "../../src/app";
import { createApp } from "../../src/app";
import type { RuntimeConfig } from "../../src/config/types";

export interface TestServer {
  port: number;
  app: App;
  stop(): void;
}

export async function startServer(opts: { dbPath: string; port?: number; auth?: { username: string; password: string }; hostMetrics?: boolean }): Promise<TestServer> {
  mkdirSync(dirname(opts.dbPath), { recursive: true });

  const config: RuntimeConfig = {
    dev: true,
    environment: "development",
    host: "127.0.0.1",
    port: opts.port ?? 0,
    db: { dir: dirname(opts.dbPath), file: "metrics.db", path: opts.dbPath },
    auth: {
      username: opts.auth?.username ?? "signal-house",
      password: opts.auth?.password ?? "",
      enabled: Boolean(opts.auth?.password),
    },
    github: { token: null, owner: null, repo: null },
    git: { repos: [], roots: [], globs: ["*"], maxDepth: 3, excludes: [] },
    hermes: { dbPath: "/nonexistent/hermes.db" },
    opencode: { dbPath: "/nonexistent/opencode.db" },
    usage: { periodDays: 30 },
    poller: { enabled: false, intervalSeconds: 300, startupDelaySeconds: 0, runOnStartup: false },
    orchestrator: { concurrency: 3, lookbackDays: 28, githubIntervalSeconds: 600 },
    staleness: { staleThresholdDays: 14, staleThresholdMinutes: 15 },
    retention: { snapshotsDays: 30, dailyMetricsDays: 90 },
    privacy: { showPrivateRepoItems: false },
    refresh: { lockStaleMs: 600_000 },
    estimateCosts: false,
    hostMetrics: { enabled: opts.hostMetrics ?? false },
  };

  const app = await createApp(config);
  return {
    port: Number(app.server.port),
    app,
    stop: () => app.stop(),
  };
}
