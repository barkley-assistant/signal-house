import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  setPricingCachePath,
  resetPricingCache,
  setIOForTesting,
} from "../../src/server/model-pricing-fetcher";
import { setCostConfigPath, resetCostConfigCache } from "../../src/server/cost-input";
import { getModelPricing as resolveModelPricing, fetchAllRates } from "../../src/server/model-pricing";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "signal-house-resolver-test-"));
  setPricingCachePath(join(workDir, "model-pricing.json"));
  setCostConfigPath(join(workDir, "opencode.jsonc"));
  resetPricingCache();
});

afterEach(() => {
  resetCostConfigCache();
  setIOForTesting({
    write: (path, data) => Bun.write(path, data),
    rename: async (from, to) => {
      const { rename } = await import("node:fs/promises");
      await rename(from, to);
    },
  });
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Seed the fetcher's in-memory cache by writing a valid cache file AND
 * loading it. The fetcher populates in-memory only on the first call,
 * so we trigger that via getModelPricingFromCache() before the resolver
 * test runs.
 */
async function seedPricingCache(models: Record<string, { input: number; output: number; cacheRead: number }>) {
  const cachePath = join(workDir, "model-pricing.json");
  writeFileSync(
    cachePath,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: "https://test/seed",
      providerFilter: "openai",
      modelCount: Object.keys(models).length,
      models,
    }),
  );
  // Trigger fetcher to load from disk by calling its getModelPricing.
  const { getModelPricing: fetcherGet } = await import("../../src/server/model-pricing-fetcher");
  await fetcherGet("__warmup__");
}

describe("model-pricing resolver", () => {
  test("cache hit returns cached rates as-is", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const rates = await resolveModelPricing("gpt-5");
    expect(rates.input).toBe(1.25);
    expect(rates.output).toBe(10);
    expect(rates.cacheRead).toBe(0.125);
  });

  test("cache hit takes precedence over local opencode.jsonc rates", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });
    // Local has a higher (stale, wrong) input rate. Resolver should
    // still prefer the cache.
    writeFileSync(
      join(workDir, "opencode.jsonc"),
      JSON.stringify({
        models: {
          "GPT-5": { cost: { input: 999, cache_read: 999 } },
        },
      }),
    );
    resetCostConfigCache();

    const rates = await resolveModelPricing("gpt-5");
    expect(rates.input).toBe(1.25);
  });

  test("cache miss + local hit → falls back to local, output defaults to input × 4", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      // "deepseek-v4-pro" intentionally NOT in cache
    });
    writeFileSync(
      join(workDir, "opencode.jsonc"),
      JSON.stringify({
        models: {
          "DeepSeek-V4-Pro": { cost: { input: 0.35, cache_read: 0.07 } },
        },
      }),
    );
    resetCostConfigCache();

    const rates = await resolveModelPricing("deepseek-v4-pro");
    expect(rates.input).toBe(0.35);
    expect(rates.output).toBe(1.4); // 0.35 × 4 (locked decision #7)
    expect(rates.cacheRead).toBe(0.07);
  });

  test("cache miss + local miss → returns all zeros", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const rates = await resolveModelPricing("mystery-model");
    expect(rates).toEqual({ input: 0, output: 0, cacheRead: 0 });
  });

  test("machineKey normalisation: GPT 5.6 Luna and gpt-5.6-luna resolve to same entry", async () => {
    await seedPricingCache({
      "gpt-56-luna": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const upper = await resolveModelPricing("GPT 5.6 Luna");
    const lower = await resolveModelPricing("gpt-5.6-luna");
    expect(upper).toEqual(lower);
    expect(upper.input).toBe(1.25);
  });

  test("date-snapshot suffix stripping: gpt-5.6-luna-20250815 resolves as gpt-5.6-luna", async () => {
    await seedPricingCache({
      "gpt-56-luna": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const dated = await resolveModelPricing("gpt-5.6-luna-20250815");
    expect(dated.input).toBe(1.25);
    expect(dated.output).toBe(10);
  });

  test("empty / malformed model name → returns zeros (no throw)", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    expect((await resolveModelPricing("")).input).toBe(0);
    expect((await resolveModelPricing("/")).input).toBe(0);
    expect((await resolveModelPricing("   ")).input).toBe(0);
  });

  test("non-finite cached rates (parser skip) → falls through to local", async () => {
    // The parser skips non-finite rates, so this model isn't in the cache.
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      // "broken-model" omitted because the parser would skip it
    });
    writeFileSync(
      join(workDir, "opencode.jsonc"),
      JSON.stringify({
        models: {
          "Broken-Model": { cost: { input: 2.0, cache_read: 0.5 } },
        },
      }),
    );
    resetCostConfigCache();

    const rates = await resolveModelPricing("broken-model");
    expect(rates.input).toBe(2.0);
    expect(rates.output).toBe(8.0);
    expect(rates.cacheRead).toBe(0.5);
  });

  test("local hit: cache_read=0 still produces a non-empty result (input×4 default)", async () => {
    // opencode.jsonc has input but no cache_read. Locked decision #2 says
    // cache_read falls back to input when missing — but that rule is for the
    // cache parser. For the local source, getCacheReadCostPerMillion
    // returns 0 when the field is absent. The resolver should still report
    // the input/output rates.
    await seedPricingCache({}); // no cached entries
    writeFileSync(
      join(workDir, "opencode.jsonc"),
      JSON.stringify({
        models: {
          "Custom-Model": { cost: { input: 1.0 } }, // no cache_read
        },
      }),
    );
    resetCostConfigCache();

    const rates = await resolveModelPricing("custom-model");
    expect(rates.input).toBe(1.0);
    expect(rates.output).toBe(4.0); // 1.0 × 4
    expect(rates.cacheRead).toBe(0); // not present in source
  });
});

describe("fetchAllRates", () => {
  test("returns a map keyed by machine key, dedupes by key", async () => {
    await seedPricingCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      "deepseek-v4-pro": { input: 0.35, output: 1.4, cacheRead: 0.07 },
    });

    const rates = await fetchAllRates([
      "GPT-5", // → "gpt-5"
      "gpt-5", // dedupe
      "deepseek-v4-pro",
      "DeepSeek-V4-Pro", // → "deepseek-v4-pro" — dedupe with above
      "mystery-model", // → zero rates
    ]);
    expect(rates.size).toBe(3); // gpt-5, deepseek-v4-pro, mystery-model
    expect(rates.get("gpt-5")?.input).toBe(1.25);
    expect(rates.get("deepseek-v4-pro")?.output).toBe(1.4);
    expect(rates.get("mystery-model")?.input).toBe(0);
  });

  test("empty input returns empty map", async () => {
    const rates = await fetchAllRates([]);
    expect(rates.size).toBe(0);
  });
});