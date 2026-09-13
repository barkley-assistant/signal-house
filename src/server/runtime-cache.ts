/**
 * Shared disk-cache machinery for the runtime fetchers (model pricing +
 * host metrics): the atomic-write discipline and the never-throws disk load.
 *
 * Atomic write: temp file (pid suffix) → Bun.write (fsyncs) → rename. A
 * crash between write and rename leaves the target file untouched
 * (previous-good survives).
 *
 * Disk load: any failure (missing file, parse error, schema mismatch)
 * returns null — never throws. The fetcher decides what to do with null.
 *
 * Each fetcher keeps its own module-level `currentIO` + test seam so tests
 * can simulate failures (write throws, rename throws, process kill between);
 * the defaults come from here so the two implementations can't drift.
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { rename as fsRename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { log } from "../shared/logger";

export interface CacheIO {
  write(path: string, data: string): Promise<unknown>;
  rename(from: string, to: string): Promise<void>;
}

/** Standard bun/node:fs implementations. Tests swap these out per-fetcher
 *  via the fetcher's own test seam. */
export const defaultCacheIO: CacheIO = {
  write: (path, data) => Bun.write(path, data),
  rename: async (from, to) => {
    await fsRename(from, to);
  },
};

/** Write `payload` as JSON to `path` atomically. On failure the target file
 *  is unchanged; the error is logged under `label` and swallowed (fetchers
 *  never throw). */
export async function writeJsonAtomic(path: string, payload: unknown, io: CacheIO, label: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `${basename(path)}.tmp.${process.pid}`);
  try {
    await io.write(tmpPath, JSON.stringify(payload));
    await io.rename(tmpPath, path);
  } catch (err) {
    log.warn(label, `atomic write failed: ${(err as Error).message} (target ${path} unchanged)`);
  }
}

/** Read + validate a JSON cache file. Returns null on any failure (missing
 *  file, parse error, schema mismatch) — never throws. `validate` is the
 *  cache-file shape guard; a payload that fails it is ignored, not used. */
export function readJsonFromDisk<T>(path: string, label: string, validate: (parsed: unknown) => parsed is T): T | null {
  try {
    if (!existsSync(path)) return null;
    const text = readFileSync(path, "utf-8");
    const parsed = JSON.parse(text) as unknown;
    if (!validate(parsed)) {
      log.warn(label, `disk cache at ${path} has unexpected shape; ignoring`);
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn(label, `disk cache at ${path} unreadable: ${(err as Error).message}`);
    return null;
  }
}