/**
 * Lightweight HTTP Basic auth (LAN protection, not user management).
 *
 * Constant-time credential comparison, correct WWW-Authenticate header,
 * no credentials ever in responses/bundles/logs. Health endpoint is protected
 * too — no documented deployment requirement demands an unauthenticated probe.
 */

import type { RuntimeConfig } from "../config/types";

export function authEnabled(config: RuntimeConfig): boolean {
  return config.auth.enabled;
}

/** Constant-time UTF-8 comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function checkBasicAuth(req: Request, config: RuntimeConfig): boolean {
  if (!authEnabled(config)) return true;
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return timingSafeEqual(user, config.auth.username) && timingSafeEqual(pass, config.auth.password);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "www-authenticate": 'Basic realm="signal-house"',
    },
  });
}

/** Wrap a handler with the auth gate (applied to every route when enabled). */
export function withAuth(handler: (req: Request) => Response | Promise<Response>, config: RuntimeConfig): (req: Request) => Response | Promise<Response> {
  return (req) => (checkBasicAuth(req, config) ? handler(req) : unauthorized());
}
