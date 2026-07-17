import {
  throughputStatus,
  cycleTimeStatus,
  ciStatus,
  staleWorkStatus,
  overallScore,
  overallLabel,
  overallStatus,
} from "@/lib/health/status";
import type {
  DashboardWindowCards,
  DashboardWindowThroughputSummary,
  DashboardWindowCycleTimeSummary,
  DashboardWindowCISummary,
  DashboardWindowStaleWorkSummary,
} from "@/types";

describe("throughputStatus", () => {
  it("returns unknown when status is undefined", () => {
    expect(throughputStatus(undefined)).toBe("unknown");
  });
  it("returns unknown when status is empty string", () => {
    expect(throughputStatus("")).toBe("unknown");
  });
  it("returns healthy for available", () => {
    expect(throughputStatus("available")).toBe("healthy");
  });
  it("returns warning for partial", () => {
    expect(throughputStatus("partial")).toBe("warning");
  });
  it("returns warning for stale", () => {
    expect(throughputStatus("stale")).toBe("warning");
  });
  it("returns empty for empty", () => {
    expect(throughputStatus("empty")).toBe("empty");
  });
  it("returns critical for anything else", () => {
    expect(throughputStatus("unavailable")).toBe("critical");
    expect(throughputStatus("error")).toBe("critical");
  });
});

describe("cycleTimeStatus", () => {
  it("returns unknown when card is undefined", () => {
    expect(cycleTimeStatus(undefined)).toBe("unknown");
  });
  it("returns critical for error/unavailable/unconfigured", () => {
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: null, status: "error" })).toBe("critical");
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: null, status: "unavailable" })).toBe("critical");
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: null, status: "unconfigured" })).toBe("critical");
  });
  it("returns empty when status is empty", () => {
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: null, status: "empty" })).toBe("empty");
  });
  it("returns empty when no seconds available", () => {
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: null, status: "available" })).toBe("empty");
  });
  it("returns healthy when <= 3 days", () => {
    expect(cycleTimeStatus({ medianSeconds: 2 * 86400, averageSeconds: null, status: "available" })).toBe("healthy");
  });
  it("returns warning when <= 7 days", () => {
    expect(cycleTimeStatus({ medianSeconds: 5 * 86400, averageSeconds: null, status: "available" })).toBe("warning");
  });
  it("returns critical when > 7 days", () => {
    expect(cycleTimeStatus({ medianSeconds: 10 * 86400, averageSeconds: null, status: "available" })).toBe("critical");
  });
  it("falls back to averageSeconds when median is null", () => {
    expect(cycleTimeStatus({ medianSeconds: null, averageSeconds: 1 * 86400, status: "available" })).toBe("healthy");
  });
});

describe("ciStatus", () => {
  it("returns unknown when card is undefined", () => {
    expect(ciStatus(undefined)).toBe("unknown");
  });
  it("returns critical for error states", () => {
    expect(ciStatus({ passRate: null, status: "error" })).toBe("critical");
  });
  it("returns empty for empty status", () => {
    expect(ciStatus({ passRate: null, status: "empty" })).toBe("empty");
  });
  it("returns empty when passRate is null", () => {
    expect(ciStatus({ passRate: null, status: "available" })).toBe("empty");
  });
  it("returns healthy at >= 0.9", () => {
    expect(ciStatus({ passRate: 0.95, status: "available" })).toBe("healthy");
  });
  it("returns warning at >= 0.7", () => {
    expect(ciStatus({ passRate: 0.75, status: "available" })).toBe("warning");
  });
  it("returns critical below 0.7", () => {
    expect(ciStatus({ passRate: 0.5, status: "available" })).toBe("critical");
  });
});

describe("staleWorkStatus", () => {
  it("returns unknown when card is undefined", () => {
    expect(staleWorkStatus(undefined)).toBe("unknown");
  });
  it("returns critical for error states", () => {
    expect(staleWorkStatus({ staleIssues: 0, stalePrs: 0, status: "error" })).toBe("critical");
  });
  it("returns empty for empty status", () => {
    expect(staleWorkStatus({ staleIssues: 0, stalePrs: 0, status: "empty" })).toBe("empty");
  });
  it("returns healthy when total is 0", () => {
    expect(staleWorkStatus({ staleIssues: 0, stalePrs: 0, status: "available" })).toBe("healthy");
  });
  it("returns warning when total <= 3", () => {
    expect(staleWorkStatus({ staleIssues: 2, stalePrs: 1, status: "available" })).toBe("warning");
  });
  it("returns critical when total > 3", () => {
    expect(staleWorkStatus({ staleIssues: 2, stalePrs: 3, status: "available" })).toBe("critical");
  });
});

describe("overallScore", () => {
  const makeCards = (
    partial: Partial<DashboardWindowCards> = {},
  ): DashboardWindowCards => {
    const throughput: DashboardWindowThroughputSummary = { issuesOpened: 0, issuesClosed: 0, prsCreated: 0, prsMerged: 0, totalCommits: 0, status: "unavailable", message: null };
    const cycleTime: DashboardWindowCycleTimeSummary = { averageSeconds: null, medianSeconds: null, p95Seconds: null, sampleSize: 0, sourceDay: null, status: "empty", message: null };
    const ci: DashboardWindowCISummary = { totalRuns: 0, passCount: 0, failCount: 0, passRate: null, averageDurationMs: null, sourceDays: 0, status: "empty", message: null };
    const staleWork: DashboardWindowStaleWorkSummary = { staleIssues: 0, stalePrs: 0, capturedAt: null, reflectsCompleteData: null, status: "empty", message: null };
    return {
      throughput, cycleTime, ci, staleWork,
      sessionUsage: {} as DashboardWindowCards["sessionUsage"],
      ...partial,
    };
  };

  it("returns 0 when cards is null", () => {
    expect(overallScore(null)).toBe(0);
  });
  it("returns 0 when no signals are healthy", () => {
    expect(overallScore(makeCards())).toBe(0);
  });
  it("returns 4 when all signals are healthy", () => {
    const cards = makeCards({
      throughput: { issuesOpened: 0, issuesClosed: 0, prsCreated: 0, prsMerged: 0, totalCommits: 0, status: "available", message: null },
      cycleTime: { averageSeconds: null, medianSeconds: 86400, p95Seconds: null, sampleSize: 1, sourceDay: null, status: "available", message: null },
      ci: { totalRuns: 10, passCount: 10, failCount: 0, passRate: 1, averageDurationMs: null, sourceDays: 1, status: "available", message: null },
      staleWork: { staleIssues: 0, stalePrs: 0, capturedAt: null, reflectsCompleteData: null, status: "available", message: null },
    });
    expect(overallScore(cards)).toBe(4);
  });
  it("returns partial score for mixed health", () => {
    const cards = makeCards({
      throughput: { issuesOpened: 0, issuesClosed: 0, prsCreated: 0, prsMerged: 0, totalCommits: 0, status: "available", message: null },
      ci: { totalRuns: 10, passCount: 10, failCount: 0, passRate: 1, averageDurationMs: null, sourceDays: 1, status: "available", message: null },
    });
    expect(overallScore(cards)).toBe(2);
  });
});

describe("overallLabel", () => {
  it("maps 4 to Healthy", () => expect(overallLabel(4)).toBe("Healthy"));
  it("maps 3 to Fair", () => expect(overallLabel(3)).toBe("Fair"));
  it("maps 2 to Watch", () => expect(overallLabel(2)).toBe("Watch"));
  it("maps 1 to At Risk", () => expect(overallLabel(1)).toBe("At Risk"));
  it("maps 0 to Critical", () => expect(overallLabel(0)).toBe("Critical"));
});

describe("overallStatus", () => {
  it("returns healthy at >= 4", () => expect(overallStatus(4)).toBe("healthy"));
  it("returns warning at >= 2", () => expect(overallStatus(2)).toBe("warning"));
  it("returns critical at >= 1", () => expect(overallStatus(1)).toBe("critical"));
  it("returns empty at 0", () => expect(overallStatus(0)).toBe("empty"));
});
