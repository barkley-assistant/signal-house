import { describe, expect, it } from "@jest/globals";
import { rankModelUsage } from "../rank-models";
import type { ModelUsageEntry } from "../rank-models";

function makeEntry(overrides: Partial<ModelUsageEntry> = {}): ModelUsageEntry {
  return {
    modelName: "test-model",
    messages: 100,
    inputTokens: 5000,
    outputTokens: 2000,
    tokensReasoning: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    cost: 0.05,
    ...overrides,
  };
}

describe("rankModelUsage", () => {
  it("returns empty array for empty input", () => {
    expect(rankModelUsage([])).toEqual([]);
  });

  it("returns single entry with isOther false and proportion 1", () => {
    const entry = makeEntry({ messages: 100 });
    const result = rankModelUsage([entry]);
    expect(result).toHaveLength(1);
    expect(result[0].modelName).toBe(entry.modelName);
    expect(result[0].isOther).toBe(false);
    expect(result[0].proportion).toBe(1);
  });

  it("ranks entries by token count descending", () => {
    const low = makeEntry({ modelName: "low", inputTokens: 100, outputTokens: 50, cost: 0.05 });
    const high = makeEntry({ modelName: "high", inputTokens: 5000, outputTokens: 3000, cost: 0.01 });
    const result = rankModelUsage([low, high]);
    expect(result[0].modelName).toBe("high");
    expect(result[1].modelName).toBe("low");
  });

  it("does not mutate the input array", () => {
    const entries = [
      makeEntry({ modelName: "a", messages: 10 }),
      makeEntry({ modelName: "b", messages: 100 }),
    ];
    const copy = [...entries];
    rankModelUsage(entries);
    expect(entries).toEqual(copy);
  });

  it("computes proportion as share of total tokens", () => {
    const a = makeEntry({ modelName: "a", messages: 75, inputTokens: 7500, outputTokens: 0 });
    const b = makeEntry({ modelName: "b", messages: 25, inputTokens: 2500, outputTokens: 0 });
    const result = rankModelUsage([a, b]);
    expect(result[0].proportion).toBe(0.75);
    expect(result[1].proportion).toBe(0.25);
  });

  it("groups 2+ remainder models into a single Other row when cumulative token share exceeds 95%", () => {
    const dominant = makeEntry({
      modelName: "dominant",
      messages: 960,
      inputTokens: 9500,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: 0.50,
    });
    const tiny1 = makeEntry({
      modelName: "tiny1",
      messages: 20,
      inputTokens: 200,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: 0.30,
    });
    const tiny2 = makeEntry({
      modelName: "tiny2",
      messages: 20,
      inputTokens: 200,
      outputTokens: 0,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: 0.20,
    });
    const result = rankModelUsage([dominant, tiny1, tiny2]);
    expect(result).toHaveLength(2);
    expect(result[0].modelName).toBe("dominant");
    expect(result[0].isOther).toBe(false);
    expect(result[0].proportion).toBeCloseTo(9500 / 9900, 10);
    expect(result[1].modelName).toBe("Other (2 models)");
    expect(result[1].isOther).toBe(true);
    expect(result[1].messages).toBe(40);
    expect(result[1].proportion).toBeCloseTo(400 / 9900, 10);
    expect(result[1].inputTokens).toBe(400);
    expect(result[1].outputTokens).toBe(0);
    expect(result[1].cost).toBe(0.50);
  });

  it("does not group a single remainder model", () => {
    const a = makeEntry({ modelName: "a", messages: 960, inputTokens: 9500, outputTokens: 100, cost: 0.04 });
    const b = makeEntry({ modelName: "b", messages: 40, inputTokens: 500, outputTokens: 0, cost: 0.96 });
    const result = rankModelUsage([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0].modelName).toBe("a");
    expect(result[1].modelName).toBe("b");
    expect(result[1].isOther).toBe(false);
  });

  it("includes the model that pushes cumulative token share past 95%", () => {
    const a = makeEntry({ modelName: "a", messages: 920, inputTokens: 9200, outputTokens: 0, cost: 0.92 });
    const b = makeEntry({ modelName: "b", messages: 40, inputTokens: 400, outputTokens: 0, cost: 0.04 });
    const c = makeEntry({ modelName: "c", messages: 40, inputTokens: 400, outputTokens: 0, cost: 0.04 });
    const result = rankModelUsage([a, b, c]);
    // a=92%, a+b=96% -> a,b both included, c leftover but only 1 -> no Other
    expect(result).toHaveLength(3);
  });

  it("does not create Other when cumulative token share never hits 95% with enough models", () => {
    const a = makeEntry({ modelName: "a", messages: 400, inputTokens: 4000, outputTokens: 0, cost: 0.40 });
    const b = makeEntry({ modelName: "b", messages: 300, inputTokens: 3000, outputTokens: 0, cost: 0.30 });
    const c = makeEntry({ modelName: "c", messages: 300, inputTokens: 3000, outputTokens: 0, cost: 0.30 });
    // a=40%, a+b=70%, a+b+c=100% -> all included, no Other
    const result = rankModelUsage([a, b, c]);
    expect(result).toHaveLength(3);
    result.forEach((r) => expect(r.isOther).toBe(false));
  });

  it("handles all-zero-token entries with proportion 0", () => {
    const entries = [
      { modelName: "a", messages: 0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null },
      { modelName: "b", messages: 0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null },
    ];
    const result = rankModelUsage(entries);
    expect(result).toHaveLength(2);
    expect(result[0].proportion).toBe(0);
    expect(result[1].proportion).toBe(0);
    expect(result[0].isOther).toBe(false);
  });

  it("Other row tokens are null when all remainder tokens are null", () => {
    const dominant = makeEntry({ modelName: "d", messages: 960, inputTokens: 9600, outputTokens: 0, cost: 0.96 });
    const tiny1: ModelUsageEntry = { modelName: "t1", messages: 20, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null };
    const tiny2: ModelUsageEntry = { modelName: "t2", messages: 20, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null };
    const result = rankModelUsage([dominant, tiny1, tiny2]);
    expect(result).toHaveLength(2);
    const other = result[1];
    expect(other.isOther).toBe(true);
    expect(other.inputTokens).toBeNull();
    expect(other.outputTokens).toBeNull();
    expect(other.cost).toBeNull();
    expect(other.proportion).toBe(0);
  });

  it("Other row tokens sum non-null values when mixed", () => {
    const dominant = makeEntry({ modelName: "d", messages: 960, inputTokens: 9600, outputTokens: 50, cost: 0.96 });
    const tiny1: ModelUsageEntry = { modelName: "t1", messages: 20, inputTokens: 100, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: 0.02 };
    const tiny2: ModelUsageEntry = { modelName: "t2", messages: 20, inputTokens: null, outputTokens: 50, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null };
    const result = rankModelUsage([dominant, tiny1, tiny2]);
    expect(result).toHaveLength(2);
    const other = result[1];
    expect(other.isOther).toBe(true);
    expect(other.inputTokens).toBe(100);
    expect(other.outputTokens).toBe(50);
    expect(other.cost).toBe(0.02);
    expect(other.proportion).toBeCloseTo(150 / 9800, 10);
  });

  it("groups 3+ remainder models into a single Other row", () => {
    const dominant = makeEntry({ modelName: "dominant", messages: 950, inputTokens: 9500, outputTokens: 0, cost: 0.10 });
    const r1 = makeEntry({ modelName: "r1", messages: 20, inputTokens: 100, outputTokens: 0, cost: 0.02 });
    const r2 = makeEntry({ modelName: "r2", messages: 15, inputTokens: 100, outputTokens: 0, cost: 0.02 });
    const r3 = makeEntry({ modelName: "r3", messages: 15, inputTokens: 100, outputTokens: 0, cost: 0.01 });
    // dominant=9500/9800=96.9%, cumulative=96.9% -> r1,r2,r3 are leftover, 3 -> Other
    const result = rankModelUsage([dominant, r1, r2, r3]);
    expect(result).toHaveLength(2);
    expect(result[0].modelName).toBe("dominant");
    expect(result[1].modelName).toBe("Other (3 models)");
    expect(result[1].isOther).toBe(true);
    expect(result[1].messages).toBe(50);
    expect(result[1].proportion).toBeCloseTo(300 / 9800, 10);
  });

  it("includes single leftover model separately when only one remains after 95% token cutoff", () => {
    const a = makeEntry({ modelName: "a", messages: 950, inputTokens: 9500, outputTokens: 0, cost: 0.05 });
    const b = makeEntry({ modelName: "b", messages: 50, inputTokens: 500, outputTokens: 0, cost: 0.95 });
    // a=9500/10000=95%, b is single leftover -> stays separate (no Other)
    const result = rankModelUsage([a, b]);
    expect(result).toHaveLength(2);
    expect(result[0].modelName).toBe("a");
    expect(result[1].modelName).toBe("b");
    expect(result[1].isOther).toBe(false);
  });

  it("handles spread-out distribution with no grouping", () => {
    const a = makeEntry({ modelName: "a", messages: 300, inputTokens: 3000, outputTokens: 0, cost: 0.30 });
    const b = makeEntry({ modelName: "b", messages: 250, inputTokens: 2500, outputTokens: 0, cost: 0.25 });
    const c = makeEntry({ modelName: "c", messages: 200, inputTokens: 2000, outputTokens: 0, cost: 0.20 });
    const d = makeEntry({ modelName: "d", messages: 150, inputTokens: 1500, outputTokens: 0, cost: 0.15 });
    const e = makeEntry({ modelName: "e", messages: 100, inputTokens: 1000, outputTokens: 0, cost: 0.10 });
    // a=30%, a+b=55%, a+b+c=75%, a+b+c+d=90%, a+b+c+d+e=100%
    // cumulative hits 100% at e, all included, no Other
    const result = rankModelUsage([d, b, e, a, c]);
    expect(result).toHaveLength(5);
    result.forEach((r) => expect(r.isOther).toBe(false));
    expect(result.map((r) => r.modelName)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("totalTokens includes reasoning and cache fields", () => {
    const { totalTokens } = require("../rank-models");
    const entry = makeEntry({
      inputTokens: 100,
      outputTokens: 50,
      tokensReasoning: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
    expect(totalTokens(entry)).toBe(100 + 50 + 25 + 10 + 5);
  });

  it("Other row sums reasoning tokens across remainder models", () => {
    const dominant = makeEntry({
      modelName: "d",
      messages: 960,
      inputTokens: 9600,
      outputTokens: 0,
      cost: 0.96,
    });
    const r1: ModelUsageEntry = {
      modelName: "r1",
      messages: 20,
      inputTokens: 100,
      outputTokens: null,
      tokensReasoning: 7,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: 0.02,
    };
    const r2: ModelUsageEntry = {
      modelName: "r2",
      messages: 20,
      inputTokens: 100,
      outputTokens: null,
      tokensReasoning: 3,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      cost: 0.02,
    };
    const result = rankModelUsage([dominant, r1, r2]);
    const other = result[1];
    expect(other.isOther).toBe(true);
    expect(other.tokensReasoning).toBe(10);
  });
});
