import { GET } from "./route";
import { getDailyMetricsRange, getDailyTokenUsageRangeForSource, getLatestState } from "../../../../../server/db/client";
import { buildDashboardWindow } from "../../../../../server/lib/dashboard-state";
import { getShowPrivateRepoItems } from "../../../../../server/lib/runtime-config";
import type { DashboardWindow, LatestState } from "@/types";

jest.mock("../../../../../server/db/client", () => ({
  initDb: jest.fn().mockResolvedValue({}),
  getLatestState: jest.fn(),
  getDailyMetricsRange: jest.fn(),
  getDailyTokenUsageRangeForSource: jest.fn(),
}));

jest.mock("../../../../../server/lib/dashboard-state", () => ({
  buildDashboardWindow: jest.fn(),
}));

jest.mock("../../../../../server/lib/runtime-config", () => ({
  getDashboardWindowDays: jest.fn(() => 28),
  getShowPrivateRepoItems: jest.fn(() => false),
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
          averageSeconds: 0,
          medianSeconds: 0,
          p95Seconds: 0,
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
          source: "opencodedb",
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
      historicalRepos: [],
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
        averageSeconds: null,
        medianSeconds: null,
        p95Seconds: null,
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
    (getDailyTokenUsageRangeForSource as jest.Mock).mockReturnValue([]);
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
        hermesTokenUsage: null,
      },
      attention: {
        staleThresholdDays: 14,
        items: [
          {
            id: "issue-github:demo/repo-issue-1",
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

  it("includes hermesTokenUsage in usage response when aggregate is present", async () => {
    const state = makeLatestState();
    state.snapshot!.aggregates.hermesTokenUsage = {
      periodStart: "2026-05-27",
      periodEnd: "2026-06-23",
      source: "hermesdb",
      toolName: "hermes-agent",
      totalSessions: 3,
      totalMessages: 5,
      totalTokens: 200,
      totalCost: 2.5,
      modelUsage: [],
      rawJson: null,
      collectedAt: "2026-06-23T10:00:00.000Z",
    };
    (getLatestState as jest.Mock).mockReturnValue(state);

    const response = await GET();
    const body = await response.json();

    expect(body.usage.hermesTokenUsage).not.toBeNull();
    expect(body.usage.hermesTokenUsage.toolName).toBe("hermes-agent");
    expect(body.usage.hermesTokenUsage.totalTokens).toBe(200);
  });

  it("returns hermesTokenUsage as null when snapshot is null", async () => {
    const state = makeLatestState();
    state.snapshot = null;
    (getLatestState as jest.Mock).mockReturnValue(state);

    const response = await GET();
    const body = await response.json();

    expect(body.usage.hermesTokenUsage).toBeNull();
  });

  it("ignores legacy repoKey query arguments", async () => {
    const legacyRequest = new Request("http://localhost/api/state?repoKey=github:demo/repo");
    const response = await (GET as unknown as (request: Request) => Promise<Response>)(legacyRequest);
    const body = await response.json();

    expect(getDailyMetricsRange).toHaveBeenCalledTimes(1);
    expect(body.summary.throughput.totalCommits).toBe(5);
    expect(body).not.toHaveProperty("selectedRepoKey");
  });

  it("hides private repo issues from the attention queue by default", async () => {
    const state = makeLatestState();
    state.snapshot!.repositories = [
      { repoKey: "github:demo/repo", name: "demo/repo", localPath: null, remoteUrl: null, githubOwner: "demo", githubRepo: "repo", source: "github" },
      { repoKey: "github:demo/secret", name: "demo/secret", localPath: null, remoteUrl: null, githubOwner: "demo", githubRepo: "secret", source: "github" },
    ];
    state.snapshot!.aggregates.repositoryPrivacy = {
      privacyMap: { "github:demo/repo": false, "github:demo/secret": true },
    };
    state.snapshot!.issues = [
      {
        id: "issue-1",
        title: "Public issue",
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
      {
        id: "issue-2",
        title: "Private issue",
        state: "open",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        closedAt: null,
        repo: "demo/secret",
        repoKey: "github:demo/secret",
        labels: [],
        assignee: null,
        milestone: null,
        url: "https://example.test/issues/2",
      },
    ];
    state.snapshot!.pullRequests = [
      {
        id: "pr-1",
        title: "Private PR",
        state: "open",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        headSha: null,
        mergedAt: null,
        closedAt: null,
        repo: "demo/secret",
        repoKey: "github:demo/secret",
        author: "alice",
        labels: [],
        additions: null,
        deletions: null,
        changedFiles: null,
        url: "https://example.test/pulls/1",
        ciStatus: null,
      },
    ];
    (getLatestState as jest.Mock).mockReturnValue(state);
    (getShowPrivateRepoItems as jest.Mock).mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attention.items).toHaveLength(1);
    expect(body.attention.items[0]).toMatchObject({
      id: "issue-github:demo/repo-issue-1",
      kind: "issue",
      title: "Public issue",
      repo: "demo/repo",
    });
  });

  it("includes private repo issues when SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS=true", async () => {
    const state = makeLatestState();
    state.snapshot!.repositories = [
      { repoKey: "github:demo/repo", name: "demo/repo", localPath: null, remoteUrl: null, githubOwner: "demo", githubRepo: "repo", source: "github" },
      { repoKey: "github:demo/secret", name: "demo/secret", localPath: null, remoteUrl: null, githubOwner: "demo", githubRepo: "secret", source: "github" },
    ];
    state.snapshot!.aggregates.repositoryPrivacy = {
      privacyMap: { "github:demo/repo": false, "github:demo/secret": true },
    };
    state.snapshot!.issues = [
      {
        id: "issue-1",
        title: "Public issue",
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
      {
        id: "issue-2",
        title: "Private issue",
        state: "open",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        closedAt: null,
        repo: "demo/secret",
        repoKey: "github:demo/secret",
        labels: [],
        assignee: null,
        milestone: null,
        url: "https://example.test/issues/2",
      },
    ];
    (getLatestState as jest.Mock).mockReturnValue(state);
    (getShowPrivateRepoItems as jest.Mock).mockReturnValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.attention.items).toHaveLength(2);
    const repos = body.attention.items.map((item: { repo: string }) => item.repo);
    expect(repos).toEqual(expect.arrayContaining(["demo/repo", "demo/secret"]));
  });
});
