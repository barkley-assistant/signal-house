/**
 * Web bundle build + static serving.
 *
 * The SPA is built to static files and served through the auth'd fetch
 * handler. Bun's HTML-import bundle objects are only servable via the static
 * routes table, which cannot apply per-request Basic auth — so the web bundle
 * is built to disk (dist/public) instead. Recorded in the traceability doc.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve, normalize } from "node:path";

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
    for (const log of result.logs) process.stderr.write(log.message + "\n");
    throw new Error("web bundle build failed");
  }
}

/** Serve a file from the built web bundle; null when not found. */
export function serveWebAsset(publicDir: string, urlPath: string): Response | null {
  const normalized = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicDir, normalized);
  const root = resolve(publicDir);
  if (filePath !== root && !filePath.startsWith(root + "/")) return null;
  if (!existsSync(filePath)) return null;

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
