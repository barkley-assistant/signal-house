/**
 * Host metrics fetcher — daily mem/swap/cpu percentages from local PCP
 * pmlogger archives, with an accumulating disk cache (issue #359).
 *
 * Architecture (mirrors model-pricing-fetcher.ts):
 *   - Source: `pmlogsummary <archive> <metrics…>` over the on-disk archives
 *     in /var/log/pcp/pmlogger/<hostname>/. One invocation reads exactly one
 *     archive (multi-archive merging does not exist — verified 2026-08-23);
 *     at ~80ms per call, one spawn per uncached day per refresh pass is
 *     negligible.
 *   - Accumulating cache: pmlogger rotates daily and keeps only ~2 weeks of
 *     raw archives, so each past day is summarized ONCE and kept forever
 *     (pruned at CACHE_RETENTION_DAYS). Without the accumulation the charts
 *     would silently lose their oldest days as archives evaporate.
 *   - Freshness gate: past days are immutable once computed; today's row is
 *     recomputed whenever the process evaluates outside the wall-clock hour
 *     of its last evaluation (sameUtcHour — same trick as the pricing
 *     fetcher, so refresh timing stays predictable).
 *   - Disk cache: ~/.local/share/signal-house-v2/runtime/.data/host-metrics.json,
 *     atomic write (temp → Bun.write fsync → rename); previous-good survives
 *     any mid-write death.
 *
 * The fetcher NEVER throws. All failures are logged and reflected in the
 * HostMetricsCacheStatus surfaced via diagnostics.
 */

import { existsSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { log } from "../shared/logger";
import { sameUtcHour, utcDayFromMs, utcDayRange, utcDaysAgo } from "../shared/dates";
import {
  HOST_METRIC_NAMES,
  hostResourcePercentages,
  parseHostMetricsSummary,
  type HostResourcePercentages,
} from "./host-metrics-parser";

const CACHE_FILENAME = "host-metrics.json";
/** Keep 120 days: the dashboard's widest window is 90, plus buffer. */
const CACHE_RETENTION_DAYS = 120;

export type HostMetricsStatus = "ok" | "failed" | "stale" | "empty" | "disabled";

export interface HostMetricsCacheStatus {
  lastFetchedAt: string | null;
  lastFetchStatus: HostMetricsStatus;
  /** Days present in the cache. */
  dayCount: number;
  /** Distinct archive days discovered on the last refresh pass. */
  archiveCount: number;
  /** Archive directory being read. */
  source: string;
}

export interface HostMetricsPoint extends HostResourcePercentages {
  date: string;
}

let cachePath = `${process.env.HOME ?? process.env.USERPROFILE}/.local/share/signal-house-v2/runtime/.data/${CACHE_FILENAME}`;

function defaultArchiveRoot(): string {
  return `/var/log/pcp/pmlogger/${hostname()}`;
}

let archiveRoot = defaultArchiveRoot();

interface CachedFile {
  fetchedAt: string;
  days: Record<string, HostResourcePercentages>;
}

let inMemory: { days: Map<string, HostResourcePercentages>; evaluatedAt: string } | null = null;
let lastStatus: HostMetricsCacheStatus = {
  lastFetchedAt: null,
  lastFetchStatus: "empty",
  dayCount: 0,
  archiveCount: 0,
  source: defaultArchiveRoot(),
};

/** Result of one pmlogsummary invocation. Runners never throw — failures
 *  come back as ok:false with whatever stdout was captured. */
export interface SummaryRun {
  ok: boolean;
  stdout: string;
}

export type SummaryRunner = (archive: string, metrics: readonly string[]) => Promise<SummaryRun>;

const defaultRunner: SummaryRunner = async (archive, metrics) => {
  try {
    const proc = Bun.spawn(["pmlogsummary", archive, ...metrics], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    // A non-zero exit with parsed output can still be useful (unknown-metric
    // notes on stderr); callers decide from the parsed content, not this flag.
    return { ok: exitCode === 0, stdout };
  } catch (err) {
    log.warn("host-metrics-fetcher", `pmlogsummary spawn failed: ${(err as Error).message}`);
    return { ok: false, stdout: "" };
  }
};

let currentRunner: SummaryRunner = defaultRunner;

/** Find one archive per UTC day under the archive root. Keys off the
 *  uncompressed `.index` sidecar (present for every archive, compressed or
 *  not) so rotation/compression format changes don't matter. When a day has
 *  several archives (pmlogger restarts), keep the latest by base name —
 *  names are zero-padded YYYYMMDD.HH.MM, so lexicographic = chronological.
 *  Comparing base names (never full paths) keeps the choice independent of
 *  readdir order. */
export function discoverArchiveDays(root: string): Map<string, string> {
  const byDay = new Map<string, string>(); // day → winning base name
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return new Map(); // directory missing/unreadable — treated as "no archives"
  }
  for (const entry of entries) {
    if (!entry.endsWith(".index")) continue;
    const base = entry.slice(0, -".index".length);
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(base);
    if (!m) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    const prev = byDay.get(day);
    if (prev === undefined || base > prev) byDay.set(day, base);
  }
  const out = new Map<string, string>();
  for (const [day, base] of byDay) out.set(day, join(root, base));
  return out;
}

/** Load the disk cache into memory. Returns null on any failure; never throws. */
function loadFromDisk(): { days: Map<string, HostResourcePercentages>; evaluatedAt: string } | null {
  try {
    if (!existsSync(cachePath)) return null;
    const parsed = JSON.parse(readFileSync(cachePath, "utf-8")) as CachedFile;
    if (!parsed || typeof parsed.days !== "object" || parsed.days === null) {
      log.warn("host-metrics-fetcher", `disk cache at ${cachePath} has unexpected shape; ignoring`);
      return null;
    }
    return { days: new Map(Object.entries(parsed.days)), evaluatedAt: parsed.fetchedAt };
  } catch (err) {
    log.warn("host-metrics-fetcher", `disk cache at ${cachePath} unreadable: ${(err as Error).message}`);
    return null;
  }
}

async function writeCacheAtomic(days: Map<string, HostResourcePercentages>, fetchedAt: string): Promise<void> {
  mkdirSync(dirname(cachePath), { recursive: true });
  const tmpPath = join(dirname(cachePath), `${CACHE_FILENAME}.tmp.${process.pid}`);
  const data: CachedFile = { fetchedAt, days: Object.fromEntries(days) };
  try {
    await currentIO.write(tmpPath, JSON.stringify(data));
    await currentIO.rename(tmpPath, cachePath);
  } catch (err) {
    log.warn("host-metrics-fetcher", `atomic write failed: ${(err as Error).message} (target ${cachePath} unchanged)`);
  }
}

export interface HostMetricsIO {
  write(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
}

let currentIO: HostMetricsIO = {
  write: (path, data) => Bun.write(path, data),
  rename: async (from, to) => {
    await rename(from, to);
  },
};

/** Ensure the cache covers every archived day. Cheap no-op within the same
 *  wall-clock hour as the last evaluation; otherwise summarizes only the
 *  days we don't have yet plus today (whose archive is still growing). */
export async function ensureHostMetricsFresh(now: Date = new Date()): Promise<void> {
  if (!inMemory) {
    const loaded = loadFromDisk();
    if (loaded) {
      inMemory = loaded;
      // Hydrate diagnostics from the disk cache immediately — the same-hour
      // freshness gate below may legitimately skip any spawning this hour,
      // and without this the block would read "empty / 0 days" all hour
      // despite serving perfectly good cached data.
      lastStatus = {
        ...lastStatus,
        lastFetchedAt: loaded.evaluatedAt,
        lastFetchStatus: "ok",
        dayCount: loaded.days.size,
      };
    }
  }

  if (inMemory && sameUtcHour(new Date(inMemory.evaluatedAt), now)) return;

  try {
    await refreshFromArchives(now);
  } catch (err) {
    // Belt and braces — refreshFromArchives already catches its own errors.
    log.warn("host-metrics-fetcher", `refresh failed: ${(err as Error).message}`);
    lastStatus = {
      ...lastStatus,
      lastFetchStatus: inMemory && inMemory.days.size > 0 ? "stale" : "failed",
    };
  }
}

async function refreshFromArchives(now: Date): Promise<void> {
  const root = archiveRoot;
  const archives = discoverArchiveDays(root);
  const days = inMemory?.days ?? new Map<string, HostResourcePercentages>();
  const today = utcDayFromMs(now.getTime());
  let mutated = false;
  let spawnFailed = false;

  for (const [day, archive] of archives) {
    const haveImmutable = days.has(day) && day !== today;
    if (haveImmutable) continue;
    const run = await currentRunner(archive, HOST_METRIC_NAMES);
    const summary = parseHostMetricsSummary(run.stdout);
    if (summary.scalars.size === 0 && summary.instances.size === 0) {
      log.warn("host-metrics-fetcher", `no usable metrics from ${archive} (exit ok=${run.ok})`);
      spawnFailed = true;
      continue;
    }
    days.set(day, hostResourcePercentages(summary));
    mutated = true;
  }

  // Prune rows beyond retention so the cache file stays small forever.
  const cutoff = utcDaysAgo(CACHE_RETENTION_DAYS, now);
  for (const key of days.keys()) {
    if (key < cutoff) {
      days.delete(key);
      mutated = true;
    }
  }

  inMemory = { days, evaluatedAt: now.toISOString() };
  if (mutated) await writeCacheAtomic(days, now.toISOString());

  // "ok" means we hold data; a pass where every spawn failed but the cache
  // is warm is "stale", and a cold cache with failed spawns stays "failed".
  lastStatus = {
    lastFetchedAt: now.toISOString(),
    lastFetchStatus: days.size > 0 ? (spawnFailed && !mutated ? "stale" : "ok") : "failed",
    dayCount: days.size,
    archiveCount: archives.size,
    source: root,
  };
}

/** Diagnostics surface for build-state.ts. Read-only. */
export function getHostMetricsStatus(): HostMetricsCacheStatus {
  return lastStatus;
}

/** Dense [from..to] series; days without data carry null percentages
 *  (gaps render honestly, they are never filled with zeros). */
export function getHostMetricsPoints(from: string, to: string): HostMetricsPoint[] {
  const days = inMemory?.days;
  return utcDayRange(from, to).map((date) => {
    const hit = days?.get(date);
    return {
      date,
      memPct: hit?.memPct ?? null,
      swapPct: hit?.swapPct ?? null,
      cpuPct: hit?.cpuPct ?? null,
    };
  });
}

// -- Test seams (same discipline as model-pricing-fetcher) -------------------

/** Redirect the archive root and cache path; resets all state. Tests use this. */
export function setHostMetricsEnvironmentForTesting(root: string, cache: string): void {
  archiveRoot = root;
  cachePath = cache;
  resetHostMetricsForTesting();
}

/** Swap the pmlogsummary runner. Tests use this instead of spawning real PCP. */
export function setHostMetricsRunnerForTesting(runner: SummaryRunner): void {
  currentRunner = runner;
}

/** Restore default I/O dependencies. Tests use this between cases. */
export function setHostMetricsIOForTesting(io?: HostMetricsIO): void {
  currentIO =
    io ?? {
      write: (path, data) => Bun.write(path, data),
      rename: async (from, to) => {
        await rename(from, to);
      },
    };
}

/** Reset in-memory state and diagnostics. Tests use this. */
export function resetHostMetricsForTesting(): void {
  inMemory = null;
  currentRunner = defaultRunner;
  lastStatus = {
    lastFetchedAt: null,
    lastFetchStatus: "empty",
    dayCount: 0,
    archiveCount: 0,
    source: defaultArchiveRoot(),
  };
}
