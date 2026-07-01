import { describe, expect, it } from "@jest/globals";
import {
  EFFICIENCY_THRESHOLDS,
  aggregateCostRows,
  computeEfficiencyFlags,
  formatCostPerMessage,
  rankByCost,
} from "../cost-efficiency";
import type { CostRow } from "../cost-efficiency";
import type { ModelUsageEntry } from "../rank-models";

describe("EFFICIENCY_THRESHOLDS", () => {
  it("exposes the documented threshold values", () => {
    expect(EFFICIENCY_THRESHOLDS.highCost).toBe(5.0);
    expect(EFFICIENCY_THRESHOLDS.lowUsageMessages).toBe(100);
    expect(EFFICIENCY_THRESHOLDS.cpmMultiplier).toBe(2);
  });
});

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
      { modelName: "alpha", messages: 100, cost: 4.0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelName).toBe("alpha");
    expect(rows[0].cost).toBe(4.0);
    expect(rows[0].messages).toBe(100);
    expect(rows[0].costPerMessage).toBe(0.04);
  });

  it("sums cost and messages across multiple rows for the same model", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 100, cost: 4.0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
      { modelName: "alpha", messages: 50, cost: 2.0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].modelName).toBe("alpha");
    expect(rows[0].cost).toBe(6.0);
    expect(rows[0].messages).toBe(150);
    expect(rows[0].costPerMessage).toBeCloseTo(0.04, 10);
  });

  it("preserves null cost in the aggregated row", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 100, cost: null, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
    ]);
    expect(rows[0].cost).toBeNull();
    expect(rows[0].costPerMessage).toBeNull();
  });

  it("sets costPerMessage to null when messages is zero", () => {
    const rows = aggregateCostRows([
      { modelName: "alpha", messages: 0, cost: 5.0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null } satisfies ModelUsageEntry,
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

describe("computeEfficiencyFlags", () => {
  it("flags high-cost + low-usage when cost > 5 and messages < 100", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 8.5, messages: 42, costPerMessage: 0.2 }),
      0.05
    );
    expect(flags.highCostLowUsage).toBe(true);
    expect(flags.lowerThanAverage).toBe(true);
  });

  it("flags lowerThanAverage when cpm > 2 * avgCpm even if cost is below $5", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 2.0, messages: 10, costPerMessage: 0.2 }),
      0.03
    );
    expect(flags.highCostLowUsage).toBe(false);
    expect(flags.lowerThanAverage).toBe(true);
  });

  it("does not flag an efficient model", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 1.0, messages: 500, costPerMessage: 0.002 }),
      0.01
    );
    expect(flags.highCostLowUsage).toBe(false);
    expect(flags.lowerThanAverage).toBe(false);
  });

  it("suppresses both flags when cost is null", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: null, messages: 50, costPerMessage: null }),
      0.05
    );
    expect(flags.highCostLowUsage).toBe(false);
    expect(flags.lowerThanAverage).toBe(false);
  });

  it("does not flag lowerThanAverage when cpm is null", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 8.5, messages: 42, costPerMessage: null }),
      0.05
    );
    expect(flags.highCostLowUsage).toBe(true);
    expect(flags.lowerThanAverage).toBe(false);
  });

  it("does not flag lowerThanAverage when avgCpm is null", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 8.5, messages: 42, costPerMessage: 0.2 }),
      null
    );
    expect(flags.highCostLowUsage).toBe(true);
    expect(flags.lowerThanAverage).toBe(false);
  });

  it("does not flag lowerThanAverage when avgCpm is zero (division guard)", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 8.5, messages: 42, costPerMessage: 0.2 }),
      0
    );
    expect(flags.highCostLowUsage).toBe(true);
    expect(flags.lowerThanAverage).toBe(false);
  });

  it("does not flag highCostLowUsage when cost is exactly $5 (strict greater-than)", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 5.0, messages: 42, costPerMessage: 0.12 }),
      0.05
    );
    expect(flags.highCostLowUsage).toBe(false);
  });

  it("does not flag highCostLowUsage when messages is exactly 100 (strict less-than)", () => {
    const flags = computeEfficiencyFlags(
      makeRow({ cost: 8.5, messages: 100, costPerMessage: 0.085 }),
      0.05
    );
    expect(flags.highCostLowUsage).toBe(false);
  });
});
