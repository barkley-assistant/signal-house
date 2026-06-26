import { GET } from "./route";
import { getDailyMetricsRange, getDailyTokenUsageRange, getLatestState } from "../../../../../server/db/client";
import { buildDashboardWindow } from "../../../../../server/lib/dashboard-state";
import type { DashboardWindow, LatestState } from "@/types";

jest.mock("../../../../../server/db/client", () => ({
  initDb: jest.fn().mockResolvedValue({}),
  getLatestState: jest.fn(),
  getDailyMetricsRange: jest.fn(),
  getDailyTokenUsageRange: jest.fn(),
}));

jest.mock("../../../../../server/lib/dashboard-state", () => ({
  buildDashboardWindow: jest.fn(),
}));

jest.mock("../../../../../server/lib/runtime-config", () => ({
  getDashboardWindowDays: jest.fn(() => 28),
}));

function makeLatestState(): LatestState {
  return {
    snapshot: {
      id: "snap-1",
      capturedAt: "2026-06-23T10:00:00.000Z",
      issues: [
        {
          id: "issue-1",
          title: "Investigate stale issue",
          state: "open",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          closedAt: null,
          repo: "demo/repo",
          repoKey: "github:demo/repo",
          labels: [],
          assignee: null,
          milestone: null,
          url: "https://example.test/issues/1",
        },
      ],
      pullRequests: [],
      workflowRuns: [],
      repositories: [],
      sessions: [],
      localGit: [],
      errors: [],
      aggregates: {
        throughput: {
          periodStart: "2026-05-27",
          periodEnd: "2026-06-23",
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: {
          periodStart: "2026-05-27",
          periodEnd: "2026-06-23",
          averageDays: 0,
          medianDays: 0,
          p95Days: 0,
          sampleSize: 0,
        },
        ci: {
          periodStart: "2026-05-27",
          periodEnd: "2026-06-23",
          totalRuns: 0,
          passCount: 0,
          failCount: 0,
          passRate: 0,
          averageDurationMs: null,
        },
        staleWork: {
          asOf: "2026-06-23T10:00:00.000Z",
          staleIssues: 1,
          stalePRs: 0,
          staleThresholdDays: 14,
          oldestItemDays: 22,
        },
        sessionUsage: null,
        tokenUsage: {
          periodStart: "2026-05-27",
          periodEnd: "2026-06-23",
          source: "opencode",
          toolName: "opencode",
          totalSessions: 2,
          totalMessages: 4,
          totalTokens: 100,
          totalCost: 1.25,
          modelUsage: [],
          rawJson: null,
          collectedAt: "2026-06-23T10:00:00.000Z",
        },
        computedAt: "2026-06-23T10:00:00.000Z",
      },
      metadata: {
        source: "orchestrated",
        refreshDurationMs: 100,
        partialData: false,
        errors: [],
      },
    },
    lastRefreshAt: "2026-06-23T10:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-23T10:00:00.000Z",
    refreshInProgress: false,
    isStale: false,
    staleReason: null,
    pollerEnabled: false,
    refreshStatus: "idle",
    lastFailureAt: null,
    lastSuccessAt: "2026-06-23T10:00:00.000Z",
    nextRunAt: null,
    dashboardWindow: null,
    refreshState: {
      status: "idle",
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastSuccessAt: "2026-06-23T10:00:00.000Z",
      lastFailureAt: null,
      nextRunAt: null,
      lastError: null,
      durationMs: null,
      sourceHealth: {},
      runHistory: [],
    },
    diagnostics: {
      configuredProjectRoots: [],
      discoveredRepos: [],
      skippedPaths: [],
      parsedGitHubRemotes: [],
      collectionTargets: [],
      cacheAgeSeconds: null,
      pollerEnabled: false,
      pollerIntervalSeconds: null,
      lastSuccessfulRefreshAt: "2026-06-23T10:00:00.000Z",
      lastError: null,
      sourceHealth: {},
    },
  };
}

function makeDashboardWindow(): DashboardWindow {
  return {
    startDay: "2026-05-27",
    endDay: "2026-06-23",
    days: [{ day: "2026-06-23", isGap: false, metrics: null }],
    missingDays: [],
    latestDay: null,
    sessionUsage: null,
    cards: {
      throughput: {
        issuesOpened: 1,
        issuesClosed: 2,
        prsCreated: 3,
        prsMerged: 4,
        totalCommits: 5,
        status: "available",
        message: null,
      },
      cycleTime: {
        averageDays: null,
        medianDays: null,
        p95Days: null,
        sampleSize: 0,
        sourceDay: null,
        status: "empty",
        message: null,
      },
      ci: {
        totalRuns: 0,
        passCount: 0,
        failCount: 0,
        passRate: null,
        averageDurationMs: null,
        sourceDays: 0,
        status: "empty",
        message: null,
      },
      staleWork: {
        staleIssues: 1,
        stalePrs: 0,
        capturedAt: "2026-06-23T10:00:00.000Z",
        reflectsCompleteData: true,
        status: "available",
        message: null,
      },
      sessionUsage: {
        totalSessions: 0,
        sessionErrorCount: 0,
        startedSessions: null,
        completedSessions: null,
        erroredSessions: null,
        stuckSessions: null,
        lastActivityAt: null,
        status: "empty",
        message: null,
      },
    },
    coverage: {
      totalDays: 28,
      daysWithData: 1,
      missingDays: 27,
      hasGaps: true,
      hasSourceWarnings: false,
      isComplete: false,
    },
    warnings: ["partial window"],
  };
}

describe("GET /api/state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getLatestState as jest.Mock).mockReturnValue(makeLatestState());
    (getDailyMetricsRange as jest.Mock).mockReturnValue([{ day: "2026-06-23" }]);
    (getDailyTokenUsageRange as jest.Mock).mockReturnValue([]);
    (buildDashboardWindow as jest.Mock).mockReturnValue(makeDashboardWindow());
  });

  it("returns the compact dashboard state contract", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      window: {
        startDay: "2026-05-27",
        endDay: "2026-06-23",
        warnings: ["partial window"],
      },
      summary: {
        throughput: {
          totalCommits: 5,
        },
      },
      usage: {
        sessionUsage: null,
        tokenUsage: {
          totalTokens: 100,
        },
      },
      attention: {
        staleThresholdDays: 14,
        items: [
          {
            id: "issue-issue-1",
            kind: "issue",
            title: "Investigate stale issue",
            repo: "demo/repo",
            priorityTier: "stale",
            statusLabel: "Stale",
          },
        ],
      },
      status: {
        lastSuccessfulRefreshAt: "2026-06-23T10:00:00.000Z",
        refreshInProgress: false,
      },
      diagnostics: {
        sourceHealth: {},
      },
    });
    expect(body).not.toHaveProperty("snapshot");
    expect(body).not.toHaveProperty("dashboardWindow");
    expect(body).not.toHaveProperty("refreshState");
  });

  it("ignores legacy repoKey query arguments", async () => {
    const legacyRequest = new Request("http://localhost/api/state?repoKey=github:demo/repo");
    const response = await (GET as unknown as (request: Request) => Promise<Response>)(legacyRequest);
    const body = await response.json();

    expect(getDailyMetricsRange).toHaveBeenCalledTimes(1);
    expect(body.summary.throughput.totalCommits).toBe(5);
    expect(body).not.toHaveProperty("selectedRepoKey");
  });
});
