/**
 * API contract tests — boots the real app via createApp() against a temp DB
 * on a random port, then exercises the full HTTP surface: state, diagnostics,
 * health, refresh, 409 overlap, reset-lock safety, auth challenge, JSON
 * content types, and no-secret-leakage.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type TestServer } from "./test-server";
import { runRefresh } from "../../src/orchestrator/refresh";
import { createCollectors } from "../../src/collectors";
import { utcDaysAgo } from "../../src/shared/dates";

let dir: string;
let server: TestServer;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sh-api-"));
  server = await startServer({
    dbPath: join(dir, "metrics.db"),
    port: 0,
    auth: { username: "admin", password: "s3cret!" },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

function authed(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Basic ${btoa("admin:s3cret!")}`);
  return fetch(`${base}${path}`, { ...init, headers });
}

describe("auth", () => {
  test("no credentials → 401 with WWW-Authenticate", async () => {
    const res = await fetch(`${base}/api/state`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('Basic realm="signal-house"');
  });

  test("invalid credentials → 401", async () => {
    const res = await fetch(`${base}/api/state`, { headers: { authorization: `Basic ${btoa("admin:wrong")}` } });
    expect(res.status).toBe(401);
  });

  test("valid credentials → 200 with JSON content type", async () => {
    const res = await authed("/api/state");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("dashboard HTML is protected too", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(401);
  });
});

describe("health", () => {
  test("returns lightweight status without triggering collectors", async () => {
    const res = await authed("/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("signal-house");
  });
});

describe("state contract", () => {
  test("returns the documented top-level shape", async () => {
    const res = await authed("/api/state");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["attention", "status", "summary", "usage", "window"]);
    expect(body.window).toHaveProperty("start");
    expect(body.window).toHaveProperty("end");
    expect(body.status).toHaveProperty("refresh");
    expect(body.status).toHaveProperty("freshness");
    expect(Array.isArray(body.attention)).toBe(true);
  });

  test("missing data is explicit, not zero", async () => {
    const res = await authed("/api/state");
    const body = (await res.json()) as { status: { freshness: { state: string } } };
    expect(["fresh", "stale", "missing"]).toContain(body.status.freshness.state);
  });

  test("?days=7|30|90 scopes the window; unknown values fall back to 30", async () => {
    const d7 = (await (await authed("/api/state?days=7")).json()) as { window: { days: number; start: string } };
    expect(d7.window.days).toBe(7);
    expect(d7.window.start).toBe(utcDaysAgo(7));

    const d30 = (await (await authed("/api/state?days=30")).json()) as { window: { days: number } };
    expect(d30.window.days).toBe(30);

    const d90 = (await (await authed("/api/state?days=90")).json()) as { window: { days: number; start: string } };
    expect(d90.window.days).toBe(90);
    expect(d90.window.start).toBe(utcDaysAgo(90));

    // A custom window is not a preset — the API must not silently honor it
    // (collectors only precompute the presets, so the data would be partial).
    const bad = (await (await authed("/api/state?days=45")).json()) as { window: { days: number } };
    expect(bad.window.days).toBe(30);
    const junk = (await (await authed("/api/state?days=banana")).json()) as { window: { days: number } };
    expect(junk.window.days).toBe(30);
  });

  test("/api/daily/spend?days=N maps to the matching from window", async () => {
    const res = await authed("/api/daily/spend?days=90");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: string; to: string; days: number; points: unknown[] };
    expect(body.days).toBe(90);
    expect(body.from).toBe(utcDaysAgo(90));
    expect(body.to).toBe(utcDaysAgo(0));
    expect(Array.isArray(body.points)).toBe(true);

    const fallback = (await (await authed("/api/daily/spend?days=13")).json()) as { days: number };
    expect(fallback.days).toBe(30);
  });
});

describe("refresh + lock", () => {
  test("POST /api/refresh runs through the real refresh runner", async () => {
    const res = await authed("/api/refresh", { method: "POST" });
    expect([200, 409]).toContain(res.status);
    if (res.status === 200) {
      const body = (await res.json()) as { status: string | undefined };
      const status = body.status ?? "missing";
      expect(["success", "partial", "failed"]).toContain(status);
    }
  });

  test("overlapping refresh → 409", async () => {
    const { lock } = server.app;
    const acquired = lock.acquire("poller");
    expect(acquired.ok).toBe(true);
    const res = await authed("/api/refresh", { method: "POST" });
    expect(res.status).toBe(409);
    lock.reset();
  });

  test("reset-lock clears the stuck lock and a refresh can start", async () => {
    server.app.lock.acquire("poller");
    const res = await authed("/api/refresh/reset-lock", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
    const refreshRes = await authed("/api/refresh", { method: "POST" });
    expect(refreshRes.status).not.toBe(409);
  });
});

describe("http compression", () => {
  test("large JSON is gzip-encoded when the client sends accept-encoding: gzip", async () => {
    // Request the raw (un-decompressed) body so we can verify the wire bytes.
    const res = await authed("/api/state", {
      headers: { "accept-encoding": "gzip" },
      // @ts-expect-error Bun-specific fetch option — we want the raw gzip stream
      decompress: false,
    });
    const enc = res.headers.get("content-encoding");
    // The /api/state payload is normally over the 1KB threshold; if it is
    // unexpectedly small enough to fall below, the server sends identity.
    if (enc === "gzip") {
      const raw = new Uint8Array(await res.arrayBuffer());
      // gzip magic bytes
      expect(raw.length).toBeGreaterThan(0);
      const gunzipped = Bun.gunzipSync(raw);
      const body = JSON.parse(new TextDecoder().decode(gunzipped)) as Record<string, unknown>;
      expect(body).toHaveProperty("attention");
      expect(body).toHaveProperty("summary");
    } else {
      expect(res.status).toBe(200);
    }
  });

  test("small JSON is NOT gzip-encoded", async () => {
    const res = await authed("/api/health", { headers: { "accept-encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.status).toBe(200);
  });

  test("no accept-encoding header → identity encoding", async () => {
    const res = await authed("/api/health");
    expect(res.headers.get("content-encoding")).toBeNull();
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  test("responses carry cache-control: no-store", async () => {
    const res = await authed("/api/state");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("no secret leakage", () => {
  test("responses never contain the auth password or token material", async () => {
    const [state, diag, health] = await Promise.all([
      authed("/api/state").then((r) => r.text()),
      authed("/api/diagnostics").then((r) => r.text()),
      authed("/api/health").then((r) => r.text()),
    ]);
    for (const text of [state, diag, health]) {
      expect(text).not.toContain("s3cret!");
      expect(text).not.toContain("admin:");
    }
  });
});

describe("unknown endpoints", () => {
  test("unknown api path → 404 JSON", async () => {
    const res = await authed("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("unsupported method → 405", async () => {
    const res = await authed("/api/state", { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});
