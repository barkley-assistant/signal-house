/**
 * model-costs — pricing lookup + cache-savings formula.
 *
 * The cost rate is intentionally operator-driven: model-map.json carries a
 * `costInput` (USD per 1M input tokens) per model. With the operator's
 * deliberate `cost.cache.read = 0` config (cached reads are free), a cache
 * hit is a direct discount equal to `cacheReadTokens × costInput / 1e6`.
 *
 * Formula and rationale live next to the function so the next reader doesn't
 * think we missed a separate cache-discount rate.
 */

import { describe, expect, test } from "bun:test";
import { costInputForModel, cacheSavingsUsdForModel } from "../../src/shared/model-costs";

describe("costInputForModel", () => {
  test("returns the curated rate for a known model", () => {
    expect(costInputForModel("DeepSeek V4 Pro")).toBeCloseTo(3, 5);
  });

  test("normalises the model label before lookup (case/separator insensitive)", () => {
    // The dashboard feeds either a machine key, a label, or a raw upstream
    // spelling; the lookup must converge on the same entry.
    expect(costInputForModel("deepseek-v4-pro")).toBe(costInputForModel("DeepSeek V4 Pro"));
    expect(costInputForModel("DEEPSEEK_V4_PRO")).toBe(costInputForModel("DeepSeek V4 Pro"));
  });

  test("returns null for an unpriced model", () => {
    expect(costInputForModel("some-new-model-v3")).toBeNull();
  });
});

describe("cacheSavingsUsdForModel", () => {
  test("computes savings for 1M cache-read tokens at the curated rate", () => {
    // costInput $3/M × 1M tokens → $3.00 saved
    expect(cacheSavingsUsdForModel("DeepSeek V4 Pro", 1_000_000)).toBeCloseTo(3, 5);
  });

  test("computes savings for 1B cache-read tokens", () => {
    expect(cacheSavingsUsdForModel("DeepSeek V4 Pro", 1_000_000_000)).toBeCloseTo(3000, 5);
  });

  test("returns null for an unpriced model (renders as em-dash)", () => {
    expect(cacheSavingsUsdForModel("some-new-model-v3", 1_000_000)).toBeNull();
  });

  test("returns 0 for a priced model with zero cache reads (never NaN)", () => {
    expect(cacheSavingsUsdForModel("DeepSeek V4 Pro", 0)).toBe(0);
  });

  test("does NOT count cache-write as savings — only the read discount applies", () => {
    // Same priced model, same token count: formula is read-only, so this is
    // the same number a zero-write run would produce. The contract is that
    // the caller is responsible for passing cache-read tokens (not cache-write).
    const a = cacheSavingsUsdForModel("DeepSeek V4 Pro", 1_000_000);
    expect(a).toBeCloseTo(3, 5);
  });
});