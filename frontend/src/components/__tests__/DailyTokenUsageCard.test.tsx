import { describe, expect, it } from "@jest/globals";
import { buildDailyTokenUsageOption } from "../DailyTokenUsageCard";
import type { DailyTokenUsageRow } from "@/types";

function makeRow(date: string, overrides: Partial<DailyTokenUsageRow> = {}): DailyTokenUsageRow {
  return {
    date,
    source: "opencode",
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: null,
    modelUsage: [],
    rawJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeFilled(date: string, row: DailyTokenUsageRow | null) {
  return { date, row, isGap: row === null };
}

describe("buildDailyTokenUsageOption — gap-day series mapping", () => {
  it("renders 0 (not null) for tokens/cost/sessions on gap days", () => {
    const filled = [
      makeFilled("2026-07-06", makeRow("2026-07-06", {
        totalTokens: 1200,
        totalCost: 0.05,
        totalSessions: 3,
      })),
      makeFilled("2026-07-07", null), // gap day
      makeFilled("2026-07-08", makeRow("2026-07-08", {
        totalTokens: 800,
        totalCost: 0.03,
        totalSessions: 2,
      })),
    ];

    const option = buildDailyTokenUsageOption(filled);

    const tokens = (option.series as Array<{ data: number[] }>)[0].data;
    const cost = (option.series as Array<{ data: (number | null)[] }>)[1].data;
    const sessions = (option.series as Array<{ data: number[] }>)[2].data;

    // Gap day at index 1 must be 0, not null
    expect(tokens[1]).toBe(0);
    expect(cost[1]).toBe(0);
    expect(sessions[1]).toBe(0);

    // Non-gap days keep real values
    expect(tokens[0]).toBe(1200);
    expect(tokens[2]).toBe(800);
    expect(sessions[0]).toBe(3);
    expect(sessions[2]).toBe(2);
  });

  it("preserves null totalCost within a non-gap day (null-propagation contract from #346)", () => {
    const filled = [
      makeFilled("2026-07-06", makeRow("2026-07-06", {
        totalTokens: 1200,
        totalCost: null, // measured-null: sessions had no cost recorded
        totalSessions: 3,
      })),
    ];

    const option = buildDailyTokenUsageOption(filled);
    const cost = (option.series as Array<{ data: (number | null)[] }>)[1].data;

    // Non-gap day with null cost must remain null in the series
    expect(cost[0]).toBeNull();
    // But tokens/sessions still carry real values
    const tokens = (option.series as Array<{ data: number[] }>)[0].data;
    const sessions = (option.series as Array<{ data: number[] }>)[2].data;
    expect(tokens[0]).toBe(1200);
    expect(sessions[0]).toBe(3);
  });
});
