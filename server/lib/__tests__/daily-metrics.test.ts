import { describe, it, expect } from '@jest/globals'
import { computeDailyMetrics } from '../daily-metrics'
import type { MetricSnapshot } from '../../../types/snapshot'
import { makeIssue as makeIssueFixture, makePullRequest as makePullRequestFixture, makeWorkflowRun, makeSession, makeLocalRepo as makeLocalRepoFixture, makeSnapshot as makeSnapshotFixture } from './fixtures'

function makeIssue(overrides: Partial<MetricSnapshot['issues'][number]> = {}): MetricSnapshot['issues'][number] {
  return {
    id: '1',
    title: 'a',
    state: 'open',
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    closedAt: null,
    repo: 'r',
    repoKey: 'github:r',
    labels: [],
    assignee: null,
    milestone: null,
    url: '',
    ...overrides,
  }
}

function makePullRequest(overrides: Partial<MetricSnapshot['pullRequests'][number]> = {}): MetricSnapshot['pullRequests'][number] {
  return {
    id: '1',
    title: 'a',
    state: 'merged',
    createdAt: '2026-06-01T10:00:00Z',
    updatedAt: '2026-06-01T10:00:00Z',
    headSha: 'abc123',
    mergedAt: '2026-06-02T10:00:00Z',
    closedAt: null,
    repo: 'r',
    repoKey: 'github:r',
    author: 'x',
    labels: [],
    additions: null,
    deletions: null,
    changedFiles: null,
    url: '',
    ciStatus: null,
    ...overrides,
  }
}

function makeLocalRepo(overrides: Partial<MetricSnapshot['localGit'][number]> = {}): MetricSnapshot['localGit'][number] {
  return {
    repoKey: 'local:/a',
    source: 'local',
    path: '/a',
    repoName: 'a',
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    defaultBranch: 'main',
    isGitRepo: true,
    recentCommits: 0,
    commitsByDay: {},
    authors: [],
    latestCommitAt: null,
    error: null,
    ...overrides,
  }
}

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  return {
    id: 'snap-1',
    capturedAt: '2026-06-05T12:00:00Z',
    issues: [],
    pullRequests: [],
    workflowRuns: [],
    repositories: [],
    sessions: [],
    localGit: [],
    errors: [],
    aggregates: {
      throughput: {
        periodStart: '2026-06-01T00:00:00Z',
        periodEnd: '2026-06-05T12:00:00Z',
        issuesClosed: 0,
        issuesOpened: 0,
        prsMerged: 0,
        prsCreated: 0,
        totalCommits: 0,
      },
      cycleTime: null,
      ci: null,
      staleWork: {
        asOf: '2026-06-05T12:00:00Z',
        staleIssues: 2,
        stalePRs: 1,
        staleThresholdDays: 14,
        oldestItemDays: null,
      },
      sessionUsage: null,
      computedAt: '2026-06-05T12:00:00Z',
    },
    metadata: {
      source: 'orchestrated',
      refreshDurationMs: 100,
      partialData: false,
      errors: [],
    },
    ...overrides,
  }
}

function allRow(rows: ReturnType<typeof computeDailyMetrics>, day: string) {
  return rows.find((row) => row.day === day && row.repoKey === 'all')
}

describe('computeDailyMetrics', () => {
  it('returns daily rows from issues bucket by createdAt/closedAt', () => {
    const snapshot = makeSnapshot({
      issues: [
        makeIssue({ id: '1' }),
        makeIssue({ id: '2', title: 'b', state: 'closed', closedAt: '2026-06-03T10:00:00Z' }),
        makeIssue({ id: '3', title: 'c', createdAt: '2026-06-02T10:00:00Z' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.length).toBeGreaterThanOrEqual(3)

    const day1 = allRow(rows, '2026-06-01')
    expect(day1).toBeDefined()
    expect(day1!.issuesOpened).toBe(2)
    expect(day1!.issuesClosed).toBe(0)

    const day3 = allRow(rows, '2026-06-03')
    expect(day3!.issuesClosed).toBe(1)
  })

  it('returns daily rows from PRs bucket by createdAt/mergedAt', () => {
    const snapshot = makeSnapshot({
      pullRequests: [
        makePullRequest({ id: '1' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(allRow(rows, '2026-06-01')!.prsCreated).toBe(1)
    expect(allRow(rows, '2026-06-02')!.prsMerged).toBe(1)
  })

  it('buckets sessions by day', () => {
    const snapshot = makeSnapshot({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: '2026-06-01T10:00:00Z', durationMs: 100, metadata: {}, success: true },
        { id: 's2', toolName: 'opencode', action: 'edit', timestamp: '2026-06-01T11:00:00Z', durationMs: 100, metadata: {}, success: false },
        { id: 's3', toolName: 'opencode', action: 'search', timestamp: '2026-06-02T10:00:00Z', durationMs: 100, metadata: {}, success: true },
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(allRow(rows, '2026-06-01')!.totalSessions).toBe(2)
    expect(allRow(rows, '2026-06-01')!.sessionErrorCount).toBe(1)
    expect(allRow(rows, '2026-06-02')!.totalSessions).toBe(1)
    expect(allRow(rows, '2026-06-02')!.sessionErrorCount).toBe(0)
  })

  it('uses the session aggregate as a captured-day fallback when no per-session rows exist', () => {
    const snapshot = makeSnapshot({
      aggregates: {
        throughput: {
          periodStart: '2026-06-01T00:00:00Z',
          periodEnd: '2026-06-05T12:00:00Z',
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: null,
        ci: null,
        staleWork: {
          asOf: '2026-06-05T12:00:00Z',
          staleIssues: 2,
          stalePRs: 1,
          staleThresholdDays: 14,
          oldestItemDays: null,
        },
        sessionUsage: {
          periodStart: '2026-05-06T00:00:00Z',
          periodEnd: '2026-06-05T12:00:00Z',
          totalSessions: 115,
          startedSessions: 5,
          completedSessions: 4,
          erroredSessions: 1,
          stuckSessions: 0,
          lastActivityAt: '2026-06-05T11:30:00Z',
          messages: 12,
          activeDays: 3,
          totalCost: 9.87,
          averageCostPerDay: 3.29,
          averageTokensPerSession: 100,
          medianTokensPerSession: 80,
          inputTokens: 60,
          outputTokens: 30,
          cacheReadTokens: 5,
          cacheWriteTokens: 10,
          uniqueTools: ['edit', 'search'],
          toolUsage: [{ toolName: 'edit', count: 80, percentage: 80 }],
          topActions: [{ action: 'edit', count: 80 }],
          errorCount: 3,
        },
        computedAt: '2026-06-05T12:00:00Z',
      },
    })

    const rows = computeDailyMetrics(snapshot)
    expect(allRow(rows, '2026-06-05')!.totalSessions).toBe(115)
    expect(allRow(rows, '2026-06-05')!.sessionErrorCount).toBe(3)
    expect(allRow(rows, '2026-06-04')!.totalSessions).toBe(0)
  })

  it('computes trailing 14-day rolling cycle time per day from merged PRs', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-10T12:00:00Z',
      pullRequests: [
        makePullRequest({ id: 'pr1', createdAt: '2026-05-10T10:00:00Z', mergedAt: '2026-05-20T10:00:00Z' }),
        makePullRequest({ id: 'pr2', createdAt: '2026-05-15T10:00:00Z', mergedAt: '2026-05-25T10:00:00Z' }),
        makePullRequest({ id: 'pr3', createdAt: '2026-05-20T10:00:00Z', mergedAt: '2026-06-01T10:00:00Z' }),
        makePullRequest({ id: 'pr4', createdAt: '2026-05-25T10:00:00Z', mergedAt: '2026-06-05T10:00:00Z' }),
        makePullRequest({ id: 'pr5', createdAt: '2026-06-01T10:00:00Z', mergedAt: '2026-06-08T10:00:00Z' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.length).toBeGreaterThan(0)

    const day1 = allRow(rows, '2026-06-01')!
    // Window [2026-05-18, 2026-06-01] -> PR1(10d), PR2(10d), PR3(12d) = 3 PRs
    expect(day1.cycleTimeSampleSize).toBe(3)
    expect(day1.avgCycleTimeSeconds).toBeCloseTo(((10 + 10 + 12) / 3) * 86400, 0)
    expect(day1.medianCycleTimeSeconds).toBe(10 * 86400)
    expect(day1.p95CycleTimeSeconds).toBeCloseTo(11.8 * 86400, 0)

    const day5 = allRow(rows, '2026-06-05')!
    // Window [2026-05-22, 2026-06-05] -> PR2(10d), PR3(12d), PR4(11d) = 3 PRs
    expect(day5.cycleTimeSampleSize).toBe(3)
    expect(day5.avgCycleTimeSeconds).toBe(11 * 86400)
    expect(day5.medianCycleTimeSeconds).toBe(11 * 86400)
    // p95: sorted[10,11,12]; index=0.95*2=1.9 => 11+(12-11)*0.9=11.9
    expect(day5.p95CycleTimeSeconds).toBeCloseTo(11.9 * 86400, 3)

    const day10 = allRow(rows, '2026-06-10')!
    // Window [2026-05-27, 2026-06-10] -> PR3(12d), PR4(11d), PR5(7d) = 3 PRs
    expect(day10.cycleTimeSampleSize).toBe(3)
    expect(day10.avgCycleTimeSeconds).toBe(10 * 86400)
    expect(day10.medianCycleTimeSeconds).toBe(11 * 86400)
    // p95: sorted[7,11,12]; index=0.95*2=1.9 => 11+(12-11)*0.9=11.9
    expect(day10.p95CycleTimeSeconds).toBeCloseTo(11.9 * 86400, 3)
  })

  it('returns null cycle time when fewer than 3 merged PRs in trailing window', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      pullRequests: [
        makePullRequest({ id: 'pr1', createdAt: '2026-06-01T10:00:00Z', mergedAt: '2026-06-02T10:00:00Z' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    for (const row of rows) {
      expect(row.cycleTimeSampleSize).toBe(0)
      expect(row.avgCycleTimeSeconds).toBeNull()
      expect(row.medianCycleTimeSeconds).toBeNull()
      expect(row.p95CycleTimeSeconds).toBeNull()
    }
  })

  it('does not spread aggregate CI totals across days with no workflow runs', () => {
    const snapshot = makeSnapshot({
      workflowRuns: [],
      aggregates: {
        throughput: {
          periodStart: '2026-06-01T00:00:00Z',
          periodEnd: '2026-06-05T12:00:00Z',
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: null,
        ci: {
          periodStart: '2026-06-01T00:00:00Z',
          periodEnd: '2026-06-05T12:00:00Z',
          totalRuns: 12,
          passCount: 9,
          failCount: 3,
          passRate: 0.75,
          averageDurationMs: 1234,
        },
        staleWork: {
          asOf: '2026-06-05T12:00:00Z',
          staleIssues: 2,
          stalePRs: 1,
          staleThresholdDays: 14,
          oldestItemDays: null,
        },
        sessionUsage: null,
        computedAt: '2026-06-05T12:00:00Z',
      },
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.every((row) => row.ciTotalRuns === 0)).toBe(true)
    expect(rows.every((row) => row.ciPassCount === 0)).toBe(true)
    expect(rows.every((row) => row.ciFailCount === 0)).toBe(true)
    expect(rows.some((row) => row.warnings.some((warning) => warning.includes('CI trend unavailable')))).toBe(true)
  })

  it('emits repo-scoped rows and leaves missing repo/day combinations absent', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-03T12:00:00Z',
      issues: [
        makeIssue({ id: '1', repo: 'one', repoKey: 'github:demo/repo-a', createdAt: '2026-06-01T10:00:00Z' }),
        makeIssue({ id: '2', repo: 'two', repoKey: 'github:demo/repo-b', createdAt: '2026-06-03T10:00:00Z' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.some((row) => row.repoKey === 'all' && row.day === '2026-06-01')).toBe(true)
    expect(rows.some((row) => row.repoKey === 'all' && row.day === '2026-06-03')).toBe(true)
    expect(rows.some((row) => row.repoKey === 'github:demo/repo-a' && row.day === '2026-06-01')).toBe(true)
    expect(rows.some((row) => row.repoKey === 'github:demo/repo-a' && row.day === '2026-06-03')).toBe(false)
    expect(rows.some((row) => row.repoKey === 'github:demo/repo-b' && row.day === '2026-06-03')).toBe(true)
    expect(rows.some((row) => row.repoKey === 'github:demo/repo-b' && row.day === '2026-06-01')).toBe(false)
  })

  it('adds warnings when metadata has errors', () => {
    const snapshot = makeSnapshot({
      metadata: {
        source: 'orchestrated',
        refreshDurationMs: 100,
        partialData: true,
        errors: ['GitHub rate limited'],
      },
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.warnings.length).toBeGreaterThan(0)
      expect(row.warnings[0]).toContain('GitHub rate limited')
    }
  })

  it('distributes totalCommits by day using commitsByDay from localGit repos', () => {
    const snapshot = makeSnapshot({
      localGit: [
        makeLocalRepo({ repoKey: 'local:/a', path: '/a', repoName: 'a', recentCommits: 10, commitsByDay: { '2026-06-01': 4, '2026-06-03': 6 }, authors: ['x'] }),
        makeLocalRepo({ repoKey: 'local:/b', path: '/b', repoName: 'b', recentCommits: 5, commitsByDay: { '2026-06-02': 2, '2026-06-03': 3 }, authors: ['y'] }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(allRow(rows, '2026-06-01')!.totalCommits).toBe(4)
    expect(allRow(rows, '2026-06-02')!.totalCommits).toBe(2)
    expect(allRow(rows, '2026-06-03')!.totalCommits).toBe(9)
    expect(allRow(rows, '2026-06-04')!.totalCommits).toBe(0)
    expect(allRow(rows, '2026-06-05')!.totalCommits).toBe(0)
  })

  it('falls back to flat totalCommits when no per-day breakdown is available', () => {
    const snapshot = makeSnapshot({
      localGit: [
        makeLocalRepo({ repoKey: 'local:/a', path: '/a', repoName: 'a', recentCommits: 10, authors: ['x'] }),
        makeLocalRepo({ repoKey: 'local:/b', path: '/b', repoName: 'b', recentCommits: 5, authors: ['y'] }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.length).toBeGreaterThan(0)
    expect(allRow(rows, '2026-06-05')!.totalCommits).toBe(15)
  })

  it('always includes capturedAt day even when aggregate range does not cover it', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      aggregates: {
        throughput: {
          periodStart: '2026-06-01T00:00:00Z',
          periodEnd: '2026-06-04T23:59:59Z',
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: null,
        ci: null,
        staleWork: {
          asOf: '2026-06-05T12:00:00Z',
          staleIssues: 0,
          stalePRs: 0,
          staleThresholdDays: 14,
          oldestItemDays: null,
        },
        sessionUsage: null,
        computedAt: '2026-06-05T12:00:00Z',
      },
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.some(r => r.day === '2026-06-05')).toBe(true)
    const todayRow = allRow(rows, '2026-06-05')
    expect(todayRow!.issuesOpened).toBe(0)
    expect(todayRow!.totalCommits).toBe(0)
    expect(todayRow!.staleIssues).toBe(0)
    expect(todayRow!.capturedAt).toBe('2026-06-05T12:00:00Z')
  })

  it('sorts rows by descending day', () => {
    const snapshot = makeSnapshot({
      issues: [
        makeIssue({ id: '1' }),
        makeIssue({ id: '2', title: 'b', createdAt: '2026-06-03T10:00:00Z' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows[0]!.day >= rows[rows.length - 1]!.day).toBe(true)
  })

  it('treats closed-unmerged PRs as created but NOT merged', () => {
    const snapshot = makeSnapshot({
      pullRequests: [
        makePullRequest({
          id: 'pr-closed-unmerged',
          state: 'closed',
          mergedAt: null,
          closedAt: '2026-06-03T10:00:00Z',
          createdAt: '2026-06-01T10:00:00Z',
        }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)

    const day1 = allRow(rows, '2026-06-01')
    expect(day1).toBeDefined()
    expect(day1!.prsCreated).toBe(1)
    expect(day1!.prsMerged).toBe(0)

    const day3 = allRow(rows, '2026-06-03')
    expect(day3!.prsMerged).toBe(0)
  })

  it('counts merged PR as merged and open PR as created only', () => {
    const snapshot = makeSnapshot({
      pullRequests: [
        makePullRequest({
          id: 'pr-merged',
          state: 'merged',
          createdAt: '2026-06-01T10:00:00Z',
          mergedAt: '2026-06-02T10:00:00Z',
        }),
        makePullRequest({
          id: 'pr-open',
          state: 'open',
          createdAt: '2026-06-01T10:00:00Z',
          mergedAt: null,
        }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)

    const day1 = allRow(rows, '2026-06-01')
    expect(day1!.prsCreated).toBe(2)
    expect(day1!.prsMerged).toBe(0)

    const day2 = allRow(rows, '2026-06-02')
    expect(day2!.prsMerged).toBe(1)
  })

  it('distributes workflow runs across multiple days for CI counts', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      workflowRuns: [
        makeWorkflowRun({ id: 'w1', completedAt: '2026-06-01T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'w2', completedAt: '2026-06-01T11:00:00Z', conclusion: 'failure' }),
        makeWorkflowRun({ id: 'w3', completedAt: '2026-06-03T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'w4', completedAt: '2026-06-03T11:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'w5', completedAt: '2026-06-03T12:00:00Z', conclusion: 'success' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)

    expect(allRow(rows, '2026-06-01')!.ciTotalRuns).toBe(2)
    expect(allRow(rows, '2026-06-01')!.ciPassCount).toBe(1)
    expect(allRow(rows, '2026-06-01')!.ciFailCount).toBe(1)

    expect(allRow(rows, '2026-06-03')!.ciTotalRuns).toBe(3)
    expect(allRow(rows, '2026-06-03')!.ciPassCount).toBe(3)
    expect(allRow(rows, '2026-06-03')!.ciFailCount).toBe(0)

    expect(allRow(rows, '2026-06-02')!.ciTotalRuns).toBe(0)
  })

  it('distributes workflow run CI stats per repo and per day', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      workflowRuns: [
        makeWorkflowRun({ id: 'a1', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-01T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'a2', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-01T11:00:00Z', conclusion: 'failure' }),
        makeWorkflowRun({ id: 'a3', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-03T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'b1', repo: 'beta', repoKey: 'github:demo/beta', completedAt: '2026-06-01T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'b2', repo: 'beta', repoKey: 'github:demo/beta', completedAt: '2026-06-03T10:00:00Z', conclusion: 'timed_out' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)

    const alphaJun1 = rows.find((row) => row.day === '2026-06-01' && row.repoKey === 'github:demo/alpha')!
    expect(alphaJun1).toBeDefined()
    expect(alphaJun1.ciTotalRuns).toBe(2)
    expect(alphaJun1.ciPassCount).toBe(1)
    expect(alphaJun1.ciFailCount).toBe(1)
    expect(alphaJun1.ciPassRate).toBe(0.5)

    const alphaJun3 = rows.find((row) => row.day === '2026-06-03' && row.repoKey === 'github:demo/alpha')!
    expect(alphaJun3).toBeDefined()
    expect(alphaJun3.ciTotalRuns).toBe(1)
    expect(alphaJun3.ciPassCount).toBe(1)
    expect(alphaJun3.ciFailCount).toBe(0)
    expect(alphaJun3.ciPassRate).toBe(1)

    const betaJun1 = rows.find((row) => row.day === '2026-06-01' && row.repoKey === 'github:demo/beta')!
    expect(betaJun1).toBeDefined()
    expect(betaJun1.ciTotalRuns).toBe(1)
    expect(betaJun1.ciPassCount).toBe(1)
    expect(betaJun1.ciFailCount).toBe(0)
    expect(betaJun1.ciPassRate).toBe(1)

    const betaJun3 = rows.find((row) => row.day === '2026-06-03' && row.repoKey === 'github:demo/beta')!
    expect(betaJun3).toBeDefined()
    expect(betaJun3.ciTotalRuns).toBe(1)
    expect(betaJun3.ciPassCount).toBe(0)
    expect(betaJun3.ciFailCount).toBe(1)
    expect(betaJun3.ciPassRate).toBe(0)

    const alphaJun2 = rows.find((row) => row.day === '2026-06-02' && row.repoKey === 'github:demo/alpha')
    expect(alphaJun2).toBeUndefined()

    expect(allRow(rows, '2026-06-01')!.ciTotalRuns).toBe(3)
    expect(allRow(rows, '2026-06-01')!.ciPassCount).toBe(2)
    expect(allRow(rows, '2026-06-01')!.ciFailCount).toBe(1)
    expect(allRow(rows, '2026-06-03')!.ciTotalRuns).toBe(2)
    expect(allRow(rows, '2026-06-03')!.ciPassCount).toBe(1)
    expect(allRow(rows, '2026-06-03')!.ciFailCount).toBe(1)
  })

  it('treats timed_out workflow runs as CI failures in per-repo rows', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      workflowRuns: [
        makeWorkflowRun({ id: 'a1', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-02T10:00:00Z', conclusion: 'timed_out' }),
        makeWorkflowRun({ id: 'a2', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-02T11:00:00Z', conclusion: 'startup_failure' }),
        makeWorkflowRun({ id: 'a3', repo: 'alpha', repoKey: 'github:demo/alpha', completedAt: '2026-06-02T12:00:00Z', conclusion: 'cancelled' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    const row = rows.find((r) => r.day === '2026-06-02' && r.repoKey === 'github:demo/alpha')!
    expect(row).toBeDefined()
    expect(row.ciTotalRuns).toBe(3)
    expect(row.ciPassCount).toBe(0)
    expect(row.ciFailCount).toBe(2)
    expect(row.ciPassRate).toBe(0)
  })

  it('handles a comprehensive snapshot with all data types across multiple days', () => {
    const snapshot = makeSnapshot({
      capturedAt: '2026-06-05T12:00:00Z',
      issues: [
        makeIssueFixture({ id: 'i1', createdAt: '2026-06-01T10:00:00Z' }),
        makeIssueFixture({ id: 'i2', state: 'closed', createdAt: '2026-06-01T10:00:00Z', closedAt: '2026-06-03T10:00:00Z' }),
        makeIssueFixture({ id: 'i3', createdAt: '2026-06-02T10:00:00Z' }),
      ],
      pullRequests: [
        makePullRequestFixture({ id: 'pr1', createdAt: '2026-06-01T10:00:00Z', mergedAt: '2026-06-02T10:00:00Z' }),
        makePullRequestFixture({ id: 'pr2', state: 'closed', createdAt: '2026-06-03T10:00:00Z', mergedAt: null, closedAt: '2026-06-04T10:00:00Z' }),
      ],
      workflowRuns: [
        makeWorkflowRun({ id: 'w1', completedAt: '2026-06-01T10:00:00Z', conclusion: 'success' }),
        makeWorkflowRun({ id: 'w2', completedAt: '2026-06-01T11:00:00Z', conclusion: 'failure' }),
        makeWorkflowRun({ id: 'w3', completedAt: '2026-06-02T10:00:00Z', conclusion: 'success' }),
      ],
      sessions: [
        makeSession({ id: 's1', timestamp: '2026-06-01T10:00:00Z', success: true }),
        makeSession({ id: 's2', timestamp: '2026-06-01T11:00:00Z', success: false }),
        makeSession({ id: 's3', timestamp: '2026-06-04T10:00:00Z', success: true }),
      ],
      localGit: [
        makeLocalRepo({ repoKey: 'local:/a', recentCommits: 7, commitsByDay: { '2026-06-01': 3, '2026-06-04': 4 } }),
      ],
      aggregates: {
        throughput: {
          periodStart: '2026-06-01T00:00:00Z',
          periodEnd: '2026-06-05T12:00:00Z',
          issuesClosed: 0,
          issuesOpened: 0,
          prsMerged: 0,
          prsCreated: 0,
          totalCommits: 0,
        },
        cycleTime: null,
        ci: null,
        staleWork: {
          asOf: '2026-06-05T12:00:00Z',
          staleIssues: 2,
          stalePRs: 1,
          staleThresholdDays: 14,
          oldestItemDays: null,
        },
        sessionUsage: null,
        computedAt: '2026-06-05T12:00:00Z',
      },
    })

    const rows = computeDailyMetrics(snapshot)

    const jun1 = allRow(rows, '2026-06-01')!
    expect(jun1.issuesOpened).toBe(2)
    expect(jun1.prsCreated).toBe(1)
    expect(jun1.ciTotalRuns).toBe(2)
    expect(jun1.ciPassCount).toBe(1)
    expect(jun1.ciFailCount).toBe(1)
    expect(jun1.totalSessions).toBe(2)
    expect(jun1.sessionErrorCount).toBe(1)
    expect(jun1.totalCommits).toBe(3)
    expect(jun1.staleIssues).toBe(2)
    expect(jun1.stalePrs).toBe(1)

    const jun2 = allRow(rows, '2026-06-02')!
    expect(jun2.issuesOpened).toBe(1)
    expect(jun2.prsMerged).toBe(1)
    expect(jun2.ciTotalRuns).toBe(1)
    expect(jun2.totalCommits).toBe(0)

    const jun3 = allRow(rows, '2026-06-03')!
    expect(jun3.issuesClosed).toBe(1)
    expect(jun3.prsCreated).toBe(1)

    const jun4 = allRow(rows, '2026-06-04')!
    expect(jun4.totalSessions).toBe(1)
    expect(jun4.totalCommits).toBe(4)
  })

  // ----- "unknown vs false" contract (issue #343) -----

  it('keeps medianCycleTimeSeconds as null when the window has no merged PRs (does not coerce to 0)', () => {
    // A snapshot with a couple of unmerged PRs in the lookback window
    // means the cycle-time aggregate has no data to summarise. The
    // existing implementation already produces `null` (it returns early
    // at < 3 merged PRs and the field type is already `number | null`);
    // this test locks that contract so a future coercion to 0 would be
    // caught immediately.
    const snapshot = makeSnapshot({
      pullRequests: [
        makePullRequest({
          id: 'pr-open',
          state: 'open',
          createdAt: '2026-06-01T00:00:00Z',
          mergedAt: null,
        }),
        makePullRequest({
          id: 'pr-closed-not-merged',
          state: 'closed',
          createdAt: '2026-06-02T00:00:00Z',
          mergedAt: null,
        }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    const row = allRow(rows, '2026-06-05')
    expect(row).toBeDefined()
    expect(row!.medianCycleTimeSeconds).toBeNull()
    expect(row!.avgCycleTimeSeconds).toBeNull()
    expect(row!.p95CycleTimeSeconds).toBeNull()
    // Sample size confirms there's no cycle-time measurement available.
    expect(row!.cycleTimeSampleSize).toBe(0)
  })
})
