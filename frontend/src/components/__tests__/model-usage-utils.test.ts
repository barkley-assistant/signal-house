import { describe, expect, it } from "@jest/globals";
import { totalTokens, hasDetailData } from "../model-usage-utils";
import type { RankedModelEntry } from "@/lib/rank-models";

function makeEntry(overrides: Partial<RankedModelEntry> = {}): RankedModelEntry {
  return {
    modelName: "test-model",
    messages: 100,
    inputTokens: 0,
    outputTokens: 0,
    tokensReasoning: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    isOther: false,
    proportion: 0,
    ...overrides,
  };
}

describe("model-usage-utils.totalTokens", () => {
  it("returns null when every token field is null", () => {
    const entry = makeEntry({
      inputTokens: null,
      outputTokens: null,
      tokensReasoning: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
    expect(totalTokens(entry)).toBeNull();
  });

  it("includes reasoning tokens in the total", () => {
    const entry = makeEntry({
      inputTokens: 100,
      outputTokens: 0,
      tokensReasoning: 42,
    });
    expect(totalTokens(entry)).toBe(142);
  });

  it("includes all 5 token types in the total", () => {
    const entry = makeEntry({
      inputTokens: 100,
      outputTokens: 50,
      tokensReasoning: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
    expect(totalTokens(entry)).toBe(190);
  });

  it("treats null fields as 0 in the total", () => {
    const entry = makeEntry({
      inputTokens: 100,
      outputTokens: 50,
      tokensReasoning: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
    expect(totalTokens(entry)).toBe(150);
  });
});

describe("model-usage-utils.hasDetailData", () => {
  it("returns true when only reasoning tokens are present", () => {
    const entry = makeEntry({
      inputTokens: null,
      outputTokens: null,
      tokensReasoning: 25,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: null,
    });
    expect(hasDetailData(entry)).toBe(true);
  });

  it("returns false when all token and cost fields are null or zero", () => {
    const entry = makeEntry({
      inputTokens: null,
      outputTokens: null,
      tokensReasoning: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: null,
    });
    expect(hasDetailData(entry)).toBe(false);
  });
});
