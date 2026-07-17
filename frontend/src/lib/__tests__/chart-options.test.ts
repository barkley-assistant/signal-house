import {
  formatDayLabel,
  buildThroughputOption,
  buildCycleTimeOption,
  buildCIOption,
  computeThroughputFooter,
  computeCycleTimeFooter,
  computeCIFooter,
} from "@/lib/charts/options";
import type { DashboardWindowDay } from "@/types";

const makeDay = (
  day: string,
  overrides: Partial<DashboardWindowDay> = {},
): DashboardWindowDay => ({
  day,
  isGap: false,
  metrics: {
    ciPassCount: 10,
    ciFailCount: 2,
    ciTotalRuns: 12,
    issuesClosed: 5,
    prsMerged: 3,
    medianCycleTimeSeconds: 86400,
    day,
  },
  ...overrides,
});

describe("formatDayLabel", () => {
  it("formats ISO date as short month + day", () => {
    expect(formatDayLabel("2026-07-15")).toBe("Jul 15");
  });
  it("handles end-of-year dates", () => {
    expect(formatDayLabel("2026-12-31")).toBe("Dec 31");
  });
  it("handles first-of-year dates", () => {
    expect(formatDayLabel("2026-01-01")).toBe("Jan 1");
  });
});

describe("buildThroughputOption", () => {
  it("returns null when all days are gaps", () => {
    expect(buildThroughputOption([makeDay("2026-07-01", { isGap: true }), makeDay("2026-07-02", { isGap: true })])).toBeNull();
  });
  it("returns null when no metrics present", () => {
    expect(buildThroughputOption([makeDay("2026-07-01", { metrics: null })])).toBeNull();
  });
  it("returns a line option with category x-axis for valid days", () => {
    const opt = buildThroughputOption([makeDay("2026-07-01"), makeDay("2026-07-02")]);
    expect(opt).not.toBeNull();
    expect((opt!.xAxis as { type: string }).type).toBe("category");
    expect((opt!.series as Array<{ type: string }>)[0].type).toBe("line");
  });
  it("treats gap days as null values in the series", () => {
    const opt = buildThroughputOption([makeDay("2026-07-01"), makeDay("2026-07-02", { isGap: true })]);
    const values = (opt!.series as Array<{ data: Array<number | null> }>)[0].data;
    expect(values[1]).toBeNull();
    expect(values[0]).toBe(8);
  });
});

describe("buildCycleTimeOption", () => {
  it("returns null when no median cycle time exists", () => {
    expect(buildCycleTimeOption([makeDay("2026-07-01", { metrics: { day: "2026-07-01", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: null } })])).toBeNull();
  });
  it("returns a line option for valid days", () => {
    const opt = buildCycleTimeOption([makeDay("2026-07-01"), makeDay("2026-07-02")]);
    expect(opt).not.toBeNull();
    expect((opt!.series as Array<{ type: string }>)[0].type).toBe("line");
  });
});

describe("buildCIOption", () => {
  it("returns null when all days are gaps", () => {
    expect(buildCIOption([makeDay("2026-07-01", { isGap: true })])).toBeNull();
  });
  it("returns a stacked bar option for valid days", () => {
    const opt = buildCIOption([makeDay("2026-07-01"), makeDay("2026-07-02")]);
    expect(opt).not.toBeNull();
    const series = opt!.series as Array<{ type: string; stack?: string }>;
    expect(series[0].type).toBe("bar");
    expect(series[0].stack).toBe("ci");
    expect(series[1].stack).toBe("ci");
  });
});

describe("computeThroughputFooter", () => {
  it("returns Insufficient data for < 2 days", () => {
    expect(computeThroughputFooter([makeDay("2026-07-01")])).toBe("Insufficient data");
  });
  it("computes percentage change with arrow", () => {
    const days = [makeDay("2026-07-01", { metrics: { day: "2026-07-01", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 4, prsMerged: 2, medianCycleTimeSeconds: 86400 } }), makeDay("2026-07-02", { metrics: { day: "2026-07-02", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 8, prsMerged: 4, medianCycleTimeSeconds: 86400 } })];
    expect(computeThroughputFooter(days)).toContain("this window");
  });
  it("shows em dash when prev sum is 0", () => {
    const days = [makeDay("2026-07-01", { metrics: { day: "2026-07-01", ciPassCount: 0, ciFailCount: 0, ciTotalRuns: 0, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: null } }), makeDay("2026-07-02")];
    expect(computeThroughputFooter(days)).toContain("—");
  });
});

describe("computeCycleTimeFooter", () => {
  it("returns insufficient PR data message when < 3 valid days", () => {
    expect(computeCycleTimeFooter([makeDay("2026-07-01")])).toBe("Insufficient PR data for cycle time trend");
  });
  it("returns trend summary for valid days", () => {
    const days = [
      makeDay("2026-07-01", { metrics: { day: "2026-07-01", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: 172800 } }),
      makeDay("2026-07-02", { metrics: { day: "2026-07-02", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: 86400 } }),
      makeDay("2026-07-03", { metrics: { day: "2026-07-03", ciPassCount: 1, ciFailCount: 0, ciTotalRuns: 1, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: 43200 } }),
    ];
    const footer = computeCycleTimeFooter(days);
    expect(footer).toContain("latest");
    expect(footer).toContain("Improving");
  });
});

describe("computeCIFooter", () => {
  it("returns Insufficient data for < 2 days", () => {
    expect(computeCIFooter([makeDay("2026-07-01")])).toBe("Insufficient data");
  });
  it("returns No runs message when no CI ran in second half", () => {
    const days = [makeDay("2026-07-01"), makeDay("2026-07-02", { metrics: { day: "2026-07-02", ciPassCount: 0, ciFailCount: 0, ciTotalRuns: 0, issuesClosed: 0, prsMerged: 0, medianCycleTimeSeconds: null } })];
    expect(computeCIFooter(days)).toBe("No runs this window");
  });
  it("computes pass rate percentage", () => {
    const days = [makeDay("2026-07-01"), makeDay("2026-07-02")];
    expect(computeCIFooter(days)).toContain("% pass rate");
  });
});
