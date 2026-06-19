import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockSetHeader: vi.fn(),
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetRefreshRunState: vi.fn(),
  mockGetLatestSnapshot: vi.fn(),
}))

vi.mock('h3', () => ({
  defineEventHandler: (handler: Function) => handler,
  setHeader: mocks.mockSetHeader,
}))

vi.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getRefreshRunState: mocks.mockGetRefreshRunState,
  getLatestSnapshot: mocks.mockGetLatestSnapshot,
}))

import handler from '../diagnostics.get'

describe('GET /api/diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T12:00:00Z'))
    vi.clearAllMocks()
    mocks.mockGetRefreshRunState.mockReturnValue({
      status: 'success',
      lastRunStartedAt: '2026-06-14T11:59:00Z',
      lastRunFinishedAt: '2026-06-14T12:00:00Z',
      lastSuccessAt: '2026-06-14T12:00:00Z',
      lastFailureAt: null,
      nextRunAt: null,
      lastError: null,
      durationMs: 60000,
      sourceHealth: {
        github: { status: 'healthy', message: null },
      },
      runHistory: [
        {
          startedAt: '2026-06-14T11:59:00Z',
          finishedAt: '2026-06-14T12:00:00Z',
          durationMs: 60000,
          success: true,
          partialData: false,
          sources: ['github'],
          warnings: ['slow response'],
          errorSummary: null,
          skipped: false,
          skippedReason: null,
        },
      ],
    })
    mocks.mockGetLatestSnapshot.mockReturnValue({
      id: 'snap-1',
      capturedAt: '2026-06-14T11:58:00Z',
      localGit: [
        {
          repoKey: 'repo-a',
          repoName: 'repo-a',
          path: '/tmp/repo-a',
          remoteUrl: 'https://github.com/example/repo-a',
          githubOwner: 'example',
          githubRepo: 'repo-a',
          source: 'both',
        },
      ],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns full source diagnostics without extra database work', async () => {
    const result = await handler({} as any)

    expect(mocks.mockInitDb).toHaveBeenCalledOnce()
    expect(mocks.mockSetHeader).toHaveBeenCalledWith(expect.anything(), 'Cache-Control', 'no-cache')
    expect(result).toMatchObject({
      configuredProjectRoots: [],
      discoveredRepos: [
        {
          repoKey: 'repo-a',
          name: 'repo-a',
          path: '/tmp/repo-a',
          remoteUrl: 'https://github.com/example/repo-a',
          githubOwner: 'example',
          githubRepo: 'repo-a',
          source: 'both',
        },
      ],
      skippedPaths: [
        { path: 'refresh', message: 'slow response' },
      ],
      parsedGitHubRemotes: [
        {
          repoKey: 'repo-a',
          remoteUrl: 'https://github.com/example/repo-a',
          githubOwner: 'example',
          githubRepo: 'repo-a',
        },
      ],
      collectionTargets: ['github'],
      cacheAgeSeconds: 120,
      pollerEnabled: false,
      pollerIntervalSeconds: null,
      lastSuccessfulRefreshAt: '2026-06-14T12:00:00Z',
      lastError: null,
      sourceHealth: {
        github: { status: 'healthy', message: null },
      },
    })
  })
})
