/**
 * Pricing fetcher — openference preferred, OpenRouter fallback, each with
 * its own disk cache + atomic write + hourly freshness gate.
 *
 * Architecture:
 *   - Two independent sources, two disk files in the same cache dir
 *     (~/.local/share/signal-house-v2/runtime/.data/):
 *       - model-pricing.json          (OpenRouter, keyless)
 *       - openference-pricing.json    (openference, authenticated)
 *     Each has its own in-memory map, cache status, atomic disk cache, and
 *     clock-hour freshness gate. A failure in one never takes down the other
 *     (Promise.allSettled); each keeps its previous-good cache.
 *   - Source priority lives in getModelPricing(): openference wins when it
 *     has the model, OpenRouter is the fallback. (The dated-vs-stripped
 *     lookup order lives in the resolver, src/server/model-pricing.ts.)
 *   - openference is AUTH-ONLY: the fetch sends `Authorization: Bearer
 *     <OPENFERENCE_API_KEY>` read from process.env at fetch time (not import
 *     time, and never logged). With no key the fetch is SKIPPED entirely —
 *     an unauthenticated openference fetch returns higher (wrong-for-us)
 *     rates (verified 2026-09-03: flash-0731 serves 0.44/1.32 unauthenticated
 *     vs the billed 0.14/0.28 authenticated), so a bare fetch is never
 *     attempted. OpenRouter remains the source in that case.
 *   - Disk cache: written atomically (temp file → Bun.write fsync → rename)
 *     so a process kill mid-write never corrupts the cache. The
 *     previous-good version survives.
 *   - Network refresh: at most hourly per source, aligned to the top of the
 *     hour (sameClockHour gate — see below).
 *   - Failure modes (every one preserves the previous-good cache):
 *       - fetch fails AND disk cache exists   → use disk cache, status "stale"
 *       - fetch fails AND disk cache missing  → in-memory stays empty,
 *                                                getModelPricing returns zeros,
 *                                                diagnostics surfaces "failed"
 *       - no key (openference only)           → source skipped, status "empty"
 *                                                (or "stale" when a disk cache
 *                                                is loaded but unrefreshable)
 *       - Bun.write fails                     → temp file written, rename never happens,
 *                                                disk cache unchanged
 *       - rename fails                         → temp file orphaned, disk cache unchanged
 *       - process killed between write & rename → temp file orphaned, disk cache unchanged
 *
 * The fetcher NEVER throws. All errors are logged + reflected in the
 * PricingCacheStatus surfaced via diagnostics.
 *
 * Plan ref: docs/plans/model-pricing-estimator.md §A (Pricing fetcher),
 * §D.1 (Atomic write discipline); .hermes/plans/pricing-fix.md D3.
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { log } from "../shared/logger";
import {
  parseOpenRouterPricing,
  parseOpenferencePricing,
  type PricingMap,
} from "../shared/model-pricing-parser";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const OPENFERENCE_URL = "https://api.openference.com/v1/models";
const CACHE_FILENAME = "model-pricing.json";
const OPENFERENCE_CACHE_FILENAME = "openference-pricing.json";
/** Refresh at most hourly, aligned to the top of the hour: ensurePricingCacheFresh()
 *  treats a cache as fresh only within the current clock hour (sameClockHour).
 *  The poller calls it on its own cadence (every 2 min); this gate collapses
 *  those calls into at most one network fetch per hour per source. Both
 *  catalogs are stable for days — hourly is generous; the alignment just
 *  makes refresh timing predictable. */
const SCHEMA_DRIFT_THRESHOLD = 0.3; // warn if model count drops > 30%

export type FetchStatus = "ok" | "failed" | "stale" | "empty";

export interface PricingCacheStatus {
  lastFetchedAt: string | null;
  lastFetchStatus: FetchStatus;
  modelCount: number;
  source: string;
}

interface CachedFile {
  fetchedAt: string;
  source: string;
  providerFilter: string;
  modelCount: number;
  models: PricingMap;
}

/** Per-source state. Both sources share the same machinery; only the URL,
 *  filename, parser, and auth requirement differ. */
interface SourceState {
  url: string;
  filename: string;
  providerFilter: string;
  parse: (json: unknown) => PricingMap;
  /** Env var holding the bearer token; null → keyless source. Read at fetch
   *  time inside refreshSource, never logged. */
  authEnvVar: string | null;
  path: string;
  inMemory: { map: PricingMap; fetchedAt: string; source: string; modelCount: number } | null;
  lastStatus: PricingCacheStatus;
}

function defaultCachePath(filename: string): string {
  return `${process.env.HOME ?? process.env.USERPROFILE}/.local/share/signal-house-v2/runtime/.data/${filename}`;
}

function emptyStatus(source: string): PricingCacheStatus {
  return { lastFetchedAt: null, lastFetchStatus: "empty", modelCount: 0, source };
}

const openrouter: SourceState = {
  url: OPENROUTER_URL,
  filename: CACHE_FILENAME,
  providerFilter: "openrouter",
  parse: parseOpenRouterPricing,
  authEnvVar: null,
  path: defaultCachePath(CACHE_FILENAME),
  inMemory: null,
  lastStatus: emptyStatus(OPENROUTER_URL),
};

const openference: SourceState = {
  url: OPENFERENCE_URL,
  filename: OPENFERENCE_CACHE_FILENAME,
  providerFilter: "openference",
  parse: parseOpenferencePricing,
  authEnvVar: "OPENFERENCE_API_KEY",
  path: defaultCachePath(OPENFERENCE_CACHE_FILENAME),
  inMemory: null,
  lastStatus: emptyStatus(OPENFERENCE_URL),
};

/**
 * Look up per-1M-token rates for a model.
 * Returns the in-memory cache entry, or zero rates if unknown / cache empty.
 *
 * Source priority lives here: openference (the bill) before OpenRouter.
 * The dated-vs-stripped key order lives in the resolver (model-pricing.ts).
 */
export async function getModelPricing(model: string): Promise<{ input: number; output: number; cacheRead: number }> {
  await ensurePricingCacheFresh();
  // Import lazily to avoid a cycle (models.ts is in shared/, but we want to keep
  // this module light). The resolver (model-pricing.ts) wraps this + the local
  // fallback; callers should use the resolver, not this directly.
  const { machineKey } = await import("../shared/models");
  const key = machineKey(model);
  if (!key) return { input: 0, output: 0, cacheRead: 0 };
  const entry = openference.inMemory?.map[key] ?? openrouter.inMemory?.map[key];
  if (!entry) return { input: 0, output: 0, cacheRead: 0 };
  return entry;
}

/** Diagnostics surface for build-state.ts. Read-only. OpenRouter status. */
export function getPricingCacheStatus(): PricingCacheStatus {
  return openrouter.lastStatus;
}

/** Diagnostics surface for build-state.ts. Read-only. openference status. */
export function getOpenferenceCacheStatus(): PricingCacheStatus {
  return openference.lastStatus;
}

/**
 * Ensure both in-memory caches are loaded. If a disk cache is missing or older
 * than the clock-hour TTL, attempt a network refresh for the sources that
 * need it. Non-blocking on failure — falls back to whatever the disk has, or
 * stays empty.
 */
export async function ensurePricingCacheFresh(): Promise<void> {
  let needRefresh = false;
  for (const state of [openrouter, openference]) {
    // First call in this process: load from disk.
    if (!state.inMemory) {
      const loaded = loadFromDisk(state);
      if (loaded) {
        state.inMemory = loaded;
        state.lastStatus = {
          lastFetchedAt: loaded.fetchedAt,
          lastFetchStatus: "ok",
          modelCount: loaded.modelCount,
          source: loaded.source,
        };
      }
    }

    // Decide whether to hit the network. Fresh = fetched within the current
    // clock hour, so after a fetch at :58 the next one lands at :00 — the
    // "refresh on the hour" behaviour without needing a scheduler.
    if (!(state.inMemory && sameClockHour(new Date(state.inMemory.fetchedAt), new Date()))) {
      needRefresh = true;
    }
  }
  if (needRefresh) await refreshFromNetwork();
}

/** True when both instants fall inside the same wall-clock hour (UTC).
 *  Deliberately hour-of-day + day granularity, not elapsed-3600s: an
 *  11:59 fetch and a 12:00 fetch are different hours even though they're
 *  60s apart, which is exactly the on-the-hour alignment we want. */
function sameClockHour(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate() && a.getUTCHours() === b.getUTCHours();
}

/** Force a network refresh for every source that needs one, regardless of
 *  TTL. Sources refresh independently (Promise.allSettled) — one failing
 *  never takes down the other. Used by tests + the poller's freshness path. */
export async function refreshFromNetwork(): Promise<void> {
  await Promise.allSettled([refreshSource(openrouter), refreshSource(openference)]);
}

async function refreshSource(state: SourceState): Promise<void> {
  // Per-source freshness gate: a source fetched within the current clock
  // hour is not re-fetched, even when refreshFromNetwork was called for the
  // other source's sake.
  if (state.inMemory && sameClockHour(new Date(state.inMemory.fetchedAt), new Date())) {
    return;
  }
  try {
    // Auth-only source: without a key the fetch is skipped entirely. An
    // unauthenticated openference fetch returns higher (wrong-for-us) rates
    // (plan §0.2), so never attempt it bare.
    if (state.authEnvVar && !process.env[state.authEnvVar]) {
      state.lastStatus = {
        ...state.lastStatus,
        lastFetchStatus: state.inMemory ? "stale" : "empty",
      };
      return;
    }
    const init: RequestInit = {};
    if (state.authEnvVar) {
      init.headers = { Authorization: `Bearer ${process.env[state.authEnvVar]}` };
    }
    const response = await fetch(state.url, init);
    if (!response.ok) {
      log.warn("model-pricing-fetcher", `${state.providerFilter} network fetch failed: HTTP ${response.status}`);
      state.lastStatus = { ...state.lastStatus, lastFetchStatus: "stale" };
      return;
    }
    const json: unknown = await response.json();
    const map = state.parse(json);

    // Schema-drift heuristic: warn if model count dropped > 30% from last fetch.
    if (state.inMemory && state.inMemory.modelCount > 0) {
      const actualRatio = Object.keys(map).length / state.inMemory.modelCount;
      if (actualRatio < 1 - SCHEMA_DRIFT_THRESHOLD) {
        log.warn(
          "model-pricing-fetcher",
          `${state.providerFilter} model count dropped ${((1 - actualRatio) * 100) | 0}% (was ${state.inMemory.modelCount}, now ${Object.keys(map).length}) — possible schema drift`,
        );
      }
    }

    const fetchedAt = new Date().toISOString();
    const modelCount = Object.keys(map).length;
    await writeCacheAtomic(state, { fetchedAt, source: state.url, providerFilter: state.providerFilter, modelCount, models: map });

    state.inMemory = { map, fetchedAt, source: state.url, modelCount };
    state.lastStatus = {
      lastFetchedAt: fetchedAt,
      lastFetchStatus: "ok",
      modelCount,
      source: state.url,
    };
  } catch (err) {
    log.warn("model-pricing-fetcher", `${state.providerFilter} network fetch failed: ${(err as Error).message}`);
    state.lastStatus = {
      ...state.lastStatus,
      lastFetchStatus: state.inMemory ? "stale" : "failed",
    };
  }
}

/** Read a source's disk cache. Returns null on any failure (missing file,
 *  parse error, schema mismatch). Never throws. */
function loadFromDisk(state: SourceState): { map: PricingMap; fetchedAt: string; source: string; modelCount: number } | null {
  try {
    if (!existsSync(state.path)) return null;
    const text = readFileSync(state.path, "utf-8");
    const parsed = JSON.parse(text) as CachedFile;
    if (!parsed || typeof parsed !== "object" || !parsed.models || typeof parsed.models !== "object") {
      log.warn("model-pricing-fetcher", `${state.providerFilter} disk cache at ${state.path} has unexpected shape; ignoring`);
      return null;
    }
    return {
      map: parsed.models,
      fetchedAt: parsed.fetchedAt,
      source: parsed.source,
      modelCount: parsed.modelCount,
    };
  } catch (err) {
    log.warn("model-pricing-fetcher", `${state.providerFilter} disk cache at ${state.path} unreadable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Atomic write: temp file → Bun.write (fsyncs) → rename. A crash between
 * write and rename leaves the target file untouched (previous-good survives).
 *
 * The write + rename are exposed as injectable dependencies so tests can
 * simulate failures (Bun.write throws, rename throws, process kill between).
 * The defaults are the standard bun/node:fs implementations.
 */
async function writeCacheAtomic(state: SourceState, data: CachedFile): Promise<void> {
  mkdirSync(dirname(state.path), { recursive: true });
  const tmpPath = join(dirname(state.path), `${state.filename}.tmp.${process.pid}`);
  try {
    await currentIO.write(tmpPath, JSON.stringify(data, null, 2));
    await currentIO.rename(tmpPath, state.path);
  } catch (err) {
    log.warn("model-pricing-fetcher", `${state.providerFilter} atomic write failed: ${(err as Error).message} (target ${state.path} unchanged)`);
  }
}

/** I/O dependencies for the cache file write. Defaults are the standard
 *  bun/node:fs implementations; tests can swap these out via setIOForTesting(). */
export interface PricingIO {
  write(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
}

let currentIO: PricingIO = {
  write: (path, data) => Bun.write(path, data),
  rename: async (from, to) => { await rename(from, to); },
};

/** Override the I/O dependencies. Tests use this. */
export function setIOForTesting(io: PricingIO): void {
  currentIO = io;
}

/** Override the OpenRouter cache file path (and derive the openference cache
 *  path from the same directory). Tests use this to redirect to a temp dir. */
export function setPricingCachePath(path: string): void {
  openrouter.path = path;
  openrouter.inMemory = null;
  openrouter.lastStatus = emptyStatus(OPENROUTER_URL);
  openference.path = join(dirname(path), OPENFERENCE_CACHE_FILENAME);
  openference.inMemory = null;
  openference.lastStatus = emptyStatus(OPENFERENCE_URL);
}

/** Override the openference cache file path independently of the OpenRouter
 *  one. Tests use this to redirect to a temp dir. */
export function setOpenferencePricingCachePath(path: string): void {
  openference.path = path;
  openference.inMemory = null;
  openference.lastStatus = emptyStatus(OPENFERENCE_URL);
}

/** Reset both in-memory caches and diagnostic state. Tests use this. */
export function resetPricingCache(): void {
  openrouter.inMemory = null;
  openrouter.lastStatus = emptyStatus(OPENROUTER_URL);
  openference.inMemory = null;
  openference.lastStatus = emptyStatus(OPENFERENCE_URL);
}