import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  setPricingCachePath,
  resetPricingCache,
  setIOForTesting,
} from "../../src/server/model-pricing-fetcher";
import { setCostConfigPath, resetCostConfigCache } from "../../src/server/cost-input";
import { getModelPricing as resolveModelPricing } from "../../src/server/model-pricing";
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
async function seedLitellmCache(models: Record<string, { input: number; output: number; cacheRead: number }>) {
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
  test("litellm hit returns litellm rates as-is", async () => {
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const rates = await resolveModelPricing("gpt-5");
    expect(rates.input).toBe(1.25);
    expect(rates.output).toBe(10);
    expect(rates.cacheRead).toBe(0.125);
  });

  test("litellm hit takes precedence over local opencode.jsonc rates", async () => {
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });
    // Local has a higher (stale, wrong) input rate. Resolver should
    // still prefer litellm.
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

  test("litellm miss + local hit → falls back to local, output defaults to input × 4", async () => {
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      // "deepseek-v4-pro" intentionally NOT in litellm cache
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

  test("litellm miss + local miss → returns all zeros", async () => {
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const rates = await resolveModelPricing("mystery-model");
    expect(rates).toEqual({ input: 0, output: 0, cacheRead: 0 });
  });

  test("machineKey normalisation: GPT 5.6 Luna and gpt-5.6-luna resolve to same entry", async () => {
    await seedLitellmCache({
      "gpt-56-luna": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const upper = await resolveModelPricing("GPT 5.6 Luna");
    const lower = await resolveModelPricing("gpt-5.6-luna");
    expect(upper).toEqual(lower);
    expect(upper.input).toBe(1.25);
  });

  test("date-snapshot suffix stripping: gpt-5.6-luna-20250815 resolves as gpt-5.6-luna", async () => {
    await seedLitellmCache({
      "gpt-56-luna": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    const dated = await resolveModelPricing("gpt-5.6-luna-20250815");
    expect(dated.input).toBe(1.25);
    expect(dated.output).toBe(10);
  });

  test("empty / malformed model name → returns zeros (no throw)", async () => {
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
    });

    expect((await resolveModelPricing("")).input).toBe(0);
    expect((await resolveModelPricing("/")).input).toBe(0);
    expect((await resolveModelPricing("   ")).input).toBe(0);
  });

  test("non-finite litellm rates (parser skip) → falls through to local", async () => {
    // The parser skips non-finite rates, so this model isn't in the litellm cache.
    await seedLitellmCache({
      "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125 },
      // "broken-model" omitted because parseLitellmPricing would skip it
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
    // litellm parser. For the local source, getCacheReadCostPerMillion
    // returns 0 when the field is absent. The resolver should still report
    // the input/output rates.
    await seedLitellmCache({}); // no litellm entries
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