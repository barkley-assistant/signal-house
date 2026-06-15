import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetRefreshInProgress: vi.fn(),
  mockSetRefreshInProgress: vi.fn(),
  mockSetRefreshRunState: vi.fn(),
  mockSetRefreshRunStatus: vi.fn(),
  mockCollect: vi.fn(),
}))

vi.mock('../../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getRefreshInProgress: mocks.mockGetRefreshInProgress,
  setRefreshInProgress: mocks.mockSetRefreshInProgress,
  setRefreshRunState: mocks.mockSetRefreshRunState,
  setRefreshRunStatus: mocks.mockSetRefreshRunStatus,
}))

vi.mock('../../orchestrator', () => ({
  createOrchestrator: vi.fn(() => ({
    collect: mocks.mockCollect,
  })),
}))

import { buildRefreshConfig, runRefresh } from '../run-refresh'

describe('buildRefreshConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds collector config from environment variables', () => {
    vi.stubEnv('GITHUB_TOKEN', 'token')
    vi.stubEnv('GITHUB_OWNER', 'owner')
    vi.stubEnv('GITHUB_REPO', 'repo')
    vi.stubEnv('GIT_REPOS', ' /tmp/a , /tmp/b ')
    vi.stubEnv('SESSIONS_PERIOD_DAYS', '21')
    vi.stubEnv('OPENCODE_BIN', '/usr/local/bin/opencode')
    vi.stubEnv('OPENCODE_COMMAND', 'opencode stats')

    expect(buildRefreshConfig()).toEqual({
      github: {
        owner: 'owner',
        repo: 'repo',
        token: 'token',
      },
      localGit: {
        repos: [{ path: '/tmp/a' }, { path: '/tmp/b' }],
      },
      sessions: {
        periodDays: 21,
        opencodeBin: '/usr/local/bin/opencode',
        opencodeCommand: 'opencode stats',
      },
    })
  })
})

describe('runRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetRefreshInProgress.mockReturnValue(false)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns a structured skipped result when a refresh is already running', async () => {
    mocks.mockGetRefreshInProgress.mockReturnValue(true)

    const result = await runRefresh()

    expect(result.skipped).toBe(true)
    expect(result.success).toBe(false)
    expect(result.errorSummary).toBe('Refresh already in progress')
    expect(mocks.mockSetRefreshInProgress).not.toHaveBeenCalled()
    expect(mocks.mockCollect).not.toHaveBeenCalled()
  })

  it('runs the orchestrator and returns a structured success result', async () => {
    mocks.mockCollect.mockResolvedValue({
      snapshotId: 'snapshot-1',
      capturedAt: '2026-06-15T12:00:00.000Z',
      sources: ['github', 'localGit'],
      errors: [],
      partialData: false,
      durationMs: 42,
    })

    const result = await runRefresh()

    expect(mocks.mockInitDb).toHaveBeenCalledOnce()
    expect(mocks.mockSetRefreshInProgress).toHaveBeenNthCalledWith(1, true)
    expect(mocks.mockSetRefreshInProgress).toHaveBeenNthCalledWith(2, false)
    expect(result.success).toBe(true)
    expect(result.partialData).toBe(false)
    expect(result.sources).toEqual(['github', 'localGit'])
    expect(result.errors).toEqual([])
    expect(result.orchestratorResult?.snapshotId).toBe('snapshot-1')
  })

  it('captures orchestrator failures as structured errors', async () => {
    mocks.mockCollect.mockRejectedValue(new Error('collector blew up'))

    const result = await runRefresh()

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(false)
    expect(result.errors).toEqual(['collector blew up'])
    expect(result.errorSummary).toBe('collector blew up')
    expect(mocks.mockSetRefreshInProgress).toHaveBeenCalledTimes(2)
  })
})
