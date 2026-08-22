import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setPricingCachePath,
  resetPricingCache,
  ensurePricingCacheFresh,
  refreshFromNetwork,
  getModelPricing,
  getPricingCacheStatus,
  setIOForTesting,
  type PricingIO,
} from "../../src/server/model-pricing-fetcher";

const LITELLM_FIXTURE: unknown = {
  sample_spec: "ignored — not an object",
  "claude-opus-4-7": { litellm_provider: "anthropic", input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
  "gpt-5": {
    litellm_provider: "openai",
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1.25e-7,
  },
  "gpt-5.6-luna": {
    litellm_provider: "openai",
    input_cost_per_token: 1e-6,
    output_cost_per_token: 6e-6,
  },
  "gpt-missing-output": { litellm_provider: "openai", input_cost_per_token: 1e-6 },
};

let workDir: string;
let cacheFile: string;
let originalFetch: typeof fetch;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "signal-house-pricing-test-"));
  cacheFile = join(workDir, "model-pricing.json");
  setPricingCachePath(cacheFile);
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetPricingCache();
  setIOForTesting({
    write: (path, data) => Bun.write(path, data),
    rename: async (from, to) => {
      const { rename } = await import("node:fs/promises");
      await rename(from, to);
    },
  });
  rmSync(workDir, { recursive: true, force: true });
});

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function mockFetchThrows(message: string): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

function mockFetchNoNetwork(): typeof fetch {
  return (async () => {
    throw new Error("network unreachable");
  }) as unknown as typeof fetch;
}

describe("model-pricing-fetcher", () => {
  test("cold start: in-memory empty + disk empty → fetcher hits network, parses, writes disk, populates in-memory", async () => {
    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    await ensurePricingCacheFresh();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("ok");
    expect(status.modelCount).toBe(3); // gpt-5 + gpt-5.6-luna + claude-opus-4-7; missing-output skipped
    expect(existsSync(cacheFile)).toBe(true);

    const gpt5 = await getModelPricing("gpt-5");
    expect(gpt5.input).toBe(1.25);
    expect(gpt5.output).toBe(10);
    expect(gpt5.cacheRead).toBe(0.125);
  });

  test("cold start: in-memory empty + disk exists, disk age < 24h → fetcher reads disk only, no network", async () => {
    const fetchedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const cached = {
      fetchedAt,
      source: "https://example.invalid/should-not-be-called",
      providerFilter: "openai",
      modelCount: 1,
      models: {
        "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      },
    };
    writeFileSync(cacheFile, JSON.stringify(cached));

    let networkCalled = false;
    globalThis.fetch = (async () => {
      networkCalled = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await ensurePricingCacheFresh();

    expect(networkCalled).toBe(false);
    const status = getPricingCacheStatus();
    expect(status.lastFetchedAt).toBe(fetchedAt);
    expect(status.modelCount).toBe(1);
    const gpt5 = await getModelPricing("gpt-5");
    expect(gpt5.input).toBe(1.25);
  });

  test("cold start: in-memory empty + disk exists, disk age > 24h → fetcher hits network", async () => {
    const fetchedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    writeFileSync(
      cacheFile,
      JSON.stringify({
        fetchedAt,
        source: "stale",
        providerFilter: "openai",
        modelCount: 1,
        models: { "gpt-stale": { input: 99, output: 99, cacheRead: 99 } },
      }),
    );

    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    await ensurePricingCacheFresh();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("ok");
    expect(status.modelCount).toBe(3);
    // disk cache was rewritten
    const disk = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(disk.modelCount).toBe(3);
  });

  test("ensurePricingCacheFresh: TTL elapsed + network failure + disk exists → status is stale, disk unchanged", async () => {
    // Disk has a 25h-old cache (past TTL). Network is broken.
    // Production path: bootstrap loads in-memory from disk, then TTL check
    // triggers a network refresh that fails. In-memory should stay populated
    // from disk (the user has data; the dashboard shows it), status should
    // reflect "we tried to refresh and failed" rather than "we have nothing".
    const fetchedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const cached = {
      fetchedAt,
      source: "https://example.invalid/seed",
      providerFilter: "openai",
      modelCount: 1,
      models: { "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 } },
    };
    writeFileSync(cacheFile, JSON.stringify(cached));

    globalThis.fetch = mockFetchNoNetwork();

    await ensurePricingCacheFresh();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("stale");
    expect(status.modelCount).toBe(1);
    // Disk cache (previous-good) is unchanged on disk.
    const disk = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(disk.modelCount).toBe(1);
    expect(disk.models["gpt-5"].input).toBe(1.25);
    // The fetcher's public surface (getModelPricing) still works.
    const gpt5 = await getModelPricing("gpt-5");
    expect(gpt5.input).toBe(1.25);
  });

  test("network failure + disk missing → in-memory stays empty, getModelPricing returns zeros", async () => {
    globalThis.fetch = mockFetchNoNetwork();

    await refreshFromNetwork();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("failed");
    expect(status.modelCount).toBe(0);

    const result = await getModelPricing("gpt-5");
    expect(result).toEqual({ input: 0, output: 0, cacheRead: 0 });
  });

  test("atomic write: write fails → disk cache unchanged (previous-good preserved)", async () => {
    // Seed disk with a known-good cache.
    const good = {
      fetchedAt: new Date().toISOString(),
      source: "https://example.invalid/seed",
      providerFilter: "openai",
      modelCount: 1,
      models: { "gpt-5": { input: 9.99, output: 9.99, cacheRead: 9.99 } },
    };
    writeFileSync(cacheFile, JSON.stringify(good));

    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    // Inject an I/O seam where write throws.
    const failingIO: PricingIO = {
      write: async () => {
        throw new Error("disk full");
      },
      rename: async () => {
        throw new Error("should not be called");
      },
    };
    setIOForTesting(failingIO);

    await refreshFromNetwork();

    // The disk cache must still be the previous-good file.
    const disk = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(disk.modelCount).toBe(1);
    expect(disk.models["gpt-5"].input).toBe(9.99);
  });

  test("atomic write: rename fails → temp file orphaned, disk cache unchanged", async () => {
    const good = {
      fetchedAt: new Date().toISOString(),
      source: "https://example.invalid/seed",
      providerFilter: "openai",
      modelCount: 1,
      models: { "gpt-5": { input: 9.99, output: 9.99, cacheRead: 9.99 } },
    };
    writeFileSync(cacheFile, JSON.stringify(good));

    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    // Inject an I/O seam where write succeeds but rename throws.
    let renameCalled = false;
    const failingRenameIO: PricingIO = {
      write: async (path, data) => {
        return Bun.write(path, data);
      },
      rename: async () => {
        renameCalled = true;
        throw new Error("rename failed (locked target)");
      },
    };
    setIOForTesting(failingRenameIO);

    await refreshFromNetwork();

    expect(renameCalled).toBe(true);
    // Disk cache still the previous-good file.
    const disk = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(disk.modelCount).toBe(1);
    expect(disk.models["gpt-5"].input).toBe(9.99);
  });

  test("schema-drift heuristic: completes cleanly when model count drops > 30%", async () => {
    // Seed in-memory with a large cache.
    const seed = {
      fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // > 24h
      source: "https://example.invalid/seed",
      providerFilter: "openai",
      modelCount: 100,
      models: Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [`gpt-fake-${i}`, { input: 1, output: 1, cacheRead: 1 }]),
      ),
    };
    writeFileSync(cacheFile, JSON.stringify(seed));

    // New fetch returns very few entries.
    globalThis.fetch = mockFetch({
      "gpt-5": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
    });

    await refreshFromNetwork();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("ok");
    expect(status.modelCount).toBe(1);
    // (We can't easily assert the warn was logged in bun:test without a log
    // capture; the test exercises the path. The status check above confirms
    // the fetch completed.)
  });

  test("HTTP 500 from litellm → fetcher logs warning, leaves disk cache intact", async () => {
    const good = {
      fetchedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      source: "https://example.invalid/seed",
      providerFilter: "openai",
      modelCount: 1,
      models: { "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 } },
    };
    writeFileSync(cacheFile, JSON.stringify(good));

    globalThis.fetch = mockFetch(undefined, 500);

    await refreshFromNetwork();

    const disk = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(disk.modelCount).toBe(1);
    expect(disk.models["gpt-5"].input).toBe(1.25);
  });

  test("disk cache malformed (bad JSON) → fetcher ignores disk, falls through to network", async () => {
    writeFileSync(cacheFile, "{not json");

    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    await ensurePricingCacheFresh();

    const status = getPricingCacheStatus();
    expect(status.lastFetchStatus).toBe("ok");
    expect(status.modelCount).toBe(3);
  });

  test("disk cache has wrong shape (missing models field) → ignored, falls through to network", async () => {
    writeFileSync(cacheFile, JSON.stringify({ fetchedAt: new Date().toISOString() }));

    globalThis.fetch = mockFetch(LITELLM_FIXTURE);

    await ensurePricingCacheFresh();

    const status = getPricingCacheStatus();
    expect(status.modelCount).toBe(3);
  });
});