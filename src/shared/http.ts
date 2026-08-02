import type { CollectorId } from "../shared/types";

/**
 * HTTP helpers: JSON responses with the correct content-type, optional gzip,
 * JSON error bodies, and the SPA fallback.
 */

// API JSON responses larger than this get gzip-encoded when the client accepts
// it. Small bodies (health, errors) are not worth the compression cost.
const GZIP_THRESHOLD_BYTES = 1024;

/** Build a JSON response body, gzip-encoding when the client accepts it and
 *  the payload is large enough to pay off. Encoding is decided here so every
 *  caller gets `Cache-Control: no-store` + `Vary` correctness for free. */
function jsonBody(data: unknown): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

function sendBody(req: Request, body: Uint8Array<ArrayBuffer>, headers: Headers): Uint8Array<ArrayBuffer> | null {
  if (body.length >= GZIP_THRESHOLD_BYTES && (req.headers.get("accept-encoding") ?? "").includes("gzip")) {
    headers.set("content-encoding", "gzip");
    headers.set("vary", "accept-encoding");
    // Compress once here so we know the true byte length for Content-Length
    // instead of letting Bun fall back to chunked encoding.
    const gz = Bun.gzipSync(body) as Uint8Array<ArrayBuffer>;
    headers.set("content-length", String(gz.length));
    return gz;
  }
  headers.set("content-length", String(body.length));
  return null;
}

export function json(req: Request, data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  const body = jsonBody(data);
  const gz = sendBody(req, body, headers);
  return new Response(gz ?? body, { ...init, headers });
}

export function jsonError(req: Request, status: number, message: string, extra?: Record<string, unknown>): Response {
  return json(req, { error: message, ...extra }, { status });
}

export function notFound(req: Request): Response {
  return jsonError(req, 404, "Not Found");
}

export function methodNotAllowed(allowed: string): Response {
  return new Response(null, { status: 405, headers: { allow: allowed } });
}

/** Index an array of collector results by source id. */
export function indexBySource<T extends { source: CollectorId }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const it of items) out[it.source] = it;
  return out;
}
