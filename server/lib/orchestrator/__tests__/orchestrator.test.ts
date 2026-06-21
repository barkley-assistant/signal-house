import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import * as db from '../../../db/client'

jest.mock('../../../db/client', () => ({
  initDb: jest.fn().mockResolvedValue(undefined),
  persistSnapshot: jest.fn(),
  getLatestSnapshot: jest.fn().mockReturnValue(null),
  upsertOpenCodeDailyUsage: jest.fn(),
}))

jest.mock('../../github/collector', () => ({
  createCollector: jest.fn(),
  collectWithConcurrency: async <T, R>(items: T[], _limit: number, fn: (item: T, index: number) => Promise<R>) =>
    await Promise.all(items.map((item, index) => fn(item, index))),
}))

jest.mock('../../git/collector', () => ({
  createLocalGitCollector: jest.fn(),
}))

jest.mock('../../sessions/collector', () => ({
  createSessionCollector: jest.fn(),
}))

jest.mock('../../opencode-daily/collector', () => ({
  collectDailyOpenCodeUsage: jest.fn().mockReturnValue({
    date: '2026-06-19',
    source: 'opencode',
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: null,
    rawJson: null,
    collectedAt: '2026-06-19T12:00:00.000Z',
    errors: [],
  }),
}))

import { createCollector as mockGhCreate } from '../../github/collector'
import { createLocalGitCollector as mockGitCreate } from '../../git/collector'
import { createSessionCollector as mockSessionCreate } from '../../sessions/collector'
import { createOrchestrator } from '../index'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('createOrchestrator', () => {
  it('returns result with empty sources when no collectors configured', async () => {
    const orchestrator = createOrchestrator({})
    const result = await orchestrator.collect()

    expect(result.snapshotId).toBeTruthy()
    expect(result.capturedAt).toBeTruthy()
    expect(result.sources).toEqual(['opencodeDaily'])
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)
    expect(db.persistSnapshot).toHaveBeenCalledTimes(1)
  })

  it('runs all configured collectors and merges data', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const gitCollector = { collect: jest.fn() }
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 100,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: '1', title: 'Test Issue', state: 'open' as const,
          createdAt: '', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        workflowRuns: [],
        repositories: [{
          id: '1', name: 'repo', repoKey: 'github:test/repo', localPath: null, remoteUrl: 'https://github.com/test/repo',
          githubOwner: 'test', githubRepo: 'repo', source: 'github',
          owner: 'test', description: null,
          defaultBranch: 'main', isPrivate: false,
          updatedAt: '', pushedAt: '', url: '',
        }],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: {
            periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-06-01T00:00:00Z',
            issuesClosed: 0, issuesOpened: 1, prsMerged: 0, prsCreated: 0, totalCommits: 0,
          },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 100, partialData: false, errors: [] },
      },
    })

    gitCollector.collect.mockResolvedValue({
      repos: [{
        repoKey: 'local:/home/repo1',
        source: 'local',
        path: '/home/repo1',
        repoName: 'repo1',
        remoteUrl: null,
        githubOwner: null,
        githubRepo: null,
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 5,
        commitsByDay: {},
        authors: ['alice@example.com'],
        latestCommitAt: '2025-06-01T12:00:00Z',
        error: null,
      }],
      errors: [],
    })

    sessionCollector.collect.mockResolvedValue({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: 'now', durationMs: 100, metadata: {}, success: true },
        { id: 's2', toolName: 'opencode', action: 'edit', timestamp: 'now', durationMs: 200, metadata: {}, success: true },
        { id: 's3', toolName: 'opencode', action: 'search', timestamp: 'now', durationMs: 50, metadata: {}, success: true },
      ],
      sessionUsage: {
        periodStart: '2025-05-01T00:00:00Z',
        periodEnd: '2025-06-01T12:00:00Z',
        totalSessions: 3,
        startedSessions: 3,
        completedSessions: 2,
        erroredSessions: 1,
        stuckSessions: 0,
        lastActivityAt: '2025-06-01T11:30:00Z',
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
        uniqueTools: ['opencode'],
        toolUsage: [{ toolName: 'opencode', count: 3, percentage: 100 }],
        topActions: [{ action: 'edit', count: 2 }, { action: 'search', count: 1 }],
        errorCount: 0,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      localGit: { repos: [{ path: '/home/repo1' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.sources).toContain('github')
    expect(result.sources).toContain('localGit')
    expect(result.sources).toContain('sessions')
    expect(result.sources).toContain('opencodeDaily')
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.issues).toHaveLength(1)
    expect(snapshotArg.sessions).toHaveLength(3)
    expect(snapshotArg.localGit).toHaveLength(1)
    expect(snapshotArg.localGit[0]!.recentCommits).toBe(5)
    expect(snapshotArg.repositories).toHaveLength(2)
  })

  it('collects multiple GitHub targets and merges their raw metrics', async () => {
    const ghCollectorA = { collect: jest.fn(), getApiClient: jest.fn() }
    const ghCollectorB = { collect: jest.fn(), getApiClient: jest.fn() }

    jest.mocked(mockGhCreate)
      .mockReturnValueOnce(ghCollectorA as never)
      .mockReturnValueOnce(ghCollectorB as never)

    ghCollectorA.collect.mockResolvedValue({
      snapshotId: 'gh-a',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-a',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: 'a', title: 'A', state: 'open' as const,
          createdAt: '', updatedAt: '', closedAt: null, repo: 'test/one', repoKey: 'github:test/one',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-06-01T00:00:00Z', issuesClosed: 0, issuesOpened: 1, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    ghCollectorB.collect.mockResolvedValue({
      snapshotId: 'gh-b',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-b',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: 'b', title: 'B', state: 'closed' as const,
          createdAt: '', updatedAt: '', closedAt: null, repo: 'test/two', repoKey: 'github:test/two',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-06-01T00:00:00Z', issuesClosed: 0, issuesOpened: 1, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    const orchestrator = createOrchestrator({
      github: [
        { owner: 'test', repo: 'one', token: 'tok' },
        { owner: 'test', repo: 'two', token: 'tok' },
      ],
    })

    await orchestrator.collect()

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.issues).toHaveLength(2)
  })

  it('keeps the other GitHub target when one target fails', async () => {
    const ghCollectorA = { collect: jest.fn(), getApiClient: jest.fn() }
    const ghCollectorB = { collect: jest.fn(), getApiClient: jest.fn() }

    jest.mocked(mockGhCreate)
      .mockReturnValueOnce(ghCollectorA as never)
      .mockReturnValueOnce(ghCollectorB as never)

    ghCollectorA.collect.mockResolvedValue({
      snapshotId: 'gh-a',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-a',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: 'a', title: 'A', state: 'open' as const,
          createdAt: '', updatedAt: '', closedAt: null, repo: 'test/one', repoKey: 'github:test/one',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-06-01T00:00:00Z', issuesClosed: 0, issuesOpened: 1, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    ghCollectorB.collect.mockRejectedValue(new Error('target failed'))

    const orchestrator = createOrchestrator({
      github: [
        { owner: 'test', repo: 'one', token: 'tok' },
        { owner: 'test', repo: 'two', token: 'tok' },
      ],
    })

    const result = await orchestrator.collect()

    expect(result.partialData).toBe(true)
    expect(result.errors.some(err => err.includes('target failed'))).toBe(true)
  })

  it('merges local and GitHub identity for the same repository key', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const gitCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 0,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 100,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [],
        pullRequests: [],
        workflowRuns: [],
        repositories: [{
          id: '1', name: 'repo', repoKey: 'github:test/repo', localPath: null, remoteUrl: 'https://github.com/test/repo',
          githubOwner: 'test', githubRepo: 'repo', source: 'github',
          owner: 'test', description: null,
          defaultBranch: 'main', isPrivate: false,
          updatedAt: '', pushedAt: '', url: '',
        }],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: {
            periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-06-01T00:00:00Z',
            issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0,
          },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 100, partialData: false, errors: [] },
      },
    })

    gitCollector.collect.mockResolvedValue({
      repos: [{
        repoKey: 'github:test/repo',
        source: 'both',
        path: '/home/repo',
        repoName: 'repo',
        remoteUrl: 'https://github.com/test/repo',
        githubOwner: 'test',
        githubRepo: 'repo',
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 5,
        commitsByDay: {},
        authors: ['alice@example.com'],
        latestCommitAt: '2025-06-01T12:00:00Z',
        error: null,
      }],
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      localGit: { repos: [{ path: '/home/repo' }] },
    })

    const result = await orchestrator.collect()

    expect(result.errors).toHaveLength(0)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.repositories).toHaveLength(1)
    expect(snapshotArg.repositories[0]).toMatchObject({
      repoKey: 'github:test/repo',
      localPath: '/home/repo',
      remoteUrl: 'https://github.com/test/repo',
      githubOwner: 'test',
      githubRepo: 'repo',
      source: 'both',
    })
  })

  it('preserves sessionUsage when no GitHub collector configured', async () => {
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    sessionCollector.collect.mockResolvedValue({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: 'now', durationMs: 100, metadata: {}, success: true },
        { id: 's2', toolName: 'opencode', action: 'search', timestamp: 'now', durationMs: 200, metadata: {}, success: true },
      ],
      sessionUsage: {
        periodStart: '2025-05-01T00:00:00Z',
        periodEnd: '2025-06-01T12:00:00Z',
        totalSessions: 2,
        startedSessions: 2,
        completedSessions: 2,
        erroredSessions: 0,
        stuckSessions: 0,
        lastActivityAt: '2025-06-01T11:30:00Z',
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
        uniqueTools: ['opencode'],
        toolUsage: [{ toolName: 'opencode', count: 2, percentage: 100 }],
        topActions: [{ action: 'edit', count: 1 }, { action: 'search', count: 1 }],
        errorCount: 0,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.sources).toContain('sessions')
    expect(result.sources).toContain('opencodeDaily')
    expect(result.sources).not.toContain('github')
    expect(result.sources).not.toContain('localGit')
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.sessions).toHaveLength(2)
    expect(snapshotArg.aggregates.sessionUsage).not.toBeNull()
    expect(snapshotArg.aggregates.sessionUsage!.totalSessions).toBe(2)
  })

  it('preserves sessionUsage when only localGit and sessions configured', async () => {
    const gitCollector = { collect: jest.fn() }
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    gitCollector.collect.mockResolvedValue({
      repos: [{
        repoKey: 'local:/home/repo1',
        source: 'local',
        path: '/home/repo1',
        repoName: 'repo1',
        remoteUrl: null,
        githubOwner: null,
        githubRepo: null,
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 10,
        commitsByDay: {},
        authors: ['alice@example.com'],
        latestCommitAt: '2025-06-01T12:00:00Z',
        error: null,
      }],
      errors: [],
    })

    sessionCollector.collect.mockResolvedValue({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: 'now', durationMs: 100, metadata: {}, success: true },
      ],
      sessionUsage: {
        periodStart: '2025-05-01T00:00:00Z',
        periodEnd: '2025-06-01T12:00:00Z',
        totalSessions: 1,
        startedSessions: 1,
        completedSessions: 1,
        erroredSessions: 0,
        stuckSessions: 0,
        lastActivityAt: '2025-06-01T11:30:00Z',
        messages: 2,
        activeDays: 1,
        totalCost: 1.25,
        averageCostPerDay: 1.25,
        averageTokensPerSession: 100,
        medianTokensPerSession: 80,
        inputTokens: 60,
        outputTokens: 30,
        cacheReadTokens: 5,
        cacheWriteTokens: 10,
        uniqueTools: ['opencode'],
        toolUsage: [{ toolName: 'opencode', count: 1, percentage: 100 }],
        topActions: [{ action: 'edit', count: 1 }],
        errorCount: 0,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      localGit: { repos: [{ path: '/home/repo1' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.sources).toContain('localGit')
    expect(result.sources).toContain('sessions')
    expect(result.sources).toContain('opencodeDaily')
    expect(result.errors).toHaveLength(0)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.sessions).toHaveLength(1)
    expect(snapshotArg.localGit).toHaveLength(1)
    expect(snapshotArg.aggregates.sessionUsage).not.toBeNull()
    expect(snapshotArg.aggregates.sessionUsage!.totalSessions).toBe(1)
    expect(snapshotArg.aggregates.throughput.totalCommits).toBe(10)
  })

  it('handles partial collector failure gracefully', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const gitCollector = { collect: jest.fn() }
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 0,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '', periodEnd: '', issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: '', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    gitCollector.collect.mockResolvedValue({
      repos: [],
      errors: ['Path does not exist: /bad/path'],
    })

    sessionCollector.collect.mockRejectedValue(new Error('CLI crashed'))

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      localGit: { repos: [{ path: '/bad/path' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.partialData).toBe(true)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('includes workflow runs from GitHub collector in the merged snapshot', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 0,
      prsCount: 0,
      workflowRunsCount: 2,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [],
        pullRequests: [],
        workflowRuns: [
          {
            id: 'w1', name: 'CI', status: 'completed', conclusion: 'success',
            createdAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T11:00:00Z',
            headSha: 'abc', repo: 'test/repo', repoKey: 'github:test/repo',
            branch: 'main', workflowName: 'CI', url: null,
          },
          {
            id: 'w2', name: 'CI', status: 'completed', conclusion: 'failure',
            createdAt: '2026-06-02T10:00:00Z', completedAt: '2026-06-02T11:00:00Z',
            headSha: 'def', repo: 'test/repo', repoKey: 'github:test/repo',
            branch: 'main', workflowName: 'CI', url: null,
          },
        ],
        repositories: [{
          id: '1', name: 'repo', repoKey: 'github:test/repo', localPath: null, remoteUrl: 'https://github.com/test/repo',
          githubOwner: 'test', githubRepo: 'repo', source: 'github',
          owner: 'test', description: null,
          defaultBranch: 'main', isPrivate: false,
          updatedAt: '', pushedAt: '', url: '',
        }],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-02T00:00:00Z', issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-02T00:00:00Z', totalRuns: 2, passCount: 1, failCount: 1, passRate: 0.5, averageDurationMs: null },
          staleWork: { asOf: 'now', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
    })

    await orchestrator.collect()

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.workflowRuns).toHaveLength(2)
    expect(snapshotArg.workflowRuns[0]!.id).toBe('w1')
    expect(snapshotArg.workflowRuns[1]!.id).toBe('w2')
    expect(snapshotArg.aggregates.ci).not.toBeNull()
    expect(snapshotArg.aggregates.ci!.totalRuns).toBe(2)
  })

  it('propagates collector errors into snapshot metadata errors', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const gitCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 0,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: ['GitHub API rate limited'],
      partialData: true,
      durationMs: 50,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '', periodEnd: '', issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: '', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: true, errors: ['GitHub API rate limited'] },
      },
    })

    gitCollector.collect.mockResolvedValue({
      repos: [],
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      localGit: { repos: [{ path: '/home/repo1' }] },
    })

    const result = await orchestrator.collect()

    expect(result.errors).toContain('GitHub API rate limited')
    expect(result.partialData).toBe(true)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.metadata.errors).toContain('GitHub API rate limited')
    expect(snapshotArg.metadata.partialData).toBe(true)
  })

  it('merges comprehensive data from all collectors including local git commits by day and session errors', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const gitCollector = { collect: jest.fn() }
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 3,
      prsCount: 3,
      workflowRunsCount: 2,
      errors: [],
      partialData: false,
      durationMs: 100,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [
          { id: 'i1', title: 'Issue 1', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' },
          { id: 'i2', title: 'Issue 2', state: 'closed', createdAt: '2026-06-02T10:00:00Z', updatedAt: '', closedAt: '2026-06-04T10:00:00Z', repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' },
          { id: 'i3', title: 'Issue 3', state: 'open', createdAt: '2026-06-03T10:00:00Z', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' },
        ],
        pullRequests: [
          { id: 'pr1', title: 'Merged PR', state: 'merged', createdAt: '2026-06-01T10:00:00Z', updatedAt: '', headSha: 'a', mergedAt: '2026-06-02T10:00:00Z', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', author: 'x', labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null },
          { id: 'pr2', title: 'Open PR', state: 'open', createdAt: '2026-06-02T10:00:00Z', updatedAt: '', headSha: 'b', mergedAt: null, closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', author: 'x', labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null },
          { id: 'pr3', title: 'Closed-unmerged PR', state: 'closed', createdAt: '2026-06-03T10:00:00Z', updatedAt: '', headSha: 'c', mergedAt: null, closedAt: '2026-06-04T10:00:00Z', repo: 'test/repo', repoKey: 'github:test/repo', author: 'x', labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null },
        ],
        workflowRuns: [
          { id: 'w1', name: 'CI', status: 'completed', conclusion: 'success', createdAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T11:00:00Z', headSha: 'a', repo: 'test/repo', repoKey: 'github:test/repo', branch: 'main', workflowName: 'CI', url: null },
          { id: 'w2', name: 'CI', status: 'completed', conclusion: 'failure', createdAt: '2026-06-03T10:00:00Z', completedAt: '2026-06-03T11:00:00Z', headSha: 'c', repo: 'test/repo', repoKey: 'github:test/repo', branch: 'main', workflowName: 'CI', url: null },
        ],
        repositories: [{
          id: '1', name: 'repo', repoKey: 'github:test/repo', localPath: null, remoteUrl: 'https://github.com/test/repo',
          githubOwner: 'test', githubRepo: 'repo', source: 'github',
          owner: 'test', description: null,
          defaultBranch: 'main', isPrivate: false,
          updatedAt: '', pushedAt: '', url: '',
        }],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T00:00:00Z', issuesClosed: 1, issuesOpened: 3, prsMerged: 1, prsCreated: 3, totalCommits: 0 },
          cycleTime: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T00:00:00Z', averageDays: 2, medianDays: 1.5, p95Days: 4, sampleSize: 5 },
          ci: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-05T00:00:00Z', totalRuns: 2, passCount: 1, failCount: 1, passRate: 0.5, averageDurationMs: 3600000 },
          staleWork: { asOf: 'now', staleIssues: 2, stalePRs: 1, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 100, partialData: false, errors: [] },
      },
    })

    gitCollector.collect.mockResolvedValue({
      repos: [{
        repoKey: 'github:test/repo',
        source: 'both',
        path: '/home/repo',
        repoName: 'repo',
        remoteUrl: 'https://github.com/test/repo',
        githubOwner: 'test',
        githubRepo: 'repo',
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 10,
        commitsByDay: { '2026-06-01': 4, '2026-06-03': 6 },
        authors: ['alice@example.com'],
        latestCommitAt: '2026-06-03T12:00:00Z',
        error: null,
      }],
      errors: [],
    })

    sessionCollector.collect.mockResolvedValue({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: '2026-06-01T10:00:00Z', durationMs: 100, metadata: {}, success: true },
        { id: 's2', toolName: 'opencode', action: 'search', timestamp: '2026-06-01T11:00:00Z', durationMs: 50, metadata: {}, success: false },
        { id: 's3', toolName: 'opencode', action: 'edit', timestamp: '2026-06-04T10:00:00Z', durationMs: 200, metadata: {}, success: true },
      ],
      sessionUsage: {
        periodStart: '2026-05-01T00:00:00Z',
        periodEnd: '2026-06-05T12:00:00Z',
        totalSessions: 3,
        startedSessions: 3,
        completedSessions: 2,
        erroredSessions: 1,
        stuckSessions: 0,
        lastActivityAt: '2026-06-04T10:00:00Z',
        messages: 6,
        activeDays: 2,
        totalCost: 3.0,
        averageCostPerDay: 1.5,
        averageTokensPerSession: 100,
        medianTokensPerSession: 80,
        inputTokens: 60,
        outputTokens: 30,
        cacheReadTokens: 5,
        cacheWriteTokens: 10,
        uniqueTools: ['opencode'],
        toolUsage: [{ toolName: 'opencode', count: 3, percentage: 100 }],
        topActions: [{ action: 'edit', count: 2 }, { action: 'search', count: 1 }],
        errorCount: 1,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      localGit: { repos: [{ path: '/home/repo' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.issues).toHaveLength(3)
    expect(snapshotArg.pullRequests).toHaveLength(3)
    expect(snapshotArg.workflowRuns).toHaveLength(2)
    expect(snapshotArg.sessions).toHaveLength(3)
    expect(snapshotArg.localGit).toHaveLength(1)
    expect(snapshotArg.localGit[0]!.recentCommits).toBe(10)
    expect(snapshotArg.localGit[0]!.commitsByDay).toEqual({ '2026-06-01': 4, '2026-06-03': 6 })
    expect(snapshotArg.aggregates.cycleTime).not.toBeNull()
    expect(snapshotArg.aggregates.ci).not.toBeNull()
    expect(snapshotArg.aggregates.staleWork.staleIssues).toBe(2)
    expect(snapshotArg.aggregates.staleWork.stalePRs).toBe(1)
    expect(snapshotArg.aggregates.throughput.totalCommits).toBe(10)
    expect(snapshotArg.aggregates.sessionUsage).not.toBeNull()
    expect(snapshotArg.aggregates.sessionUsage!.totalSessions).toBe(3)
  })

  it('preserves sessionUsage when GitHub aggregates are rebuilt', async () => {
    const ghCollector = { collect: jest.fn(), getApiClient: jest.fn() }
    const sessionCollector = { collect: jest.fn() }

    jest.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    jest.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      workflowRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: 'i1', title: 'Issue 1', state: 'open' as const,
          createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-01T10:00:00Z', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        workflowRuns: [],
        repositories: [],
        sessions: [],
        localGit: [],
        errors: [],
        aggregates: {
          throughput: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-02T00:00:00Z', issuesClosed: 0, issuesOpened: 1, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
          cycleTime: null,
          ci: null,
          staleWork: { asOf: '2026-06-02T00:00:00Z', staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
          sessionUsage: null,
          computedAt: 'now',
        },
        metadata: { source: 'github' as const, refreshDurationMs: 50, partialData: false, errors: [] },
      },
    })

    sessionCollector.collect.mockResolvedValue({
      sessions: [
        { id: 's1', toolName: 'opencode', action: 'edit', timestamp: '2026-06-01T12:00:00Z', durationMs: 100, metadata: {}, success: true },
      ],
      sessionUsage: {
        periodStart: '2026-06-01T00:00:00Z',
        periodEnd: '2026-06-02T00:00:00Z',
        totalSessions: 1,
        startedSessions: 1,
        completedSessions: 1,
        erroredSessions: 0,
        stuckSessions: 0,
        lastActivityAt: '2026-06-01T12:00:00Z',
        messages: 1,
        activeDays: 1,
        totalCost: 1,
        averageCostPerDay: 1,
        averageTokensPerSession: 10,
        medianTokensPerSession: 10,
        inputTokens: 5,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        uniqueTools: ['opencode'],
        toolUsage: [{ toolName: 'opencode', count: 1, percentage: 100 }],
        topActions: [{ action: 'edit', count: 1 }],
        errorCount: 0,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: [{ owner: 'test', repo: 'repo', token: 'tok' }],
      sessions: {},
    })

    await orchestrator.collect()

    const snapshotArg = jest.mocked(db.persistSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.aggregates.sessionUsage).not.toBeNull()
    expect(snapshotArg.aggregates.sessionUsage!.totalSessions).toBe(1)
    expect(snapshotArg.aggregates.throughput.issuesOpened).toBe(1)
  })
})
