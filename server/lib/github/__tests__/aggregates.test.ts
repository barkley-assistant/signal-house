import { describe, it, expect } from 'vitest'
import {
  deriveThroughput,
  deriveCycleTime,
  deriveStaleWork,
  deriveCI,
  deriveMergeRate,
} from '../aggregates'
import type { IssueMetric, PullRequestMetric, CheckRunMetric } from '../../../../types/metrics'

function makeIssue(overrides: Partial<IssueMetric> & { id: string }): IssueMetric {
  return {
    title: '',
    state: 'open',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    closedAt: null,
    repo: 'test/repo',
    repoKey: 'github:test/repo',
    labels: [],
    assignee: null,
    milestone: null,
    url: '',
    ...overrides,
  }
}

function makePR(overrides: Partial<PullRequestMetric> & { id: string }): PullRequestMetric {
  return {
    title: '',
    state: 'open',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    mergedAt: null,
    closedAt: null,
    repo: 'test/repo',
    repoKey: 'github:test/repo',
    author: 'user',
    labels: [],
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    url: '',
    ciStatus: null,
    ...overrides,
  }
}

function makeCheckRun(overrides: Partial<CheckRunMetric> & { id: string }): CheckRunMetric {
  return {
    name: 'test',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2025-01-01T00:00:00Z',
    completedAt: null,
    repo: 'test/repo',
    repoKey: 'github:test/repo',
    branch: 'main',
    workflowName: 'CI',
    url: null,
    ...overrides,
  }
}

describe('deriveThroughput', () => {
  const ps = '2025-01-01T00:00:00Z'
  const pe = '2025-01-31T23:59:59Z'

  it('counts opened and closed issues in period', () => {
    const issues = [
      makeIssue({ id: '1', createdAt: '2025-01-05T00:00:00Z', closedAt: '2025-01-10T00:00:00Z' }),
      makeIssue({ id: '2', createdAt: '2025-01-15T00:00:00Z', closedAt: null }),
      makeIssue({ id: '3', createdAt: '2024-12-01T00:00:00Z', closedAt: '2025-01-20T00:00:00Z' }),
    ]
    const result = deriveThroughput(issues, [], ps, pe)
    expect(result.issuesOpened).toBe(2)
    expect(result.issuesClosed).toBe(2)
  })

  it('counts created and merged PRs in period', () => {
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-05T00:00:00Z', mergedAt: '2025-01-10T00:00:00Z', state: 'merged' }),
      makePR({ id: '2', createdAt: '2025-02-01T00:00:00Z', state: 'open' }),
    ]
    const result = deriveThroughput([], prs, ps, pe)
    expect(result.prsCreated).toBe(1)
    expect(result.prsMerged).toBe(1)
  })

  it('returns zeros for empty inputs', () => {
    const result = deriveThroughput([], [], ps, pe)
    expect(result).toEqual({
      periodStart: ps, periodEnd: pe,
      issuesClosed: 0, issuesOpened: 0,
      prsMerged: 0, prsCreated: 0,
      totalCommits: 0,
    })
  })
})

describe('deriveCycleTime', () => {
  const ps = '2025-01-01T00:00:00Z'
  const pe = '2025-01-31T23:59:59Z'

  it('computes average, median, and p95 for merged PRs', () => {
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-03T00:00:00Z', state: 'merged' }),
      makePR({ id: '2', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-05T00:00:00Z', state: 'merged' }),
      makePR({ id: '3', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-11T00:00:00Z', state: 'merged' }),
    ]
    const result = deriveCycleTime(prs, ps, pe)
    expect(result).not.toBeNull()
    expect(result!.sampleSize).toBe(3)
    expect(result!.averageDays).toBeCloseTo(5.33, 1)
    expect(result!.medianDays).toBe(4)
    expect(result!.p95Days).toBe(10)
  })

  it('returns null when no PRs merged in period', () => {
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-02-01T00:00:00Z', state: 'merged' }),
    ]
    expect(deriveCycleTime(prs, ps, pe)).toBeNull()
  })

  it('returns null for empty PR list', () => {
    expect(deriveCycleTime([], ps, pe)).toBeNull()
  })
})

describe('deriveStaleWork', () => {
  it('counts stale open issues and PRs', () => {
    const now = '2025-02-01T00:00:00Z'
    const issues = [
      makeIssue({ id: '1', state: 'open', updatedAt: '2025-01-01T00:00:00Z' }),
      makeIssue({ id: '2', state: 'open', updatedAt: '2025-01-30T00:00:00Z' }),
      makeIssue({ id: '3', state: 'closed', updatedAt: '2025-01-01T00:00:00Z' }),
    ]
    const prs = [
      makePR({ id: '1', state: 'open', updatedAt: '2025-01-01T00:00:00Z' }),
    ]
    const result = deriveStaleWork(issues, prs, 14, now)
    expect(result.staleIssues).toBe(1) // issue 1 (updated Jan 1, >14 days old)
    expect(result.stalePRs).toBe(1)
    expect(result.oldestItemDays).toBeCloseTo(31, 0)
  })

  it('handles empty data', () => {
    const result = deriveStaleWork([], [], 14, '2025-02-01T00:00:00Z')
    expect(result.staleIssues).toBe(0)
    expect(result.stalePRs).toBe(0)
    expect(result.oldestItemDays).toBeNull()
  })
})

describe('deriveCI', () => {
  const ps = '2025-01-01T00:00:00Z'
  const pe = '2025-01-31T23:59:59Z'

  it('computes pass rate and counts', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'failure', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
      makeCheckRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-07T01:00:00Z' }),
      makeCheckRun({ id: '4', createdAt: '2025-02-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-02-01T01:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(3)
    expect(result.passCount).toBe(2)
    expect(result.failCount).toBe(1)
    expect(result.passRate).toBeCloseTo(2 / 3, 2)
    expect(result.averageDurationMs).toBeGreaterThan(0)
  })

  it('computes average duration correctly', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-01T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-01-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-01T03:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    const expected1 = 60 * 60 * 1000
    const expected2 = 3 * 60 * 60 * 1000
    expect(result.averageDurationMs).toBe((expected1 + expected2) / 2)
  })

  it('returns null averageDurationMs when no runs have completedAt', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: null }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(1)
    expect(result.averageDurationMs).toBeNull()
  })

  it('treats timed_out as failure', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'timed_out', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.passCount).toBe(1)
    expect(result.failCount).toBe(1)
    expect(result.passRate).toBeCloseTo(0.5, 2)
  })

  it('does not count cancelled or skipped runs as pass or fail', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'cancelled', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
      makeCheckRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: 'skipped', status: 'completed', completedAt: '2025-01-07T01:00:00Z' }),
      makeCheckRun({ id: '4', createdAt: '2025-01-08T00:00:00Z', conclusion: 'action_required', status: 'completed', completedAt: '2025-01-08T01:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(4)
    expect(result.passCount).toBe(1)
    expect(result.failCount).toBe(0)
    expect(result.passRate).toBeCloseTo(0.25, 2)
  })

  it('excludes in-progress and queued runs', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: null, status: 'in_progress', completedAt: null }),
      makeCheckRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: null, status: 'queued', completedAt: null }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(1)
    expect(result.passCount).toBe(1)
  })

  it('excludes runs outside the period', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2024-12-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2024-12-01T01:00:00Z' }),
      makeCheckRun({ id: '2', createdAt: '2025-02-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-02-01T01:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(0)
    expect(result.passRate).toBe(0)
  })

  it('handles null conclusion on completed runs', () => {
    const checks = [
      makeCheckRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: null, status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
    ]
    const result = deriveCI(checks, ps, pe)
    expect(result.totalRuns).toBe(1)
    expect(result.passCount).toBe(0)
    expect(result.failCount).toBe(0)
  })

  it('has passRate 0 on no runs', () => {
    const result = deriveCI([], ps, pe)
    expect(result.totalRuns).toBe(0)
    expect(result.passRate).toBe(0)
    expect(result.averageDurationMs).toBeNull()
  })
})

describe('deriveMergeRate', () => {
  const ps = '2025-01-01T00:00:00Z'
  const pe = '2025-01-31T23:59:59Z'

  it('computes merge rate from created and merged PRs', () => {
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-05T00:00:00Z', mergedAt: '2025-01-10T00:00:00Z', state: 'merged' }),
      makePR({ id: '2', createdAt: '2025-01-15T00:00:00Z', mergedAt: null, state: 'open' }),
    ]
    const result = deriveMergeRate(prs, ps, pe)
    expect(result.totalCreated).toBe(2)
    expect(result.totalMerged).toBe(1)
    expect(result.mergeRate).toBe(0.5)
  })
})
