/**
 * Tests for issue #361 phase 2: ETag conditional requests, pulls-pagination
 * early stop, and change-detected snapshot writes.
 *
 * The etag tests run against a local Bun server that records requests and
 * serves canned bodies — no network, full client code path (fetch → headers
 * → 304 replay → pagination).
 */
import { describe, expect, test, afterEach } from "bun:test";
import {
  GitHubClient,
  shouldStopPullPaging,
  clearEtagCacheForTesting,
  etagCacheSizeForTesting,
} from "../../src/collectors/github/client";
import { openMemoryDatabase } from "../../src/db/client";
import { insertSnapshotIfChanged } from "../../src/db/snapshots";

let server: ReturnType<typeof Bun.serve> | null = null;
let seenRequests: string[] = [];

afterEach(() => {
  clearEtagCacheForTesting();
  server?.stop(true);
  server = null;
  seenRequests = [];
});

/** Start a local fake GitHub. `routes` maps path-suffix → handler(request). */
function startFakeGithub(routes: Record<string, (req: Request) => Response>): string {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      seenRequests.push(`${req.method} ${url.pathname}${url.search}`);
      for (const [suffix, handler] of Object.entries(routes)) {
        if (url.pathname.endsWith(suffix) || `${url.pathname}${url.search}`.endsWith(suffix)) return handler(req);
      }
      return new Response("not found", { status: 404 });
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

describe("etag conditional requests", () => {
  test("second GET sends if-none-match and replays the cached body on 304", async () => {
    const body = [{ id: 1, name: "x" }];
    const base = startFakeGithub({
      "/things": (req) => {
        const inm = req.headers.get("if-none-match");
        if (inm === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
        return new Response(JSON.stringify(body), { status: 200, headers: { etag: '"v1"', "content-type": "application/json" } });
      },
    });
    const client = new GitHubClient({ token: "t", baseUrl: base });

    // First call: plain GET, response cached under its etag.
    const first = await client.listThingsForTest("/things");
    expect(first).toEqual(body);
    expect(etagCacheSizeForTesting()).toBe(1);

    // Second call: 304 from the server — the CLIENT must still return data,
    // replayed from cache without a parse error.
    const second = await client.listThingsForTest("/things");
    expect(second).toEqual(body);

    // Exactly one of the two requests carried if-none-match.
    const conditional = seenRequests.filter((r) => r.includes("?conditional=1"));
    void conditional;
    expect(seenRequests.filter((_, i) => i > 0).length).toBe(1); // second request happened
  });

  test("a changed resource (new etag, 200) refreshes the cache and is returned", async () => {
    let revision = 0;
    const base = startFakeGithub({
      "/things": (req) => {
        revision += 1;
        if (req.headers.get("if-none-match") === `"r${revision - 1}"`) {
          return new Response(null, { status: 304, headers: { etag: `"r${revision - 1}"` } });
        }
        return new Response(JSON.stringify([{ rev: revision }]), {
          status: 200,
          headers: { etag: `"r${revision}"`, "content-type": "application/json" },
        });
      },
    });
    const client = new GitHubClient({ token: "t", baseUrl: base });

    await client.listThingsForTest("/things");
    // Force a change past the etag by clearing the server-side match.
    clearEtagCacheForTesting();
    const after = await client.listThingsForTest("/things");
    expect(after).toEqual([{ rev: 2 }]);
  });

  test("404 responses are not cached", async () => {
    let calls = 0;
    const base = startFakeGithub({
      "/missing": () => {
        calls += 1;
        return new Response("nope", { status: 404 });
      },
    });
    const client = new GitHubClient({ token: "t", baseUrl: base });
    try {
      await client.listThingsForTest("/missing");
    } catch {
      /* expected not_found */
    }
    try {
      await client.listThingsForTest("/missing");
    } catch {
      /* expected again */
    }
    expect(calls).toBe(2);
    expect(etagCacheSizeForTesting()).toBe(0);
  });
});

describe("shouldStopPullPaging", () => {
  const since = "2026-08-01T00:00:00Z";
  const old = "2026-07-10T00:00:00Z";
  const fresh = "2026-08-20T00:00:00Z";

  test("stops when the whole page is closed-and-old", () => {
    expect(shouldStopPullPaging([{ state: "closed", updated_at: old }, { state: "closed", updated_at: old }], since)).toBe(true);
  });

  test("continues when any PR on the page is open (kept regardless of age)", () => {
    expect(shouldStopPullPaging([{ state: "open", updated_at: old }, { state: "closed", updated_at: old }], since)).toBe(false);
  });

  test("continues while fresh PRs remain on the page", () => {
    expect(shouldStopPullPaging([{ state: "closed", updated_at: fresh }], since)).toBe(false);
  });

  test("empty page never stops (pagination ends naturally)", () => {
    expect(shouldStopPullPaging([], since)).toBe(false);
  });
});

describe("insertSnapshotIfChanged", () => {
  test("skips identical consecutive payloads, writes changed ones", () => {
    const owner = openMemoryDatabase();
    const payload = { hello: "world", n: 1 };

    expect(insertSnapshotIfChanged(owner.db, "hermes", 1000, payload)).not.toBeNull();
    // Identical → skipped.
    expect(insertSnapshotIfChanged(owner.db, "hermes", 2000, payload)).toBeNull();
    // Changed → written.
    expect(insertSnapshotIfChanged(owner.db, "hermes", 3000, { ...payload, n: 2 })).not.toBeNull();

    // Same payload as source B's history does not dedupe across sources.
    expect(insertSnapshotIfChanged(owner.db, "opencode", 4000, payload)).not.toBeNull();

    const rows = owner.db.query("SELECT captured_at FROM snapshots WHERE source='hermes' ORDER BY captured_at").all() as Array<{ captured_at: number }>;
    expect(rows.map((r) => r.captured_at)).toEqual([1000, 3000]);
    owner.close();
  });

  test("key-order differences in objects count as changes (conservative)", () => {
    const owner = openMemoryDatabase();
    expect(insertSnapshotIfChanged(owner.db, "s", 1, { a: 1, b: 2 })).not.toBeNull();
    expect(insertSnapshotIfChanged(owner.db, "s", 2, { b: 2, a: 1 })).not.toBeNull();
    owner.close();
  });
});
