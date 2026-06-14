import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as db from '../../../db/client'

vi.mock('../../../db/client', () => ({
  initDb: vi.fn().mockResolvedValue(undefined),
  insertSnapshot: vi.fn(),
  insertAggregate: vi.fn(),
  getLatestSnapshot: vi.fn().mockReturnValue(null),
}))

vi.mock('../../github/collector', () => ({
  createCollector: vi.fn(),
}))

vi.mock('../../git/collector', () => ({
  createLocalGitCollector: vi.fn(),
}))

vi.mock('../../sessions/collector', () => ({
  createSessionCollector: vi.fn(),
}))

import { createCollector as mockGhCreate } from '../../github/collector'
import { createLocalGitCollector as mockGitCreate } from '../../git/collector'
import { createSessionCollector as mockSessionCreate } from '../../sessions/collector'
import { createOrchestrator } from '../index'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createOrchestrator', () => {
  it('returns result with empty sources when no collectors configured', async () => {
    const orchestrator = createOrchestrator({})
    const result = await orchestrator.collect()

    expect(result.snapshotId).toBeTruthy()
    expect(result.capturedAt).toBeTruthy()
    expect(result.sources).toEqual([])
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)
    expect(db.insertSnapshot).toHaveBeenCalledTimes(1)
  })

  it('runs all configured collectors and merges data', async () => {
    const ghCollector = { collect: vi.fn(), getApiClient: vi.fn() }
    const gitCollector = { collect: vi.fn() }
    const sessionCollector = { collect: vi.fn() }

    vi.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    vi.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    vi.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 1,
      prsCount: 0,
      checkRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 100,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [{
          id: '1', title: 'Test Issue', state: 'open' as const,
          createdAt: '', updatedAt: '', closedAt: null, repo: 'test/repo',
          labels: [], assignee: null, milestone: null, url: '',
        }],
        pullRequests: [],
        checkRuns: [],
        repositories: [{
          id: '1', name: 'repo', owner: 'test', description: null,
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
        path: '/home/repo1',
        repoName: 'repo1',
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 5,
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
        uniqueTools: ['opencode'],
        topActions: [{ action: 'edit', count: 2 }, { action: 'search', count: 1 }],
        errorCount: 0,
      },
      gap: null,
      errors: [],
    })

    const orchestrator = createOrchestrator({
      github: { owner: 'test', repo: 'repo', token: 'tok' },
      localGit: { repos: [{ path: '/home/repo1' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.sources).toContain('github')
    expect(result.sources).toContain('localGit')
    expect(result.sources).toContain('sessions')
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)

    const snapshotArg = vi.mocked(db.insertSnapshot).mock.calls[0]![0] as import('../../../../types/snapshot').MetricSnapshot
    expect(snapshotArg.issues).toHaveLength(1)
    expect(snapshotArg.sessions).toHaveLength(3)
    expect(snapshotArg.localGit).toHaveLength(1)
    expect(snapshotArg.localGit[0]!.recentCommits).toBe(5)
    expect(snapshotArg.repositories).toHaveLength(2)
  })

  it('handles partial collector failure gracefully', async () => {
    const ghCollector = { collect: vi.fn(), getApiClient: vi.fn() }
    const gitCollector = { collect: vi.fn() }
    const sessionCollector = { collect: vi.fn() }

    vi.mocked(mockGhCreate).mockReturnValue(ghCollector as never)
    vi.mocked(mockGitCreate).mockReturnValue(gitCollector as never)
    vi.mocked(mockSessionCreate).mockReturnValue(sessionCollector as never)

    ghCollector.collect.mockResolvedValue({
      snapshotId: 'gh-id',
      capturedAt: new Date().toISOString(),
      issuesCount: 0,
      prsCount: 0,
      checkRunsCount: 0,
      errors: [],
      partialData: false,
      durationMs: 50,
      snapshot: {
        id: 'gh-id',
        capturedAt: new Date().toISOString(),
        issues: [],
        pullRequests: [],
        checkRuns: [],
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
      github: { owner: 'test', repo: 'repo', token: 'tok' },
      localGit: { repos: [{ path: '/bad/path' }] },
      sessions: {},
    })

    const result = await orchestrator.collect()

    expect(result.partialData).toBe(true)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
