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
    // machineKey strips dots: "GPT 5.6 Luna" → "gpt-56-luna"
    // Last write wins (1.5 input / 7 output from the second entry).
    expect(Object.keys(out)).toEqual(["gpt-56-luna"]);
    expect(out["gpt-56-luna"].input).toBe(1.5);
    expect(out["gpt-56-luna"].output).toBe(7);
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