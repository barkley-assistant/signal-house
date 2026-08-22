/**
 * Litellm pricing fetcher — daily refresh with disk cache + atomic write.
 *
 * Architecture:
 *   - In-memory cache: process-lifetime map of machine key → per-1M rates.
 *     Populated on first call from disk; refreshed in-place on every network fetch.
 *   - Disk cache: ~/.local/share/signal-house-v2/runtime/.data/model-pricing.json
 *     Written atomically (temp file → Bun.write fsync → rename) so a process
 *     kill mid-write never corrupts the cache. The previous-good version survives.
 *   - Network fetch: litellm's model_prices_and_context_window.json, filtered
 *     to openai by the parser. Refreshed at most every 24h.
 *   - Failure modes (every one preserves the previous-good cache):
 *       - fetch fails AND disk cache exists   → use disk cache, log warning
 *       - fetch fails AND disk cache missing  → in-memory stays empty,
 *                                                getModelPricing returns zeros,
 *                                                diagnostics surfaces "unavailable"
 *       - Bun.write fails                     → temp file written, rename never happens,
 *                                                disk cache unchanged
 *       - rename fails                         → temp file orphaned, disk cache unchanged
 *       - process killed between write & rename → temp file orphaned, disk cache unchanged
 *
 * The fetcher NEVER throws. All errors are logged + reflected in the
 * PricingCacheStatus surfaced via diagnostics.
 *
 * Plan ref: docs/plans/model-pricing-estimator.md §A (Pricing fetcher),
 * §D.1 (Atomic write discipline).
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { log } from "../shared/logger";
import { parseLitellmPricing, type PricingMap } from "../shared/model-pricing-parser";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_FILENAME = "model-pricing.json";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SCHEMA_DRIFT_THRESHOLD = 0.3; // warn if model count drops > 30%

export type FetchStatus = "ok" | "failed" | "stale" | "empty";

export interface PricingCacheStatus {
  lastFetchedAt: string | null;
  lastFetchStatus: FetchStatus;
  modelCount: number;
  source: string;
}

let cachePath = `${process.env.HOME ?? process.env.USERPROFILE}/.local/share/signal-house-v2/runtime/.data/${CACHE_FILENAME}`;

interface CachedFile {
  fetchedAt: string;
  source: string;
  providerFilter: string;
  modelCount: number;
  models: PricingMap;
}

let inMemory: { map: PricingMap; fetchedAt: string; source: string; modelCount: number } | null = null;
let lastStatus: PricingCacheStatus = {
  lastFetchedAt: null,
  lastFetchStatus: "empty",
  modelCount: 0,
  source: LITELLM_URL,
};

/**
 * Look up per-1M-token rates for a model.
 * Returns the in-memory cache entry, or zero rates if unknown / cache empty.
 */
export async function getModelPricing(model: string): Promise<{ input: number; output: number; cacheRead: number }> {
  await ensurePricingCacheFresh();
  if (!inMemory) return { input: 0, output: 0, cacheRead: 0 };
  // Import lazily to avoid a cycle (models.ts is in shared/, but we want to keep
  // this module light). The resolver (model-pricing.ts) wraps this + the local
  // fallback; callers should use the resolver, not this directly.
  const { machineKey } = await import("../shared/models");
  const key = machineKey(model);
  if (!key) return { input: 0, output: 0, cacheRead: 0 };
  const entry = inMemory.map[key];
  if (!entry) return { input: 0, output: 0, cacheRead: 0 };
  return entry;
}

/** Diagnostics surface for build-state.ts. Read-only. */
export function getPricingCacheStatus(): PricingCacheStatus {
  return lastStatus;
}

/**
 * Sync snapshot of the in-memory cache, exposed as a flat Map for the
 * aggregator and the daily-trend query. Empty when the cache hasn't been
 * populated yet. Keys are machine-keyed (lowercase, dots stripped, date
 * suffixes stripped — same shape as the resolver uses).
 *
 * Returns a NEW Map (the in-memory cache isn't aliased out). The aggregator
 * never mutates this; we hand it a snapshot once per buildState call so
 * the daily-trend query and the by-model rollup read identical rates.
 */
export function getPricingMapSnapshot(): Map<string, { input: number; output: number; cacheRead: number }> {
  if (!inMemory) return new Map();
  const out = new Map<string, { input: number; output: number; cacheRead: number }>();
  for (const [k, v] of Object.entries(inMemory.map)) {
    out.set(k, { input: v.input, output: v.output, cacheRead: v.cacheRead });
  }
  return out;
}

/**
 * Ensure the in-memory cache is loaded. If the disk cache is missing or older
 * than TTL, attempt a network refresh. Non-blocking on failure — falls back
 * to whatever the disk has, or stays empty.
 */
export async function ensurePricingCacheFresh(): Promise<void> {
  // First call in this process: load from disk.
  if (!inMemory) {
    const loaded = loadFromDisk();
    if (loaded) {
      inMemory = loaded;
      lastStatus = {
        lastFetchedAt: loaded.fetchedAt,
        lastFetchStatus: "ok",
        modelCount: loaded.modelCount,
        source: loaded.source,
      };
    }
  }

  // Decide whether to hit the network.
  if (inMemory && Date.now() - new Date(inMemory.fetchedAt).getTime() < TTL_MS) {
    return; // fresh enough
  }

  await refreshFromNetwork();
}

/** Force a network fetch regardless of TTL. Used by tests + the deploy-day
 *  sanity step in the verification plan. */
export async function refreshFromNetwork(): Promise<void> {
  try {
    const response = await fetch(LITELLM_URL);
    if (!response.ok) {
      log.warn("model-pricing-fetcher", `network fetch failed: HTTP ${response.status}`);
      lastStatus = { ...lastStatus, lastFetchStatus: "stale" };
      return;
    }
    const json: unknown = await response.json();
    const map = parseLitellmPricing(json);

    // Schema-drift heuristic: warn if model count dropped > 30% from last fetch.
    if (inMemory && inMemory.modelCount > 0) {
      const actualRatio = Object.keys(map).length / inMemory.modelCount;
      if (actualRatio < 1 - SCHEMA_DRIFT_THRESHOLD) {
        log.warn(
          "model-pricing-fetcher",
          `model count dropped ${((1 - actualRatio) * 100) | 0}% (was ${inMemory.modelCount}, now ${Object.keys(map).length}) — possible schema drift in litellm`,
        );
      }
    }

    const fetchedAt = new Date().toISOString();
    const modelCount = Object.keys(map).length;
    await writeCacheAtomic({ fetchedAt, source: LITELLM_URL, providerFilter: "openai", modelCount, models: map });

    inMemory = { map, fetchedAt, source: LITELLM_URL, modelCount };
    lastStatus = {
      lastFetchedAt: fetchedAt,
      lastFetchStatus: "ok",
      modelCount,
      source: LITELLM_URL,
    };
  } catch (err) {
    log.warn("model-pricing-fetcher", `network fetch failed: ${(err as Error).message}`);
    lastStatus = {
      ...lastStatus,
      lastFetchStatus: inMemory ? "stale" : "failed",
    };
  }
}

/** Read the disk cache. Returns null on any failure (missing file,
 *  parse error, schema mismatch). Never throws. */
function loadFromDisk(): { map: PricingMap; fetchedAt: string; source: string; modelCount: number } | null {
  try {
    if (!existsSync(cachePath)) return null;
    const text = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(text) as CachedFile;
    if (!parsed || typeof parsed !== "object" || !parsed.models || typeof parsed.models !== "object") {
      log.warn("model-pricing-fetcher", `disk cache at ${cachePath} has unexpected shape; ignoring`);
      return null;
    }
    return {
      map: parsed.models,
      fetchedAt: parsed.fetchedAt,
      source: parsed.source,
      modelCount: parsed.modelCount,
    };
  } catch (err) {
    log.warn("model-pricing-fetcher", `disk cache at ${cachePath} unreadable: ${(err as Error).message}`);
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
async function writeCacheAtomic(data: CachedFile): Promise<void> {
  mkdirSync(dirname(cachePath), { recursive: true });
  const tmpPath = join(dirname(cachePath), `${CACHE_FILENAME}.tmp.${process.pid}`);
  try {
    await currentIO.write(tmpPath, JSON.stringify(data, null, 2));
    await currentIO.rename(tmpPath, cachePath);
  } catch (err) {
    log.warn("model-pricing-fetcher", `atomic write failed: ${(err as Error).message} (target ${cachePath} unchanged)`);
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

/** Override the cache file path. Tests use this to redirect to a temp dir. */
export function setPricingCachePath(path: string): void {
  cachePath = path;
  inMemory = null;
  lastStatus = {
    lastFetchedAt: null,
    lastFetchStatus: "empty",
    modelCount: 0,
    source: LITELLM_URL,
  };
}

/** Reset the in-memory cache and diagnostic state. Tests use this. */
export function resetPricingCache(): void {
  inMemory = null;
  lastStatus = {
    lastFetchedAt: null,
    lastFetchStatus: "empty",
    modelCount: 0,
    source: LITELLM_URL,
  };
}