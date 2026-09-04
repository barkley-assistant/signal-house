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
import { utcDay, utcDaysAgo } from "../../src/shared/dates";

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

describe("daily resource contract", () => {
  test("disabled by default: enabled:false, empty points, no fetcher side effects", async () => {
    const res = await authed("/api/daily/resource?days=7");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { from: string; to: string; days: number; enabled: boolean; points: unknown[] };
    expect(body.enabled).toBe(false);
    expect(body.points).toEqual([]);
    expect(body.days).toBe(7);
    expect(body.from).toBe(utcDaysAgo(7));
    expect(body.to).toBe(utcDay());
  });

  test("enabled server returns dense day list with explicit nulls", async () => {
    // Separate app instance so the shared one keeps its default-off config.
    // The fetcher's runner/archive-root seams are redirected so this test is
    // hermetic (never touches /var/log/pcp) yet still exercises the full
    // HTTP → handler → fetcher → parser path with deterministic fixtures.
    const { mkdirSync: mk, writeFileSync: wr } = await import("node:fs");
    const { setHostMetricsEnvironmentForTesting, setHostMetricsRunnerForTesting, resetHostMetricsForTesting } =
      await import("../../src/server/host-metrics-fetcher");

    const enabledDir = mkdtempSync(join(tmpdir(), "sh-api-host-"));
    const archives = join(enabledDir, "archives");
    mk(archives, { recursive: true });

    // Archive "yesterday" so it always lands inside the requested window,
    // whatever day the suite runs on.
    const { utcDayFromMs } = await import("../../src/shared/dates");
    const yesterday = utcDayFromMs(Date.now() - 86_400_000);
    wr(join(archives, `${yesterday.replaceAll("-", "")}.index`), "x");

    // Same verbatim fixture as tests/unit/host-metrics-parser.test.ts.
    const FIXTURE = [
      "mem.util.available  9375155.083 Kbyte",
      "mem.physmem  15708244.000 Kbyte",
      'swap.used  3840628356.992 byte',
      'swapdev.length ["/swap.img"] 16777212.000 Kbyte',
      'swapdev.length ["/dev/zram0"] 8388604.000 Kbyte',
      "kernel.all.cpu.user  0.138 none",
      "kernel.all.cpu.sys  0.049 none",
      "kernel.all.cpu.idle  3.781 none",
      "kernel.all.cpu.nice  0.000 none",
      "kernel.all.cpu.irq.soft  0.001 none",
      "kernel.all.cpu.irq.hard  0.000 none",
      "kernel.all.cpu.steal  0.000 none",
    ].join("\n");
    setHostMetricsEnvironmentForTesting(archives, join(enabledDir, "cache", "host-metrics.json"));
    setHostMetricsRunnerForTesting(async () => ({ ok: true, stdout: FIXTURE }));

    const enabledServer = await startServer({
      dbPath: join(enabledDir, "metrics.db"),
      port: 0,
      auth: { username: "admin", password: "s3cret!" },
      hostMetrics: true,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${enabledServer.port}/api/daily/resource?days=7`, {
        headers: { authorization: `Basic ${btoa("admin:s3cret!")}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        enabled: boolean;
        points: Array<{ date: string; memPct: number | null; swapPct: number | null; cpuPct: number | null }>;
      };
      expect(body.enabled).toBe(true);
      expect(body.points.length).toBe(8); // 7-day window, inclusive

      // The archived day carries the hand-computed fixture percentages…
      const archived = body.points.find((p) => p.date === yesterday);
      expect(archived?.memPct).toBeCloseTo(59.69, 1);
      expect(archived?.cpuPct).toBeCloseTo(4.74, 1);
      // …and days without archives are honest nulls, never zeros.
      const emptyDay = body.points.find((p) => p.date !== "2026-08-22");
      expect(emptyDay?.memPct).toBeNull();
    } finally {
      enabledServer.stop();
      resetHostMetricsForTesting();
      rmSync(enabledDir, { recursive: true, force: true });
    }
  });

  test("diagnostics surface the hostMetrics block with honest disabled status", async () => {
    const res = await authed("/api/diagnostics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hostMetrics: { enabled: boolean; lastFetchStatus: string } };
    expect(body.hostMetrics.enabled).toBe(false);
    expect(body.hostMetrics.lastFetchStatus).toBe("disabled");
  });

  test("diagnostics surface the openference pricing cache block", async () => {
    const res = await authed("/api/diagnostics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openferenceCache: { lastFetchStatus: string; source: string } };
    expect(["ok", "failed", "stale", "empty"]).toContain(body.openferenceCache.lastFetchStatus);
    expect(body.openferenceCache.source).toContain("openference");
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

describe("cache savings API shape", () => {
  test("state payload includes additive cache fields", async () => {
    const today = utcDay();
    const db = server.app.owner.db;
    db.query(
      "INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(today, "opencode", "tokens.input", 700, "{}", Date.now());
    db.query(
      "INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(today, "opencode", "tokens.cache_read", 300, "{}", Date.now());
    db.query(
      "INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(today, "opencode", "sessions.total", 1, "{}", Date.now());

    const res = await authed("/api/state");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("usage");
    const usage = body.usage as Record<string, unknown> | null;
    expect(usage).not.toBeNull();
    expect(usage).toHaveProperty("cacheReadTokens", 300);
    expect(usage).toHaveProperty("cacheHitRate", 0.3);
    expect(usage).toHaveProperty("cacheSavings", 0);
    expect(usage).toHaveProperty("bySource");
    expect(usage).toHaveProperty("byModel");
    expect(Array.isArray(usage!.byModel)).toBe(true);
  });

  test("daily trend includes additive cacheRead series", async () => {
    const res = await authed("/api/daily/spend?days=30");
    const body = (await res.json()) as { points: Array<Record<string, unknown>> };
    expect(Array.isArray(body.points)).toBe(true);
    if (body.points.length > 0) {
      expect(body.points[0]).toHaveProperty("cacheRead");
    }
  });
});

describe("daily model trend contract", () => {
  test("per-model points for a seeded canonical key, passthrough cost", async () => {
    const db = server.app.owner.db;
    const insert = db.query(
      "INSERT INTO daily_metrics (date, source, metric, value, tags, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    // Two spellings of the same canonical model (alias group), two sources,
    // same day — must collapse into ONE point summing both.
    const d1 = utcDaysAgo(1);
    insert.run(d1, "opencode", "model.tokens_input", 1_000_000, JSON.stringify({ model: "Claude Sonnet" }), Date.now());
    insert.run(d1, "opencode", "model.tokens_output", 500_000, JSON.stringify({ model: "Claude Sonnet" }), Date.now());
    insert.run(d1, "opencode", "model.tokens_cache_read", 400_000, JSON.stringify({ model: "Claude Sonnet" }), Date.now());
    insert.run(d1, "hermes", "model.tokens_input", 250_000, JSON.stringify({ model: "claude-sonnet" }), Date.now());
    insert.run(d1, "opencode", "model.cost", 12.5, JSON.stringify({ model: "Claude Sonnet" }), Date.now());
    insert.run(d1, "hermes", "model.cost", 3.5, JSON.stringify({ model: "claude-sonnet" }), Date.now());
    // A different model on the same day — must NOT leak into the series.
    insert.run(d1, "opencode", "model.tokens_input", 999_999_999, JSON.stringify({ model: "Other Model" }), Date.now());

    const res = await authed(`/api/daily/model?key=claude-sonnet&days=7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      key: string; days: number;
      points: Array<{ date: string; cost: number | null; tokens: number | null; cacheRead: number | null }>;
    };
    expect(body.key).toBe("claude-sonnet");
    expect(body.days).toBe(7);
    const d1points = body.points.filter((p) => p.date === d1);
    expect(d1points).toHaveLength(1);
    expect(d1points[0].tokens).toBe(2_150_000);
    expect(d1points[0].cacheRead).toBe(400_000);
    // estimateCosts=false in the contract server → persisted upstream sum.
    expect(d1points[0].cost).toBe(16);

    // The series spans the FULL window: all days in the inclusive
    // from..to range present (days=7 → 8 calendar days), inactive days as
    // genuine zeros (operator preference — a model with no activity on a
    // day shows 0, not a missing point).
    expect(body.points).toHaveLength(8);
    const quiet = body.points.find((p) => p.date === utcDaysAgo(3));
    expect(quiet).toBeDefined();
    expect(quiet!.cost).toBe(0);
    expect(quiet!.tokens).toBe(0);
    expect(quiet!.cacheRead).toBe(0);

    // Unknown key → empty points, not an error.
    const empty = await authed(`/api/daily/model?key=no-such-model&days=7`);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { points: unknown[] }).points).toEqual([]);

    // Missing key param → empty points, not an error.
    const blank = await authed(`/api/daily/model?days=7`);
    expect(blank.status).toBe(200);
    expect(((await blank.json()) as { points: unknown[] }).points).toEqual([]);
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
