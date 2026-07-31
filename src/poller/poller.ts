/**
 * Poller — optional background refresh loop.
 *
 * Disabled by default. Honours interval clamps and startup delay (both applied
 * in config), optionally runs once at startup, reuses the normal refresh
 * runner, never overlaps a manual refresh (the lock refuses), continues after
 * recoverable collector failures (refresh status handles that), and stops
 * cleanly on shutdown. A module-level guard prevents duplicate timer
 * registration across development reloads (bun --hot).
 */

import type { RefreshContext } from "../orchestrator/refresh";
import { runRefresh } from "../orchestrator/refresh";
import type { RuntimeConfig } from "../config/types";
import { log } from "../shared/logger";

export interface PollerHandle {
  stop(): void;
}

interface PollerState {
  handle: PollerHandle;
  startedAt: number;
}

let active: PollerState | null = null;

/** Start the poller (idempotent — re-entry returns the running instance). */
export function startPoller(config: RuntimeConfig, ctx: () => RefreshContext): PollerHandle {
  if (active) return active.handle;

  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const cleared = { value: false };

  const tick = async (): Promise<void> => {
    if (cleared.value) return;
    try {
      await runRefresh(ctx(), "poller");
    } catch (err) {
      log.error("poller", `poll tick crashed: ${(err as Error).message}`);
    }
  };

  if (config.poller.runOnStartup) {
    const t = setTimeout(() => void tick(), config.poller.startupDelaySeconds * 1000);
    timers.push(t);
  }

  const interval = setInterval(() => void tick(), config.poller.intervalSeconds * 1000);
  // Don't keep the process alive just for the poller.
  interval.unref?.();

  const handle: PollerHandle = {
    stop() {
      cleared.value = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(interval);
      active = null;
    },
  };

  active = { handle, startedAt: Date.now() };
  log.info("poller", `poller started (interval=${config.poller.intervalSeconds}s, runOnStartup=${config.poller.runOnStartup})`);
  return handle;
}
