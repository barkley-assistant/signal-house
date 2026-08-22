import { describe, test, expect } from "bun:test";
import { parseLitellmPricing } from "../../src/shared/model-pricing-parser";

describe("parseLitellmPricing", () => {
  test("accepts any provider with finite rates (openai, anthropic, gemini, …)", () => {
    // The parser accepts all litellm entries with finite input/output rates
    // regardless of `litellm_provider` — pricing is the same whether the
    // request was routed through OpenAI, Anthropic, Gemini, etc. Provider
    // matters for routing, not for the per-1M-token rate.
    const input = {
      "gpt-5": { litellm_provider: "openai", input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
      "claude-opus-4-7": { litellm_provider: "anthropic", input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
      "gemini-3-pro": { litellm_provider: "gemini", input_cost_per_token: 1e-6, output_cost_per_token: 4e-6 },
    };
    const out = parseLitellmPricing(input);
    expect(Object.keys(out).sort()).toEqual(["claude-opus-4-7", "gemini-3-pro", "gpt-5"]);
    expect(out["gpt-5"].input).toBe(1.25);
    expect(out["gpt-5"].output).toBe(10);
  });

  test("multiplies per-token rates to per-1M tokens", () => {
    const input = {
      "gpt-5.6-luna": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 6e-6 },
    };
    const out = parseLitellmPricing(input);
    // machineKey strips dots entirely, so "gpt-5.6-luna" → "gpt-56-luna"
    expect(out["gpt-56-luna"].input).toBe(1);
    expect(out["gpt-56-luna"].output).toBe(6);
  });

  test("falls back cacheRead to input when cache_read_input_token_cost is missing", () => {
    const input = {
      "gpt-5": { litellm_provider: "openai", input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
    };
    const out = parseLitellmPricing(input);
    expect(out["gpt-5"].cacheRead).toBe(1.25);
  });

  test("uses explicit cacheRead when present", () => {
    const input = {
      "gpt-5": {
        litellm_provider: "openai",
        input_cost_per_token: 1.25e-6,
        output_cost_per_token: 1e-5,
        cache_read_input_token_cost: 1.25e-7,
      },
    };
    const out = parseLitellmPricing(input);
    expect(out["gpt-5"].cacheRead).toBe(0.125);
  });

  test("skips entries with non-finite rates", () => {
    const input = {
      "gpt-good": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
      "gpt-null-input": { litellm_provider: "openai", input_cost_per_token: null, output_cost_per_token: 1e-6 },
      "gpt-nan-output": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: NaN },
      "gpt-missing-output": { litellm_provider: "openai", input_cost_per_token: 1e-6 },
    };
    const out = parseLitellmPricing(input);
    expect(Object.keys(out)).toEqual(["gpt-good"]);
  });

  test("skips non-object entries (e.g. the sample_spec key)", () => {
    const input = {
      sample_spec: "not an object",
      "gpt-5": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
    };
    const out = parseLitellmPricing(input);
    expect(Object.keys(out)).toEqual(["gpt-5"]);
  });

  test("machineKey normalisation: GPT 5.6 Luna and gpt-5.6-luna collapse to one entry", () => {
    const input = {
      "GPT 5.6 Luna": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 6e-6 },
      "gpt-5.6-luna": { litellm_provider: "openai", input_cost_per_token: 1.5e-6, output_cost_per_token: 7e-6 },
    };
    const out = parseLitellmPricing(input);
    // machineKey strips dots: both keys → "gpt-56-luna". Both are native
    // (no "/" route prefix), so the collision policy applies: cheapest
    // input wins ($1.0 / $6.0 from the first entry).
    expect(Object.keys(out)).toEqual(["gpt-56-luna"]);
    expect(out["gpt-56-luna"].input).toBe(1);
    expect(out["gpt-56-luna"].output).toBe(6);
    expect(out["gpt-56-luna"].sourceKey).toBe("GPT 5.6 Luna");
  });

  test("collision policy: provider-native entry beats cheaper routed resellers", () => {
    // The DeepSeek V4 Flash scenario: 10 upstream routes machine-key to
    // one name; resellers price it lower than DeepSeek's own listing.
    // The operator configures the provider directly, so the vendor's own
    // sheet is the defensible default even when a reseller is cheaper.
    const input = {
      "azure_ai/deepseek-v4-flash": { litellm_provider: "azure_ai", input_cost_per_token: 1.9e-7, output_cost_per_token: 8e-7 },
      "fireworks_ai/deepseek-v4-flash": { litellm_provider: "fireworks_ai", input_cost_per_token: 1.4e-7, output_cost_per_token: 5.5e-7 },
      "tencent/deepseek-v4-flash": { litellm_provider: "tencent", input_cost_per_token: 1.4e-7, output_cost_per_token: 5.5e-7 },
      "deepseek-v4-flash": {
        litellm_provider: "deepseek",
        input_cost_per_token: 4.4e-7,
        output_cost_per_token: 1.32e-6,
        cache_read_input_token_cost: 1.4e-8,
      },
    };
    const out = parseLitellmPricing(input);
    expect(Object.keys(out)).toEqual(["deepseek-v4-flash"]);
    expect(out["deepseek-v4-flash"].route).toBe("native");
    expect(out["deepseek-v4-flash"].sourceKey).toBe("deepseek-v4-flash");
    expect(out["deepseek-v4-flash"].input).toBeCloseTo(0.44, 5); // 4.4e-7 × 1M
    expect(out["deepseek-v4-flash"].cacheRead).toBeCloseTo(0.014, 5); // 1.4e-8 × 1M
  });

  test("collision fallback: all-routed keys resolve to cheapest input", () => {
    const input = {
      "azure_ai/some-model": { litellm_provider: "azure_ai", input_cost_per_token: 1.9e-7, output_cost_per_token: 8e-7 },
      "fireworks_ai/some-model": { litellm_provider: "fireworks_ai", input_cost_per_token: 1.4e-7, output_cost_per_token: 5.5e-7 },
    };
    const out = parseLitellmPricing(input);
    // No native listing exists — cheapest reseller wins.
    expect(out["some-model"].sourceKey).toBe("fireworks_ai/some-model");
    expect(out["some-model"].input).toBeCloseTo(0.14, 5);
  });

  test("cache-read rate honours DeepSeek's input_cost_per_token_cache_hit field", () => {
    const input = {
      "deepseek-chat": {
        litellm_provider: "deepseek",
        input_cost_per_token: 4.4e-7,
        output_cost_per_token: 1.32e-6,
        input_cost_per_token_cache_hit: 1.4e-8, // no anthropic-style field
      },
    };
    const out = parseLitellmPricing(input);
    // Before this fix the parser fell back to the input rate ($0.44/M) for
    // models that only expose the cache-hit discount under DeepSeek's field
    // name — inflating cached-heavy rows ~30x.
    expect(out["deepseek-chat"].cacheRead).toBeCloseTo(0.014, 5);
  });

  test("handles malformed top-level inputs without throwing", () => {
    expect(parseLitellmPricing(null)).toEqual({});
    expect(parseLitellmPricing(undefined)).toEqual({});
    expect(parseLitellmPricing("string")).toEqual({});
    expect(parseLitellmPricing(42)).toEqual({});
    expect(parseLitellmPricing([])).toEqual({});
    expect(parseLitellmPricing({})).toEqual({});
  });

  test("skips entries whose key normalises to empty string", () => {
    const input = {
      "/": { litellm_provider: "openai", input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
    };
    const out = parseLitellmPricing(input);
    expect(out).toEqual({});
  });

  test("includes _flex / _priority cost fields are ignored — Standard rates only", () => {
    const input = {
      "gpt-5": {
        litellm_provider: "openai",
        input_cost_per_token: 1.25e-6,
        output_cost_per_token: 1e-5,
        input_cost_per_token_flex: 6.25e-7,
        output_cost_per_token_priority: 2e-5,
      },
    };
    const out = parseLitellmPricing(input);
    expect(out["gpt-5"].input).toBe(1.25);
    expect(out["gpt-5"].output).toBe(10);
  });
});