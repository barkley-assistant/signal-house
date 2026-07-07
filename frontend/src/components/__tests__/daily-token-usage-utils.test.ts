import { describe, expect, it } from "@jest/globals";
import { lastNonGapDay } from "../daily-token-usage-utils";
import type { DailyTokenUsageRow } from "@/types";

const makeRow = (date: string): DailyTokenUsageRow => ({
  date,
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
