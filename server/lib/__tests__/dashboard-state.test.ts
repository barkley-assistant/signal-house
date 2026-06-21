import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { buildDashboardWindow } from '../dashboard-state'
import { makeDailyMetricsRow } from './fixtures'

function makeRow(day: string, overrides: Partial<import('../../../types/daily-metrics').DailyMetricsRow> = {}) {
  return {
    day,
    repoKey: 'all',
    capturedAt: `${day}T12:00:00.000Z`,
    source: 'orchestrated',
    version: 1,
    reflectsCompleteData: true,
    issuesOpened: 0,
    issuesClosed: 0,
    prsCreated: 0,
    prsMerged: 0,
    totalCommits: 0,
    avgCycleTimeDays: null,
    medianCycleTimeDays: null,
    p95CycleTimeDays: null,
    cycleTimeSampleSize: 0,
    ciTotalRuns: 0,
    ciPassCount: 0,
    ciFailCount: 0,
    ciPassRate: null,
    ciAvgDurationMs: null,
    totalSessions: 0,
    sessionErrorCount: 0,
    staleIssues: 0,
    stalePrs: 0,
    warnings: [],
    createdAt: `${day}T12:00:00.000Z`,
    ...overrides,
  }
}

const ENV_KEYS = [
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'SECRET_HOUSE_GITHUB_REPO',
  'GIT_REPOS',
  'SESSIONS_PERIOD_DAYS',
]

function snapshotEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
  }
  return saved
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
  }
}

describe('buildDashboardWindow', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = snapshotEnv()
    process.env['GITHUB_TOKEN'] = 'ghp_test'
    process.env['GITHUB_OWNER'] = 'barkley-clawd'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'signal-house'
    process.env['GIT_REPOS'] = '/tmp/repo-a'
    process.env['SESSIONS_PERIOD_DAYS'] = '30'
  })

  afterEach(() => {
    restoreEnv(savedEnv)
  })

  it('normalizes the response to a 28-day ascending series with explicit gaps', () => {
    const sessionUsage = {
      periodStart: '2026-05-18T00:00:00Z',
      periodEnd: '2026-06-14T12:00:00Z',
      totalSessions: 12,
      startedSessions: 6,
      completedSessions: 5,
      erroredSessions: 1,
      stuckSessions: 0,
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
    }

    const window = buildDashboardWindow([
      makeRow('2026-06-14', {
        issuesOpened: 2,
        issuesClosed: 3,
        prsCreated: 4,
        prsMerged: 5,
        totalCommits: 6,
        avgCycleTimeDays: 1.5,
        medianCycleTimeDays: 1.2,
        p95CycleTimeDays: 2.8,
        cycleTimeSampleSize: 9,
        ciTotalRuns: 8,
        ciPassCount: 6,
        ciFailCount: 2,
        ciPassRate: 0.75,
        ciAvgDurationMs: 1500,
        totalSessions: 7,
        sessionErrorCount: 1,
        staleIssues: 3,
        stalePrs: 2,
      }),
      makeRow('2026-06-10', {
        issuesOpened: 1,
        issuesClosed: 1,
        prsCreated: 1,
        prsMerged: 1,
        totalCommits: 2,
        ciTotalRuns: 4,
        ciPassCount: 3,
        ciFailCount: 1,
        ciPassRate: 0.75,
        ciAvgDurationMs: 900,
        totalSessions: 5,
        sessionErrorCount: 2,
        staleIssues: 6,
        stalePrs: 4,
        warnings: ['Partial data: local git unavailable'],
      }),
    ], new Date('2026-06-14T12:00:00Z'), false, sessionUsage)

    expect(window.startDay).toBe('2026-05-18')
    expect(window.endDay).toBe('2026-06-14')
    expect(window.days).toHaveLength(28)
    expect(window.days[0]).toMatchObject({ day: '2026-05-18', isGap: true, metrics: null })
    expect(window.days.at(-1)).toMatchObject({ day: '2026-06-14', isGap: false })
    expect(window.missingDays).toContain('2026-06-13')
    expect(window.latestDay?.day).toBe('2026-06-14')
    expect(window.cards.throughput).toMatchObject({
      issuesOpened: 3,
      issuesClosed: 4,
      prsCreated: 5,
      prsMerged: 6,
      totalCommits: 8,
      status: 'partial',
      message: 'Partial data - one or more throughput sources failed during the last refresh',
    })
    expect(window.cards.cycleTime).toMatchObject({
      averageDays: 1.5,
      medianDays: 1.2,
      p95Days: 2.8,
      sampleSize: 9,
      sourceDay: '2026-06-14',
      status: 'available',
      message: null,
    })
    expect(window.cards.ci).toMatchObject({
      totalRuns: 12,
      passCount: 9,
      failCount: 3,
      passRate: 0.75,
      averageDurationMs: 1300,
      sourceDays: 2,
      status: 'available',
      message: null,
    })
    expect(window.cards.staleWork).toMatchObject({
      staleIssues: 3,
      stalePrs: 2,
      capturedAt: '2026-06-14T12:00:00.000Z',
      reflectsCompleteData: true,
      status: 'available',
      message: null,
    })
    expect(window.sessionUsage).toMatchObject({
      periodStart: '2026-05-18T00:00:00Z',
      periodEnd: '2026-06-14T12:00:00Z',
      totalSessions: 12,
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
      status: 'available',
      message: null,
    })
    expect(window.cards.sessionUsage).toMatchObject({
      totalSessions: 12,
      sessionErrorCount: 3,
      status: 'available',
      message: null,
    })
    expect(window.coverage).toMatchObject({
      totalDays: 28,
      daysWithData: 2,
      missingDays: 26,
      hasGaps: true,
      hasSourceWarnings: true,
      isComplete: false,
    })
    expect(window.warnings).toEqual(
      expect.arrayContaining([
        'Partial data: local git unavailable',
        'Missing 26 of 28 days in the rolling window',
      ]),
    )
  })

  it('keeps coverage complete when the window is fully populated', () => {
    const rows = Array.from({ length: 28 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 5, 14))
      day.setUTCDate(day.getUTCDate() - (27 - index))
      return makeRow(day.toISOString().slice(0, 10), {
        issuesOpened: 1,
        issuesClosed: 1,
        prsCreated: 1,
        prsMerged: 1,
        totalCommits: 1,
      })
    })

    const window = buildDashboardWindow(rows, new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.days).toHaveLength(28)
    expect(window.missingDays).toHaveLength(0)
    expect(window.coverage.isComplete).toBe(true)
    expect(window.warnings).toHaveLength(0)
    expect(window.cards.throughput.totalCommits).toBe(28)
  })

  it('marks healthy panels stale when the dashboard cache is stale', () => {
    const window = buildDashboardWindow([
      makeRow('2026-06-14', {
        issuesOpened: 1,
        issuesClosed: 1,
        prsCreated: 1,
        prsMerged: 1,
        totalCommits: 1,
        avgCycleTimeDays: 2,
        medianCycleTimeDays: 1.5,
        p95CycleTimeDays: 3,
        cycleTimeSampleSize: 5,
        ciTotalRuns: 4,
        ciPassCount: 3,
        ciFailCount: 1,
        ciPassRate: 0.75,
        ciAvgDurationMs: 900,
        totalSessions: 2,
      }),
    ], new Date('2026-06-14T12:00:00Z'), true, {
      periodStart: '2026-05-18T00:00:00Z',
      periodEnd: '2026-06-14T12:00:00Z',
      totalSessions: 2,
      startedSessions: 1,
      completedSessions: 1,
      erroredSessions: 0,
      stuckSessions: 0,
      lastActivityAt: '2026-06-14T11:30:00Z',
      messages: 4,
      activeDays: 1,
      totalCost: 2.5,
      averageCostPerDay: 2.5,
      averageTokensPerSession: 100,
      medianTokensPerSession: 80,
      inputTokens: 60,
      outputTokens: 30,
      cacheReadTokens: 5,
      cacheWriteTokens: 10,
      uniqueTools: ['edit'],
      toolUsage: [{ toolName: 'edit', count: 2, percentage: 100 }],
      topActions: [{ action: 'edit', count: 2 }],
      errorCount: 0,
    })

    expect(window.cards.throughput.status).toBe('stale')
    expect(window.cards.cycleTime.status).toBe('stale')
    expect(window.cards.ci.status).toBe('stale')
    expect(window.cards.staleWork.status).toBe('stale')
    expect(window.cards.sessionUsage.status).toBe('stale')
    expect(window.cards.throughput.message).toBe('Cached data may be stale')
  })

  it('explains when CI has no per-day workflow runs in the window', () => {
    const window = buildDashboardWindow([
      makeRow('2026-06-14', {
        warnings: ['CI trend unavailable: no per-day workflow runs were captured in this window'],
      }),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.cards.ci).toMatchObject({
      totalRuns: 0,
      passCount: 0,
      failCount: 0,
      passRate: null,
      averageDurationMs: null,
      sourceDays: 0,
      status: 'empty',
      message: 'No per-day CI data in this window',
    })
  })
})

describe('buildDashboardWindow — extended coverage', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = snapshotEnv()
  })

  afterEach(() => {
    restoreEnv(savedEnv)
  })

  it('includes warning banners from source failures and marks cards unavailable', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'
    process.env['SESSIONS_PERIOD_DAYS'] = '30'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14', {
        issuesOpened: 1,
        issuesClosed: 1,
        prsCreated: 1,
        prsMerged: 1,
        totalCommits: 2,
        warnings: ['GitHub collector failed: rate limited'],
      }),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.warnings).toContain('GitHub collector failed: rate limited')
    expect(window.cards.throughput.status).toBe('partial')
    expect(window.cards.throughput.message).toBe('Partial data - one or more throughput sources failed during the last refresh')
    expect(window.cards.cycleTime.status).toBe('unavailable')
    expect(window.cards.cycleTime.message).toBe('Cycle time unavailable - GitHub collector failed during the last refresh')
    expect(window.cards.ci.status).toBe('unavailable')
    expect(window.cards.ci.message).toBe('CI data unavailable - GitHub workflow runs could not be collected')
    expect(window.cards.staleWork.status).toBe('unavailable')
    expect(window.cards.staleWork.message).toBe('Stale work unavailable - GitHub collector failed during the last refresh')
  })

  it('reports empty session usage when configured but no aggregate present', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'
    process.env['SESSIONS_PERIOD_DAYS'] = '30'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14'),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.sessionUsage).not.toBeNull()
    expect(window.sessionUsage!.status).toBe('empty')
    expect(window.sessionUsage!.message).toBe('No session activity')
    expect(window.cards.sessionUsage.status).toBe('empty')
  })

  it('reports unconfigured session when no session env var set', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14'),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.sessionUsage).not.toBeNull()
    expect(window.sessionUsage!.status).toBe('unconfigured')
    expect(window.cards.sessionUsage.status).toBe('unconfigured')
  })

  it('includes model usage rows when present on the session aggregate', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'
    process.env['SESSIONS_PERIOD_DAYS'] = '30'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14'),
    ], new Date('2026-06-14T12:00:00Z'), false, {
      periodStart: '2026-06-01',
      periodEnd: '2026-06-14',
      totalSessions: 4,
      startedSessions: 4,
      completedSessions: 4,
      erroredSessions: null,
      stuckSessions: null,
      lastActivityAt: '2026-06-14T11:00:00Z',
      messages: 12,
      activeDays: 3,
      totalCost: 1.2,
      averageCostPerDay: 0.4,
      averageTokensPerSession: 100,
      medianTokensPerSession: 90,
      inputTokens: 80,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 2,
      uniqueTools: [],
      toolUsage: [],
      modelUsage: [{
        modelName: 'opencode-go/deepseek-v4-flash',
        messages: 12,
        inputTokens: 80,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 2,
        cost: 1.2,
      }],
      topActions: [],
      errorCount: 0,
    })

    expect(window.sessionUsage?.modelUsage).toHaveLength(1)
    expect(window.sessionUsage?.modelUsage[0]?.modelName).toBe('opencode-go/deepseek-v4-flash')
  })

  it('reports unconfigured sources when GitHub and local git are not configured', () => {
    process.env['SESSIONS_PERIOD_DAYS'] = '30'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14'),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.cards.throughput.status).toBe('unconfigured')
    expect(window.cards.cycleTime.status).toBe('unconfigured')
    expect(window.cards.ci.status).toBe('unconfigured')
    expect(window.cards.staleWork.status).toBe('unconfigured')
  })

  it('shows stale work as no stale work when issues and PRs are current', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14', { staleIssues: 0, stalePrs: 0 }),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.cards.staleWork.message).toBe('No stale work')
    expect(window.cards.staleWork.staleIssues).toBe(0)
    expect(window.cards.staleWork.stalePrs).toBe(0)
  })

  it('summarises CI correctly when workflow run data is present across days', () => {
    process.env['GITHUB_TOKEN'] = 'tok'
    process.env['GITHUB_OWNER'] = 'o'
    process.env['SECRET_HOUSE_GITHUB_REPO'] = 'r'
    process.env['GIT_REPOS'] = '/tmp/a'

    const window = buildDashboardWindow([
      makeDailyMetricsRow('2026-06-14', {
        ciTotalRuns: 10, ciPassCount: 8, ciFailCount: 2, ciPassRate: 0.8, ciAvgDurationMs: 1200,
      }),
      makeDailyMetricsRow('2026-06-13', {
        ciTotalRuns: 5, ciPassCount: 4, ciFailCount: 1, ciPassRate: 0.8, ciAvgDurationMs: 800,
      }),
    ], new Date('2026-06-14T12:00:00Z'), false, null)

    expect(window.cards.ci).toMatchObject({
      totalRuns: 15,
      passCount: 12,
      failCount: 3,
      passRate: 0.8,
      sourceDays: 2,
      status: 'available',
    })
    expect(window.cards.ci.averageDurationMs).toBeCloseTo(1066.67, 0)
  })
})
