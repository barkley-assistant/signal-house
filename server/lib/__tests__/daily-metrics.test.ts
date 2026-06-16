import { describe, it, expect } from 'vitest'
import { computeDailyMetrics } from '../daily-metrics'
import type { MetricSnapshot } from '../../../types/snapshot'

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
    mergedAt: '2026-06-02T10:00:00Z',
    closedAt: null,
    repo: 'r',
    repoKey: 'github:r',
    author: 'x',
    labels: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
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
    checkRuns: [],
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

    const day1 = rows.find(r => r.day === '2026-06-01')
    expect(day1).toBeDefined()
    expect(day1!.issuesOpened).toBe(2)
    expect(day1!.issuesClosed).toBe(0)

    const day3 = rows.find(r => r.day === '2026-06-03')
    expect(day3!.issuesClosed).toBe(1)
  })

  it('returns daily rows from PRs bucket by createdAt/mergedAt', () => {
    const snapshot = makeSnapshot({
      pullRequests: [
        makePullRequest({ id: '1' }),
      ],
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.find(r => r.day === '2026-06-01')!.prsCreated).toBe(1)
    expect(rows.find(r => r.day === '2026-06-02')!.prsMerged).toBe(1)
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
    expect(rows.find(r => r.day === '2026-06-01')!.totalSessions).toBe(2)
    expect(rows.find(r => r.day === '2026-06-01')!.sessionErrorCount).toBe(1)
    expect(rows.find(r => r.day === '2026-06-02')!.totalSessions).toBe(1)
    expect(rows.find(r => r.day === '2026-06-02')!.sessionErrorCount).toBe(0)
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
    expect(rows.find(r => r.day === '2026-06-05')!.totalSessions).toBe(115)
    expect(rows.find(r => r.day === '2026-06-05')!.sessionErrorCount).toBe(3)
    expect(rows.find(r => r.day === '2026-06-04')!.totalSessions).toBe(0)
  })

  it('includes cycle time and CI fields from aggregates', () => {
    const snapshot = makeSnapshot({
      aggregates: {
        throughput: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T12:00:00Z', issuesClosed: 5, issuesOpened: 10, prsMerged: 3, prsCreated: 4, totalCommits: 50 },
        cycleTime: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T12:00:00Z', averageDays: 2.5, medianDays: 1.8, p95Days: 6.0, sampleSize: 20 },
        ci: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T12:00:00Z', totalRuns: 100, passCount: 80, failCount: 20, passRate: 0.8, averageDurationMs: 5000 },
        staleWork: { asOf: '2026-06-05T12:00:00Z', staleIssues: 3, stalePRs: 2, staleThresholdDays: 14, oldestItemDays: 30 },
        sessionUsage: null,
        computedAt: '2026-06-05T12:00:00Z',
      },
    })

    const rows = computeDailyMetrics(snapshot)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.avgCycleTimeDays).toBe(2.5)
      expect(row.medianCycleTimeDays).toBe(1.8)
      expect(row.p95CycleTimeDays).toBe(6.0)
      expect(row.cycleTimeSampleSize).toBe(20)
      expect(row.staleIssues).toBe(3)
      expect(row.stalePrs).toBe(2)
    }
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
    expect(rows.find(r => r.day === '2026-06-01')!.totalCommits).toBe(4)
    expect(rows.find(r => r.day === '2026-06-02')!.totalCommits).toBe(2)
    expect(rows.find(r => r.day === '2026-06-03')!.totalCommits).toBe(9)
    expect(rows.find(r => r.day === '2026-06-04')!.totalCommits).toBe(0)
    expect(rows.find(r => r.day === '2026-06-05')!.totalCommits).toBe(0)
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
    for (const row of rows) {
      expect(row.totalCommits).toBe(15)
    }
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
    const todayRow = rows.find(r => r.day === '2026-06-05')
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
})
