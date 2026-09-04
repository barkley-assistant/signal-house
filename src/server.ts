/**
 * Signal House entry point — one Bun process serving the dashboard, API,
 * poller, collectors, and SQLite. Graceful shutdown on SIGTERM/SIGINT.
 */

import { readConfig } from "./config/config";
import { createApp } from "./app";
import { startPoller } from "./poller/poller";
import { runRefresh } from "./orchestrator/refresh";
import { ensurePricingCacheFresh } from "./server/model-pricing-fetcher";
import { ensureHostMetricsFresh } from "./server/host-metrics-fetcher";
import { log } from "./shared/logger";

const config = readConfig({
  env: { get: (name) => process.env[name] },
  cwd: process.cwd(),
  dev: process.env.SIGNAL_HOUSE_DEV === "1",
});

const app = await createApp(config);
const { owner, lock, collectors } = app;

log.info("server", `listening on ${app.server.url.host} (${config.environment}, port ${config.port})`);

// Warm the pricing cache before the first refresh. Best-effort — a fetch
// failure is logged inside the fetcher and never aborts startup. The
// first refresh would otherwise run with an empty cache and produce
// $0 costs for openai rows until the next refresh cycle.
await ensurePricingCacheFresh();

// Warm the host-metrics cache before first request. Best-effort and gated
// on the opt-in flag: with the flag off this is a no-op, and a pmlogger
// failure is logged inside the fetcher without aborting startup. Without
// this warm-up the diagnostics block would read "empty / dayCount 0" until
// someone opened the dashboard.
if (config.hostMetrics.enabled) {
  await ensureHostMetricsFresh();
}

// Optional background refresh loop (disabled by default).
let pollerStop: (() => void) | null = null;

// First-run backfill: a fresh DB gets one automatic refresh so the last
// 30 days of usage history populate immediately (user requirement 2026-07-31).
// Fresh-db check keys on latest_state, not snapshots: github no longer
// writes snapshot rows (t_2c7b3493), so a github-only config would
// otherwise look "fresh" on every startup.
const stateCount = (owner.db.query("SELECT COUNT(*) AS n FROM latest_state").get() as { n: number }).n;
const isFreshDb = stateCount === 0;
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

// Graceful shutdown: stop timers, drain an in-flight refresh (bounded), close.
// Without the drain, SIGTERM mid-refresh orphans the persisted lock row —
// clearOrphanedAtStartup() backstops that, but finishing cleanly means the
// next process never starts life with a leaked lock at all.
const SHUTDOWN_DRAIN_MS = 30_000;
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("server", `received ${signal}, shutting down`);
  pollerStop?.();
  const deadline = Date.now() + SHUTDOWN_DRAIN_MS;
  while (lock.status().inProgress && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (lock.status().inProgress) {
    log.warn("server", `refresh still in progress after ${SHUTDOWN_DRAIN_MS}ms — proceeding; orphaned lock will be cleared on next startup`);
  }
  app.stop();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
