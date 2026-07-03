import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals'
import { deriveMergeRate, deriveAll } from '../aggregates'
import type { IssueMetric, PullRequestMetric, WorkflowRunMetric } from '../../../../types/metrics'

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
    headSha: 'abc123',
    mergedAt: null,
    closedAt: null,
    repo: 'test/repo',
    repoKey: 'github:test/repo',
    author: 'user',
    labels: [],
    additions: null,
    deletions: null,
    changedFiles: null,
    url: '',
    ciStatus: null,
    ...overrides,
  }
}

function makeWorkflowRun(overrides: Partial<WorkflowRunMetric> & { id: string }): WorkflowRunMetric {
  return {
    name: 'test',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2025-01-01T00:00:00Z',
    completedAt: null,
    headSha: 'abc123',
    repo: 'test/repo',
    repoKey: 'github:test/repo',
    branch: 'main',
    workflowName: 'CI',
    url: null,
    ...overrides,
  }
}

describe('deriveAll — throughput', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-02-01T00:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('counts opened and closed issues in period', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const issues = [
      makeIssue({ id: '1', createdAt: '2025-01-05T00:00:00Z', closedAt: '2025-01-10T00:00:00Z' }),
      makeIssue({ id: '2', createdAt: '2025-01-15T00:00:00Z', closedAt: null }),
      makeIssue({ id: '3', createdAt: '2024-12-01T00:00:00Z', closedAt: '2025-01-20T00:00:00Z' }),
    ]
    const result = deriveAll(issues, [], [], config)
    expect(result.throughput.issuesOpened).toBe(2)
    expect(result.throughput.issuesClosed).toBe(2)
  })

  it('counts created and merged PRs in period', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-05T00:00:00Z', mergedAt: '2025-01-10T00:00:00Z', state: 'merged' }),
      makePR({ id: '2', createdAt: '2025-02-02T00:00:00Z', state: 'open' }),
    ]
    const result = deriveAll([], prs, [], config)
    expect(result.throughput.prsCreated).toBe(1)
    expect(result.throughput.prsMerged).toBe(1)
  })

  it('returns zeros for empty inputs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const result = deriveAll([], [], [], config)
    expect(result.throughput.issuesClosed).toBe(0)
    expect(result.throughput.issuesOpened).toBe(0)
    expect(result.throughput.prsMerged).toBe(0)
    expect(result.throughput.prsCreated).toBe(0)
    expect(result.throughput.totalCommits).toBe(0)
  })
})

describe('deriveAll — cycleTime', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-02-01T00:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('computes average, median, and p95 for merged PRs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-03T00:00:00Z', state: 'merged' }),
      makePR({ id: '2', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-05T00:00:00Z', state: 'merged' }),
      makePR({ id: '3', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-01-11T00:00:00Z', state: 'merged' }),
    ]
    const result = deriveAll([], prs, [], config)
    expect(result.cycleTime).not.toBeNull()
    expect(result.cycleTime!.sampleSize).toBe(3)
    expect(result.cycleTime!.averageSeconds).toBeCloseTo(((2 + 4 + 10) / 3) * 86400, 0)
    expect(result.cycleTime!.medianSeconds).toBe(4 * 86400)
    expect(result.cycleTime!.p95Seconds).toBe(10 * 86400)
  })

  it('returns null when no PRs merged in period', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const prs = [
      makePR({ id: '1', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2025-02-02T00:00:00Z', state: 'merged' }),
    ]
    const result = deriveAll([], prs, [], config)
    expect(result.cycleTime).toBeNull()
  })

  it('returns null for empty PR list', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const result = deriveAll([], [], [], config)
    expect(result.cycleTime).toBeNull()
  })
})

describe('deriveAll — staleWork', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-02-01T00:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('counts stale open issues and PRs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const issues = [
      makeIssue({ id: '1', state: 'open', updatedAt: '2025-01-01T00:00:00Z' }),
      makeIssue({ id: '2', state: 'open', updatedAt: '2025-01-30T00:00:00Z' }),
      makeIssue({ id: '3', state: 'closed', updatedAt: '2025-01-01T00:00:00Z' }),
    ]
    const prs = [
      makePR({ id: '1', state: 'open', updatedAt: '2025-01-01T00:00:00Z' }),
    ]
    const result = deriveAll(issues, prs, [], config)
    expect(result.staleWork.staleIssues).toBe(1) // issue 1 (updated Jan 1, >14 days old)
    expect(result.staleWork.stalePRs).toBe(1)
    expect(result.staleWork.oldestItemDays).toBeCloseTo(31 * 86400, 0)
  })

  it('handles empty data', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const result = deriveAll([], [], [], config)
    expect(result.staleWork.staleIssues).toBe(0)
    expect(result.staleWork.stalePRs).toBe(0)
    expect(result.staleWork.oldestItemDays).toBeNull()
  })
})

describe('deriveAll — CI', () => {
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2025-02-01T00:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  it('computes pass rate and counts', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'failure', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
      makeWorkflowRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-07T01:00:00Z' }),
      makeWorkflowRun({ id: '4', createdAt: '2025-02-02T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-02-02T01:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(3)
    expect(result.ci.passCount).toBe(2)
    expect(result.ci.failCount).toBe(1)
    expect(result.ci.passRate).toBeCloseTo(2 / 3, 2)
    expect(result.ci.averageDurationMs).toBeGreaterThan(0)
  })

  it('computes average duration correctly', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-01T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-01-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-01T03:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    const expected1 = 60 * 60 * 1000
    const expected2 = 3 * 60 * 60 * 1000
    expect(result.ci.averageDurationMs).toBe((expected1 + expected2) / 2)
  })

  it('returns null averageDurationMs when no runs have completedAt', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: null }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(1)
    expect(result.ci.averageDurationMs).toBeNull()
  })

  it('treats timed_out as failure', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'timed_out', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.passCount).toBe(1)
    expect(result.ci.failCount).toBe(1)
    expect(result.ci.passRate).toBeCloseTo(0.5, 2)
  })

  it('does not count cancelled or skipped runs as pass or fail', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: 'cancelled', status: 'completed', completedAt: '2025-01-06T01:00:00Z' }),
      makeWorkflowRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: 'skipped', status: 'completed', completedAt: '2025-01-07T01:00:00Z' }),
      makeWorkflowRun({ id: '4', createdAt: '2025-01-08T00:00:00Z', conclusion: 'action_required', status: 'completed', completedAt: '2025-01-08T01:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(4)
    expect(result.ci.passCount).toBe(1)
    expect(result.ci.failCount).toBe(0)
    expect(result.ci.passRate).toBeCloseTo(0.25, 2)
  })

  it('excludes in-progress and queued runs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-01-06T00:00:00Z', conclusion: null, status: 'in_progress', completedAt: null }),
      makeWorkflowRun({ id: '3', createdAt: '2025-01-07T00:00:00Z', conclusion: null, status: 'queued', completedAt: null }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(1)
    expect(result.ci.passCount).toBe(1)
  })

  it('excludes runs outside the period', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2024-12-01T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2024-12-01T01:00:00Z' }),
      makeWorkflowRun({ id: '2', createdAt: '2025-02-02T00:00:00Z', conclusion: 'success', status: 'completed', completedAt: '2025-02-02T01:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(0)
    expect(result.ci.passRate).toBe(0)
  })

  it('handles null conclusion on completed runs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const checks = [
      makeWorkflowRun({ id: '1', createdAt: '2025-01-05T00:00:00Z', conclusion: null, status: 'completed', completedAt: '2025-01-05T01:00:00Z' }),
    ]
    const result = deriveAll([], [], checks, config)
    expect(result.ci.totalRuns).toBe(1)
    expect(result.ci.passCount).toBe(0)
    expect(result.ci.failCount).toBe(0)
  })

  it('has passRate 0 on no runs', () => {
    const config = { staleThresholdDays: 14, lookbackDays: 31 }
    const result = deriveAll([], [], [], config)
    expect(result.ci.totalRuns).toBe(0)
    expect(result.ci.passRate).toBe(0)
    expect(result.ci.averageDurationMs).toBeNull()
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
