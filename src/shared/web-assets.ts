/**
 * Web bundle build + static serving.
 *
 * The SPA is built to static files and served through the auth'd fetch
 * handler. Bun's HTML-import bundle objects are only servable via the static
 * routes table, which cannot apply per-request Basic auth — so the web bundle
 * is built to disk (dist/public) instead. Recorded in the traceability doc.
 */

import { existsSync, mkdirSync, cpSync, readdirSync, rmSync } from "node:fs";
import { resolve, normalize, join, relative } from "node:path";

/** Every file under `dir` as absolute paths. Throws when `dir` is absent —
 *  callers decide whether a missing directory is an error or an empty set. */
function walkFiles(dir: string): string[] {
  const files: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Build the SPA to `publicDir` (dist/public). Idempotent. */
export async function buildWebBundle(publicDir: string): Promise<void> {
  const root = resolve(import.meta.dir, "..", "..");
  // Hashed names change every build, so writing alone never removed the
  // previous build's output — 351 of 353 chunks were unreachable from
  // index.html (385 MB) after seven weeks of builds. Snapshot the directory
  // first and delete the difference once the new build has landed: clearing
  // it up front would open a window where a running server cannot serve
  // files it has already indexed.
  const previous = existsSync(publicDir) ? walkFiles(publicDir) : [];
  mkdirSync(publicDir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, "src/web/index.html")],
    outdir: publicDir,
    minify: true,
    target: "browser",
  });
  if (!result.success) {
    for (const logLine of result.logs) process.stderr.write(logLine.message + "\n");
    throw new Error("web bundle build failed");
  }
  // Static PWA files (manifest, service worker, offline fallback, icons)
  // ship verbatim — no hashing, so the service worker can manage them by
  // stable path. cpSync overwrites; directory merge keeps icons/ nested.
  const publicSrc = resolve(root, "src/web/public");
  if (existsSync(publicSrc)) cpSync(publicSrc, publicDir, { recursive: true });
  // Sweep whatever this build did not produce. Diffing against a post-build
  // listing would compare the directory with itself — those old files are
  // still sitting in it — so index what was actually written instead: Bun's
  // own outputs plus the verbatim PWA files copied above. Hashed chunks are
  // cache-first on demand in sw.js and nothing precaches them by name, so
  // dropping them cannot break boot.
  const produced = new Set<string>(result.outputs.map((output) => output.path));
  if (existsSync(publicSrc)) {
    for (const src of walkFiles(publicSrc)) produced.add(join(publicDir, relative(publicSrc, src)));
  }
  // If the shell itself is unaccounted for the accounting is wrong, and
  // sweeping would delete the site — skip it and leave the stale files.
  if (produced.has(join(publicDir, "index.html"))) {
    for (const file of previous) {
      if (!produced.has(file)) rmSync(file, { force: true });
    }
  }
  // Surface warnings (side-effect-only imports, oversized chunks, etc.) so
  // they don't silently disappear from build output.
  for (const logLine of result.logs) {
    if (logLine.level === "warning") process.stderr.write(`[bun.build] ${logLine.message}\n`);
  }
  // New build → the in-memory asset index is out of date (hashed filenames
  // change). Rebuild it so dev servers and long-lived processes pick up the
  // new files without a restart.
  assetIndex = null;
}

// The built SPA is a fixed, small set of content-hashed files rebuilt on
// save. Rather than stat()ing the filesystem on every request, we keep an
// in-memory set of the known files and look up against it. `setIndex` walks
// the dir once at startup; buildWebBundle repopulates it after each build.
let assetIndex: Set<string> | null = null;

function setIndex(publicDir: string): Set<string> {
  if (assetIndex) return assetIndex;
  let files: string[];
  try {
    files = walkFiles(publicDir);
  } catch {
    return new Set(); // directory missing — no assets known yet (uncached:
    // a build that lands later must be able to re-walk)
  }
  assetIndex = new Set(files);
  return assetIndex;
}

/** Serve a file from the built web bundle; null when not found. */
export function serveWebAsset(publicDir: string, urlPath: string): Response | null {
  const normalized = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicDir, normalized);
  const root = resolve(publicDir);
  if (filePath !== root && !filePath.startsWith(root + "/")) return null;
  if (filePath === root) return null;

  const index = setIndex(publicDir);
  if (!index.has(filePath)) {
    // The manifest is snapshotted at startup and only re-walked by an
    // in-process build. Dev rebuilds run in a SUBPROCESS (scripts/dev.ts),
    // so their bundles land on disk without touching our index. Heal by
    // stat-ing the filesystem on a miss and remembering the hit — this keeps
    // new hashed chunks servable without a full re-walk on every request.
    if (!existsSync(filePath)) return null;
    index.add(filePath);
  }

  const ext = filePath.slice(filePath.lastIndexOf("."));
  const body = Bun.file(filePath);
  // Service workers must revalidate on every fetch: browsers cap SW script
  // caching at 24h, but an immutable header would pin an old worker for a
  // year — new deploys would never reach installed clients. Same for the
  // manifest (name/icons/theme changes should propagate promptly).
  const noCache = ext === ".html" || filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest");
  return new Response(body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": noCache ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

export function publicDirFor(root: string): string {
  return resolve(root, "dist/public");
}
