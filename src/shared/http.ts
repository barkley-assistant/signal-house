import type { CollectorId } from "../shared/types";

/**
 * HTTP helpers: JSON responses with the correct content-type, JSON error
 * bodies, and the SPA fallback.
 */

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, { status });
}

export function notFound(): Response {
  return jsonError(404, "Not Found");
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
