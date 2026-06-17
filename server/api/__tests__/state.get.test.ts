import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockSetHeader: vi.fn(),
  mockGetQuery: vi.fn(),
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetLatestState: vi.fn(),
  mockGetDailyMetricsRange: vi.fn(),
  mockGetDailyMetricsRangeForRepo: vi.fn(),
}))

vi.mock('h3', () => ({
  defineEventHandler: (handler: Function) => handler,
  setHeader: mocks.mockSetHeader,
  getQuery: mocks.mockGetQuery,
}))

vi.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getLatestState: mocks.mockGetLatestState,
  getDailyMetricsRange: mocks.mockGetDailyMetricsRange,
  getDailyMetricsRangeForRepo: mocks.mockGetDailyMetricsRangeForRepo,
}))

import handler from '../state.get'

describe('GET /api/state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    vi.clearAllMocks()
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test')
    vi.stubEnv('GITHUB_OWNER', 'barkley-clawd')
    vi.stubEnv('SECRET_HOUSE_GITHUB_REPO', 'signal-house')
    vi.stubEnv('SECRET_HOUSE_GIT_REPOS', '/tmp/repo-a')
    vi.stubEnv('SECRET_HOUSE_SESSIONS_PERIOD_DAYS', '30')
    mocks.mockGetQuery.mockReturnValue({})
    mocks.mockGetLatestState.mockReturnValue({
      snapshot: null,
      lastRefreshAt: null,
      lastSuccessfulRefreshAt: null,
      refreshInProgress: false,
      isStale: true,
      dashboardWindow: null,
      diagnostics: {
        configuredProjectRoots: ['/workspace'],
        discoveredRepos: [],
        skippedPaths: [],
        parsedGitHubRemotes: [],
        collectionTargets: [],
        cacheAgeSeconds: null,
        pollerEnabled: false,
        pollerIntervalSeconds: 300,
        lastSuccessfulRefreshAt: null,
        lastError: null,
        sourceHealth: {},
      },
    })
    mocks.mockGetDailyMetricsRange.mockReturnValue([])
    mocks.mockGetDailyMetricsRangeForRepo.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('sets Cache-Control: no-cache header', async () => {
    const mockEvent = {} as any
    await handler(mockEvent)
    expect(mocks.mockSetHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
  })

  it('initializes the database', async () => {
    await handler({} as any)
    expect(mocks.mockInitDb).toHaveBeenCalledOnce()
  })

  it('returns the latest state with a normalized 28-day dashboard window', async () => {
    const state = {
      snapshot: {
        id: 'snap-1',
        capturedAt: new Date().toISOString(),
        aggregates: {
          sessionUsage: {
            periodStart: '2026-05-18T00:00:00Z',
            periodEnd: '2026-06-14T12:00:00Z',
            totalSessions: 17,
            startedSessions: 5,
            completedSessions: 4,
            erroredSessions: 1,
            stuckSessions: 1,
            lastActivityAt: '2026-06-14T11:30:00Z',
            messages: 28,
            activeDays: 2,
            totalCost: 12.34,
            averageCostPerDay: 6.17,
            averageTokensPerSession: 100,
            medianTokensPerSession: 80,
            inputTokens: 60,
            outputTokens: 30,
            cacheReadTokens: 5,
            cacheWriteTokens: 10,
            uniqueTools: ['edit', 'search'],
            toolUsage: [
              { toolName: 'edit', count: 1, percentage: 50 },
              { toolName: 'search', count: 1, percentage: 50 },
            ],
            topActions: [
              { action: 'edit', count: 1 },
              { action: 'search', count: 1 },
            ],
            errorCount: 3,
          },
        },
      },
      lastRefreshAt: '2026-06-14T12:00:00.000Z',
      lastSuccessfulRefreshAt: '2026-06-14T12:00:00.000Z',
      refreshInProgress: false,
      isStale: false,
      dashboardWindow: null,
      diagnostics: {
        configuredProjectRoots: ['/workspace'],
        discoveredRepos: [],
        skippedPaths: [],
        parsedGitHubRemotes: [],
        collectionTargets: ['github', 'localGit'],
        cacheAgeSeconds: 0,
        pollerEnabled: true,
        pollerIntervalSeconds: 300,
        lastSuccessfulRefreshAt: '2026-06-14T12:00:00.000Z',
        lastError: null,
        sourceHealth: {},
      },
    }
    const rows = [
      {
        day: '2026-06-14',
        repoKey: 'all',
        capturedAt: '2026-06-14T12:00:00.000Z',
        source: 'orchestrated',
        version: 1,
        reflectsCompleteData: true,
        issuesOpened: 3,
        issuesClosed: 4,
        prsCreated: 5,
        prsMerged: 6,
        totalCommits: 7,
        avgCycleTimeDays: 2.5,
        medianCycleTimeDays: 2,
        p95CycleTimeDays: 4,
        cycleTimeSampleSize: 8,
        ciTotalRuns: 10,
        ciPassCount: 8,
        ciFailCount: 2,
        ciPassRate: 0.8,
        ciAvgDurationMs: 1200,
        totalSessions: 11,
        sessionErrorCount: 1,
        staleIssues: 2,
        stalePrs: 1,
        warnings: [],
        createdAt: '2026-06-14T12:00:00.000Z',
      },
      {
        day: '2026-06-12',
        repoKey: 'all',
        capturedAt: '2026-06-12T12:00:00.000Z',
        source: 'orchestrated',
        version: 1,
        reflectsCompleteData: false,
        issuesOpened: 1,
        issuesClosed: 2,
        prsCreated: 3,
        prsMerged: 4,
        totalCommits: 5,
        avgCycleTimeDays: null,
        medianCycleTimeDays: null,
        p95CycleTimeDays: null,
        cycleTimeSampleSize: 0,
        ciTotalRuns: 0,
        ciPassCount: 0,
        ciFailCount: 0,
        ciPassRate: null,
        ciAvgDurationMs: null,
        totalSessions: 6,
        sessionErrorCount: 2,
        staleIssues: 4,
        stalePrs: 3,
        warnings: ['Partial data: local git unavailable'],
        createdAt: '2026-06-12T12:00:00.000Z',
      },
    ]
    mocks.mockGetLatestState.mockReturnValue(state)
    mocks.mockGetDailyMetricsRange.mockReturnValue(rows)

    const result = await handler({} as any)

    expect(mocks.mockGetDailyMetricsRange).toHaveBeenCalledWith('2026-05-18', '2026-06-14')
    expect(mocks.mockGetLatestState).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      ...state,
      dashboardWindow: {
        startDay: '2026-05-18',
        endDay: '2026-06-14',
        missingDays: expect.arrayContaining(['2026-06-13']),
        sessionUsage: {
          periodStart: '2026-05-18T00:00:00Z',
          periodEnd: '2026-06-14T12:00:00Z',
          totalSessions: 17,
          startedSessions: 5,
          completedSessions: 4,
          erroredSessions: 1,
          stuckSessions: 1,
          lastActivityAt: '2026-06-14T11:30:00Z',
          messages: 28,
          activeDays: 2,
          totalCost: 12.34,
          averageCostPerDay: 6.17,
          averageTokensPerSession: 100,
          medianTokensPerSession: 80,
          inputTokens: 60,
          outputTokens: 30,
          cacheReadTokens: 5,
          cacheWriteTokens: 10,
          uniqueTools: ['edit', 'search'],
          toolUsage: [
            { toolName: 'edit', count: 1, percentage: 50 },
            { toolName: 'search', count: 1, percentage: 50 },
          ],
          topActions: [
            { action: 'edit', count: 1 },
            { action: 'search', count: 1 },
          ],
          errorCount: 3,
          status: 'available',
          message: null,
        },
        cards: {
          throughput: {
            issuesOpened: 4,
            issuesClosed: 6,
            prsCreated: 8,
            prsMerged: 10,
            totalCommits: 12,
            status: 'partial',
            message: 'Partial data - one or more throughput sources failed during the last refresh',
          },
          cycleTime: {
            averageDays: 2.5,
            medianDays: 2,
            p95Days: 4,
            sampleSize: 8,
            sourceDay: '2026-06-14',
            status: 'available',
            message: null,
          },
          ci: {
            totalRuns: 10,
            passCount: 8,
            failCount: 2,
            passRate: 0.8,
            averageDurationMs: 1200,
            sourceDays: 1,
            status: 'available',
            message: null,
          },
          staleWork: {
            staleIssues: 2,
            stalePrs: 1,
            capturedAt: '2026-06-14T12:00:00.000Z',
            reflectsCompleteData: true,
            status: 'available',
            message: null,
          },
          sessionUsage: {
          totalSessions: 17,
          startedSessions: 5,
          completedSessions: 4,
          erroredSessions: 1,
          stuckSessions: 1,
          lastActivityAt: '2026-06-14T11:30:00Z',
          sessionErrorCount: 3,
          status: 'available',
          message: null,
          },
        },
        coverage: {
          totalDays: 28,
          daysWithData: 2,
          missingDays: 26,
          hasGaps: true,
          hasSourceWarnings: true,
          isComplete: false,
        },
      },
    })

    expect(result.dashboardWindow.latestDay?.day).toBe('2026-06-14')

    expect(result.dashboardWindow.days).toHaveLength(28)
    expect(result.dashboardWindow.days[0]).toMatchObject({ day: '2026-05-18', isGap: true, metrics: null })
    expect(result.dashboardWindow.days.at(-1)).toMatchObject({ day: '2026-06-14', isGap: false })
    expect(result.dashboardWindow.warnings).toEqual(
      expect.arrayContaining([
        'Partial data: local git unavailable',
        'Missing 26 of 28 days in the rolling window',
      ]),
    )
  })

  it('propagates refreshInProgress from the database', async () => {
    mocks.mockGetLatestState.mockReturnValue({
      snapshot: null,
      lastRefreshAt: null,
      lastSuccessfulRefreshAt: null,
      refreshInProgress: true,
      isStale: true,
      dashboardWindow: null,
    })

    const result = await handler({} as any)
    expect(result.refreshInProgress).toBe(true)
  })

  it('filters the dashboard view to a selected repo', async () => {
    const snapshot = {
      id: 'snap-2',
      capturedAt: '2026-06-14T12:00:00.000Z',
      issues: [
        {
          id: 'issue-a',
          title: 'Repo A issue',
          state: 'open',
          createdAt: '2026-06-14T09:00:00.000Z',
          updatedAt: '2026-06-14T09:00:00.000Z',
          closedAt: null,
          repo: 'demo/repo-a',
          repoKey: 'github:demo/repo-a',
          labels: [],
          assignee: null,
          milestone: null,
          url: 'https://github.com/demo/repo-a/issues/1',
        },
        {
          id: 'issue-b',
          title: 'Repo B issue',
          state: 'open',
          createdAt: '2026-06-14T09:00:00.000Z',
          updatedAt: '2026-06-14T09:00:00.000Z',
          closedAt: null,
          repo: 'demo/repo-b',
          repoKey: 'github:demo/repo-b',
          labels: [],
          assignee: null,
          milestone: null,
          url: 'https://github.com/demo/repo-b/issues/2',
        },
      ],
      pullRequests: [
        {
          id: 'pr-a',
          title: 'Repo A PR',
          state: 'merged',
          createdAt: '2026-06-13T09:00:00.000Z',
          updatedAt: '2026-06-14T09:00:00.000Z',
          headSha: null,
          mergedAt: '2026-06-14T10:00:00.000Z',
          closedAt: '2026-06-14T10:00:00.000Z',
          repo: 'demo/repo-a',
          repoKey: 'github:demo/repo-a',
          author: 'a',
          labels: [],
          additions: null,
          deletions: null,
          changedFiles: null,
          url: 'https://github.com/demo/repo-a/pull/1',
          ciStatus: 'success',
        },
        {
          id: 'pr-b',
          title: 'Repo B PR',
          state: 'open',
          createdAt: '2026-06-13T09:00:00.000Z',
          updatedAt: '2026-06-14T09:00:00.000Z',
          headSha: null,
          mergedAt: null,
          closedAt: null,
          repo: 'demo/repo-b',
          repoKey: 'github:demo/repo-b',
          author: 'b',
          labels: [],
          additions: null,
          deletions: null,
          changedFiles: null,
          url: 'https://github.com/demo/repo-b/pull/2',
          ciStatus: 'failure',
        },
      ],
      workflowRuns: [
        {
          id: 'run-a',
          name: 'Repo A run',
          status: 'completed',
          conclusion: 'success',
          createdAt: '2026-06-14T08:00:00.000Z',
          completedAt: '2026-06-14T09:00:00.000Z',
          headSha: null,
          repo: 'demo/repo-a',
          repoKey: 'github:demo/repo-a',
          branch: 'main',
          workflowName: 'CI',
          url: null,
        },
        {
          id: 'run-b',
          name: 'Repo B run',
          status: 'completed',
          conclusion: 'failure',
          createdAt: '2026-06-14T08:00:00.000Z',
          completedAt: '2026-06-14T09:00:00.000Z',
          headSha: null,
          repo: 'demo/repo-b',
          repoKey: 'github:demo/repo-b',
          branch: 'main',
          workflowName: 'CI',
          url: null,
        },
      ],
      repositories: [
        {
          repoKey: 'github:demo/repo-a',
          name: 'repo-a',
          localPath: null,
          remoteUrl: 'https://github.com/demo/repo-a',
          githubOwner: 'demo',
          githubRepo: 'repo-a',
          source: 'github',
        },
        {
          repoKey: 'github:demo/repo-b',
          name: 'repo-b',
          localPath: null,
          remoteUrl: 'https://github.com/demo/repo-b',
          githubOwner: 'demo',
          githubRepo: 'repo-b',
          source: 'github',
        },
      ],
      sessions: [],
      localGit: [
        {
          repoKey: 'github:demo/repo-a',
          source: 'github',
          path: '/tmp/repo-a',
          repoName: 'repo-a',
          remoteUrl: 'https://github.com/demo/repo-a',
          githubOwner: 'demo',
          githubRepo: 'repo-a',
          defaultBranch: 'main',
          isGitRepo: true,
          recentCommits: 2,
          commitsByDay: { '2026-06-14': 2 },
          authors: ['a'],
          latestCommitAt: '2026-06-14T11:00:00.000Z',
          error: null,
        },
        {
          repoKey: 'github:demo/repo-b',
          source: 'github',
          path: '/tmp/repo-b',
          repoName: 'repo-b',
          remoteUrl: 'https://github.com/demo/repo-b',
          githubOwner: 'demo',
          githubRepo: 'repo-b',
          defaultBranch: 'main',
          isGitRepo: true,
          recentCommits: 8,
          commitsByDay: { '2026-06-14': 8 },
          authors: ['b'],
          latestCommitAt: '2026-06-14T11:00:00.000Z',
          error: null,
        },
      ],
      errors: [],
      aggregates: {
        throughput: {
          periodStart: '2026-06-13T00:00:00.000Z',
          periodEnd: '2026-06-14T12:00:00.000Z',
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: {
          periodStart: '2026-06-13T00:00:00.000Z',
          periodEnd: '2026-06-14T12:00:00.000Z',
          averageDays: 1,
          medianDays: 1,
          p95Days: 1,
          sampleSize: 1,
        },
        ci: {
          periodStart: '2026-06-13T00:00:00.000Z',
          periodEnd: '2026-06-14T12:00:00.000Z',
          totalRuns: 0,
          passCount: 0,
          failCount: 0,
          passRate: 0,
          averageDurationMs: null,
        },
        staleWork: {
          asOf: '2026-06-14T12:00:00.000Z',
          staleIssues: 0,
          stalePRs: 0,
          staleThresholdDays: 14,
          oldestItemDays: null,
        },
        sessionUsage: {
          periodStart: '2026-06-13T00:00:00.000Z',
          periodEnd: '2026-06-14T12:00:00.000Z',
          totalSessions: 0,
          startedSessions: 0,
          completedSessions: 0,
          erroredSessions: 0,
          stuckSessions: 0,
          lastActivityAt: null,
          messages: 0,
          activeDays: 0,
          totalCost: 0,
          averageCostPerDay: 0,
          averageTokensPerSession: 0,
          medianTokensPerSession: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          uniqueTools: [],
          toolUsage: [],
          topActions: [],
          errorCount: 0,
        },
        computedAt: '2026-06-14T12:00:00.000Z',
      },
      metadata: {
        source: 'orchestrated',
        refreshDurationMs: 1,
        partialData: false,
        errors: [],
      },
    }

    mocks.mockGetLatestState.mockReturnValue({
      snapshot,
      lastRefreshAt: '2026-06-14T12:00:00.000Z',
      lastSuccessfulRefreshAt: '2026-06-14T12:00:00.000Z',
      refreshInProgress: false,
      isStale: false,
      dashboardWindow: null,
      diagnostics: {
        configuredProjectRoots: ['/workspace'],
        discoveredRepos: [],
        skippedPaths: [],
        parsedGitHubRemotes: [],
        collectionTargets: [],
        cacheAgeSeconds: 0,
        pollerEnabled: false,
        pollerIntervalSeconds: 300,
        lastSuccessfulRefreshAt: '2026-06-14T12:00:00.000Z',
        lastError: null,
        sourceHealth: {},
      },
    })

    mocks.mockGetQuery.mockReturnValue({ repoKey: 'github:demo/repo-a' })

    const result = await handler({} as any)

    expect(mocks.mockGetDailyMetricsRange).not.toHaveBeenCalled()
    expect(mocks.mockGetDailyMetricsRangeForRepo).not.toHaveBeenCalled()
    expect(result.selectedRepoKey).toBe('github:demo/repo-a')
    expect(result.snapshot?.issues).toHaveLength(2)
    expect(result.viewSnapshot?.issues).toHaveLength(1)
    expect(result.viewSnapshot?.issues[0]?.repoKey).toBe('github:demo/repo-a')
    expect(result.dashboardWindow.cards.throughput.issuesOpened).toBe(1)
    expect(result.dashboardWindow.cards.throughput.totalCommits).toBe(2)
    expect(result.dashboardWindow.cards.staleWork.staleIssues).toBe(0)
    expect(result.dashboardWindow.latestDay?.day).toBe('2026-06-14')
  })
})
