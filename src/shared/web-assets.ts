/**
 * Web bundle build + static serving.
 *
 * The SPA is built to static files and served through the auth'd fetch
 * handler. Bun's HTML-import bundle objects are only servable via the static
 * routes table, which cannot apply per-request Basic auth — so the web bundle
 * is built to disk (dist/public) instead. Recorded in the traceability doc.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, normalize, join } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** Build the SPA to `publicDir` (dist/public). Idempotent. */
export async function buildWebBundle(publicDir: string): Promise<void> {
  const root = resolve(import.meta.dir, "..", "..");
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
  const index = new Set<string>();
  const stack = [publicDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return new Set(); // directory missing — no assets known yet
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else index.add(full);
    }
  }
  assetIndex = index;
  return index;
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
  return new Response(body, {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    },
  });
}

export function publicDirFor(root: string): string {
  return resolve(root, "dist/public");
}
