import { describe, expect, it } from "@jest/globals";
import { lastNonGapDay, resolveClickIndex } from "../daily-token-usage-utils";
import type { DailyTokenUsageRow } from "@/types";

const makeRow = (date: string): DailyTokenUsageRow => ({
  date,
  source: "opencode",
  totalSessions: 1,
  totalMessages: 5,
  totalTokens: 1000,
  totalCost: 0.05,
  modelUsage: [],
  rawJson: null,
  createdAt: "2026-07-01T00:00:00.000Z",
});

describe("lastNonGapDay", () => {
  it("returns the latest day in spine that has data", () => {
    const spine = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
    const rows = [makeRow("2026-07-01"), makeRow("2026-07-03")];
    expect(lastNonGapDay(spine, rows)).toBe("2026-07-03");
  });

  it("returns the only day with data when that is the last", () => {
    const spine = ["2026-07-01", "2026-07-02", "2026-07-03"];
    const rows = [makeRow("2026-07-03")];
    expect(lastNonGapDay(spine, rows)).toBe("2026-07-03");
  });

  it("returns null when spine is empty", () => {
    expect(lastNonGapDay([], [])).toBeNull();
  });

  it("returns null when no day in spine has data", () => {
    const spine = ["2026-07-01", "2026-07-02", "2026-07-03"];
    const rows = [makeRow("2026-07-05")];
    expect(lastNonGapDay(spine, rows)).toBeNull();
  });

  it("handles single-element spine with matching data", () => {
    const spine = ["2026-07-01"];
    const rows = [makeRow("2026-07-01")];
    expect(lastNonGapDay(spine, rows)).toBe("2026-07-01");
  });

  it("handles dates that are not in ascending order in rows", () => {
    const spine = ["2026-07-01", "2026-07-02", "2026-07-03"];
    const rows = [makeRow("2026-07-03"), makeRow("2026-07-01")];
    expect(lastNonGapDay(spine, rows)).toBe("2026-07-03");
  });
});

describe("resolveClickIndex", () => {
  it("extracts and rounds a valid array result", () => {
    expect(resolveClickIndex([2.3, 150], 10)).toBe(2);
  });

  it("rounds to nearest integer", () => {
    expect(resolveClickIndex([2.7, 150], 10)).toBe(3);
  });

  it("returns null for a negative index", () => {
    expect(resolveClickIndex([-1, 150], 10)).toBeNull();
  });

  it("returns null for an index beyond spineLength", () => {
    expect(resolveClickIndex([10, 150], 10)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(resolveClickIndex(null, 10)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(resolveClickIndex(undefined, 10)).toBeNull();
  });

  it("returns null for a non-array, non-number object input", () => {
    expect(resolveClickIndex({ x: 5 } as unknown as number[], 10)).toBeNull();
  });

  it("returns null for NaN result", () => {
    expect(resolveClickIndex([NaN, 150], 10)).toBeNull();
  });

  it("returns null for Infinity result", () => {
    expect(resolveClickIndex([Infinity, 150], 10)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(resolveClickIndex([], 10)).toBeNull();
  });

  it("returns 0 for index 0 boundary", () => {
    expect(resolveClickIndex([0, 150], 10)).toBe(0);
  });

  it("returns spineLength-1 for last valid index boundary", () => {
    expect(resolveClickIndex([9, 150], 10)).toBe(9);
  });

  it("returns null when spine is empty", () => {
    expect(resolveClickIndex([2, 150], 0)).toBeNull();
  });

  it("handles a plain number result (non-array)", () => {
    expect(resolveClickIndex(3, 10)).toBe(3);
  });

  it("returns null for right-edge extrapolation", () => {
    expect(resolveClickIndex([10.4, 150], 10)).toBeNull();
  });
});
