/**
 * Signal House entry point — one Bun process serving the dashboard, API,
 * poller, collectors, and SQLite. Graceful shutdown on SIGTERM/SIGINT.
 */

import { readConfig } from "./config/config";
import { createApp } from "./app";
import { startPoller } from "./poller/poller";
import { runRefresh } from "./orchestrator/refresh";
import { log } from "./shared/logger";

const config = readConfig({
  env: { get: (name) => process.env[name] },
  cwd: process.cwd(),
  dev: process.env.SIGNAL_HOUSE_DEV === "1",
});

const app = await createApp(config);
const { owner, lock, collectors } = app;

log.info("server", `listening on ${app.server.url.host} (${config.environment}, port ${config.port})`);

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
  app.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
