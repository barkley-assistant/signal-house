import { describe, expect, it } from "@jest/globals";
import {
  aggregateCostRows,
  computeEfficiencyMultiplier,
  formatCostPerMessage,
  getCheapestCpm,
  getEfficiencyTier,
  rankByCost,
} from "../cost-efficiency";
import type { CostRow } from "../cost-efficiency";
import type { ModelUsageEntry } from "../rank-models";

function makeRow(overrides: Partial<CostRow> = {}): CostRow {
  return {
    modelName: "default-model",
    cost: 1.0,
    messages: 50,
    costPerMessage: 0.02,
    ...overrides,
  };
}

describe("formatCostPerMessage", () => {
  it('returns "—" for null', () => {
    expect(formatCostPerMessage(null)).toBe("—");
  });

  it("formats sub-cent values with one-decimal cents and the ¢/msg suffix", () => {
    expect(formatCostPerMessage(0.003)).toBe("0.3¢/msg");
    expect(formatCostPerMessage(0.005)).toBe("0.5¢/msg");
  });

  it("formats exactly 0.01 as a dollar value (cent threshold is exclusive)", () => {
    expect(formatCostPerMessage(0.01)).toBe("$0.01/msg");
  });

  it("formats dollar-range values using formatCost and appends /msg", () => {
    expect(formatCostPerMessage(0.032)).toBe("$0.03/msg");
    expect(formatCostPerMessage(1.24)).toBe("$1.24/msg");
  });

  it("formats zero as a sub-cent cents value (per design: cpm < 0.01 → cents)", () => {
    expect(formatCostPerMessage(0)).toBe("0.0¢/msg");
  });
});

describe("aggregateCostRows", () => {
  it("returns an empty array for empty input", () => {
    expect(aggregateCostRows([])).toEqual([]);
  });

  it("preserves cost and messages when there is a single entry per model", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 100, cost: 4.0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelName).toBe("alpha");
    expect(rows[0].cost).toBe(4.0);
    expect(rows[0].messages).toBe(100);
    expect(rows[0].costPerMessage).toBe(0.04);
  });

  it("sums cost and messages across multiple rows for the same model", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 100, cost: 4.0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
      { modelName: "alpha", messages: 50, cost: 2.0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelName).toBe("alpha");
    expect(rows[0].cost).toBe(6.0);
    expect(rows[0].messages).toBe(150);
    expect(rows[0].costPerMessage).toBeCloseTo(0.04, 10);
  });

  it("preserves null cost in the aggregated row", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 100, cost: null, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows[0].cost).toBeNull();
    expect(rows[0].costPerMessage).toBeNull();
  });

  it("sets costPerMessage to null when messages is zero", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 0, cost: 5.0, inputTokens: null, outputTokens: null, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows[0].cost).toBe(5.0);
    expect(rows[0].messages).toBe(0);
    expect(rows[0].costPerMessage).toBeNull();
  });
});

describe("rankByCost", () => {
  it("sorts rows by cost descending", () => {
    const sorted = rankByCost([
      makeRow({ modelName: "low", cost: 1.0, messages: 10, costPerMessage: 0.1 }),
      makeRow({ modelName: "high", cost: 10.0, messages: 10, costPerMessage: 1.0 }),
      makeRow({ modelName: "mid", cost: 5.0, messages: 10, costPerMessage: 0.5 }),
    ]);
    expect(sorted.map((r) => r.modelName)).toEqual(["high", "mid", "low"]);
  });

  it("places null-cost models after models with defined cost", () => {
    const sorted = rankByCost([
      makeRow({ modelName: "A", cost: 5.0, messages: 100, costPerMessage: 0.05 }),
      makeRow({ modelName: "B", cost: null, messages: 50, costPerMessage: null }),
    ]);
    expect(sorted.map((r) => r.modelName)).toEqual(["A", "B"]);
  });

  it("breaks ties alphabetically (ascending) by modelName", () => {
    const sorted = rankByCost([
      makeRow({ modelName: "zephyr", cost: 2.0, messages: 10, costPerMessage: 0.2 }),
      makeRow({ modelName: "atlas", cost: 2.0, messages: 10, costPerMessage: 0.2 }),
    ]);
    expect(sorted.map((r) => r.modelName)).toEqual(["atlas", "zephyr"]);
  });

  it("treats cost 0 and cost null as equal (both sort to end, alphabetical)", () => {
    const sorted = rankByCost([
      makeRow({ modelName: "B", cost: 0, messages: 10, costPerMessage: 0 }),
      makeRow({ modelName: "A", cost: null, messages: 10, costPerMessage: null }),
    ]);
    expect(sorted.map((r) => r.modelName)).toEqual(["A", "B"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      makeRow({ modelName: "low", cost: 1.0, messages: 10, costPerMessage: 0.1 }),
      makeRow({ modelName: "high", cost: 10.0, messages: 10, costPerMessage: 1.0 }),
    ];
    const copy = [...input];
    rankByCost(input);
    expect(input).toEqual(copy);
  });

  it("returns an empty array for empty input", () => {
    expect(rankByCost([])).toEqual([]);
  });
});

describe("getCheapestCpm", () => {
  it("returns null for an empty row set", () => {
    expect(getCheapestCpm([])).toBeNull();
  });

  it("returns null when every row has null costPerMessage", () => {
    expect(
      getCheapestCpm([
        makeRow({ modelName: "A", cost: null, costPerMessage: null }),
        makeRow({ modelName: "B", cost: null, costPerMessage: null }),
      ]),
    ).toBeNull();
  });

  it("returns the minimum across mixed null and defined costPerMessage values", () => {
    expect(
      getCheapestCpm([
        makeRow({ modelName: "A", costPerMessage: 0.05 }),
        makeRow({ modelName: "B", costPerMessage: null }),
        makeRow({ modelName: "C", costPerMessage: 0.12 }),
        makeRow({ modelName: "D", costPerMessage: 0.01 }),
      ]),
    ).toBe(0.01);
  });

  it("returns the shared value when two rows tie at the lowest CPM", () => {
    expect(
      getCheapestCpm([
        makeRow({ modelName: "A", costPerMessage: 0.02 }),
        makeRow({ modelName: "B", costPerMessage: 0.02 }),
      ]),
    ).toBe(0.02);
  });
});

describe("computeEfficiencyMultiplier", () => {
  it("returns 1.0 when row CPM equals cheapest CPM", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.01 }),
        0.01,
      ),
    ).toBe(1.0);
  });

  it("rounds the ratio to one decimal place (1.04 → 1.0)", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.0104 }),
        0.01,
      ),
    ).toBe(1.0);
  });

  it("rounds the ratio to one decimal place (1.05 → 1.1)", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.0105 }),
        0.01,
      ),
    ).toBe(1.1);
  });

  it("returns a multi-x ratio rounded to one decimal (5.27 → 5.3)", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.0527 }),
        0.01,
      ),
    ).toBe(5.3);
  });

  it("returns null when row costPerMessage is null", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: null }),
        0.01,
      ),
    ).toBeNull();
  });

  it("returns null when cheapest CPM is null", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.05 }),
        null,
      ),
    ).toBeNull();
  });

  it("returns null when cheapest CPM is zero (division guard)", () => {
    expect(
      computeEfficiencyMultiplier(
        makeRow({ costPerMessage: 0.05 }),
        0,
      ),
    ).toBeNull();
  });
});

describe("getEfficiencyTier", () => {
  it("classifies a 1× ratio (cheapest) as efficient", () => {
    expect(getEfficiencyTier(0.01, 0.01)).toBe("efficient");
  });

  it("classifies a ratio at the upper boundary of efficient (3.0) as efficient", () => {
    expect(getEfficiencyTier(0.03, 0.01)).toBe("efficient");
  });

  it("classifies a ratio just above the efficient boundary (3.01) as normal", () => {
    expect(getEfficiencyTier(0.0301, 0.01)).toBe("normal");
  });

  it("classifies a ratio at the upper boundary of normal (12.0) as normal", () => {
    expect(getEfficiencyTier(0.12, 0.01)).toBe("normal");
  });

  it("classifies a ratio just above the normal boundary (12.01) as below-average", () => {
    expect(getEfficiencyTier(0.1201, 0.01)).toBe("below-average");
  });

  it("classifies a ratio at the upper boundary of below-average (25.0) as below-average", () => {
    expect(getEfficiencyTier(0.25, 0.01)).toBe("below-average");
  });

  it("classifies a ratio just above the below-average boundary (25.01) as inefficient", () => {
    expect(getEfficiencyTier(0.2501, 0.01)).toBe("inefficient");
  });

  it("classifies a very high ratio as inefficient", () => {
    expect(getEfficiencyTier(1.0, 0.01)).toBe("inefficient");
  });

  it("returns normal when costPerMessage is null", () => {
    expect(getEfficiencyTier(null, 0.01)).toBe("normal");
  });

  it("returns normal when cheapestCpm is null", () => {
    expect(getEfficiencyTier(0.05, null)).toBe("normal");
  });

  it("returns normal when cheapestCpm is zero (division guard)", () => {
    expect(getEfficiencyTier(0.05, 0)).toBe("normal");
  });
});
