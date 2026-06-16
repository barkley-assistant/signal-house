import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetRefreshInProgress: vi.fn(),
  mockSetRefreshInProgress: vi.fn(),
  mockSetRefreshRunState: vi.fn(),
  mockSetRefreshRunStatus: vi.fn(),
  mockCollect: vi.fn(),
  mockDiscoverGitRepos: vi.fn(),
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

vi.mock('../../discovery/discovery', () => ({
  discoverGitRepos: mocks.mockDiscoverGitRepos,
}))

import { buildRefreshConfig, runRefresh } from '../run-refresh'

describe('buildRefreshConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

  it('discovers repos from SECRET_HOUSE_PROJECT_ROOTS', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: ['/discovered/a', '/discovered/b'],
      warnings: [],
    })

    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/workspace'] }),
    )
    expect(config.localGit).toEqual({
      repos: [{ path: '/discovered/a' }, { path: '/discovered/b' }],
    })
  })

  it('merges explicit repos with discovered repos', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: ['/discovered/repo'],
      warnings: [],
    })

    vi.stubEnv('SECRET_HOUSE_GIT_REPOS', '/explicit/repo')
    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')

    const config = buildRefreshConfig()

    expect(config.localGit).toEqual({
      repos: [{ path: '/explicit/repo' }, { path: '/discovered/repo' }],
    })
  })

  it('deduplicates when explicit and discovered repos overlap', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: ['/explicit/repo'],
      warnings: [],
    })

    vi.stubEnv('SECRET_HOUSE_GIT_REPOS', '/explicit/repo')
    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')

    const config = buildRefreshConfig()

    expect(config.localGit!.repos).toHaveLength(1)
    expect(config.localGit!.repos[0]!.path).toBe('/explicit/repo')
  })

  it('passes globs to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')
    vi.stubEnv('SECRET_HOUSE_GIT_REPO_GLOBS', 'project-*')

    buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ globs: ['project-*'] }),
    )
  })

  it('passes maxDepth to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')
    vi.stubEnv('SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH', '5')

    buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: 5 }),
    )
  })

  it('passes excludes to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')
    vi.stubEnv('SECRET_HOUSE_GIT_EXCLUDE', 'node_modules,dist')

    buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ excludes: ['node_modules', 'dist'] }),
    )
  })

  it('warns and ignores invalid GIT_DISCOVERY_MAX_DEPTH', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg: string) => { warnings.push(msg) }

    try {
      vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')
      vi.stubEnv('SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH', 'not-a-number')

      buildRefreshConfig()

      expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
        expect.objectContaining({ roots: ['/workspace'] }),
      )
      expect(mocks.mockDiscoverGitRepos).not.toHaveBeenCalledWith(
        expect.objectContaining({ maxDepth: expect.any(Number) }),
      )
      expect(warnings.some(w => w.includes('Invalid') && w.includes('GIT_DISCOVERY_MAX_DEPTH'))).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })

  it('warns and ignores negative GIT_DISCOVERY_MAX_DEPTH', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg: string) => { warnings.push(msg) }

    try {
      vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/workspace')
      vi.stubEnv('SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH', '-1')

      buildRefreshConfig()

      expect(warnings.some(w => w.includes('Invalid') && w.includes('GIT_DISCOVERY_MAX_DEPTH'))).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })

  it('does not call discoverGitRepos when GIT_REPO_ROOTS is empty', () => {
    buildRefreshConfig({})
    expect(mocks.mockDiscoverGitRepos).not.toHaveBeenCalled()
  })

  it('uses legacy GIT_REPO_ROOTS fallback', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: ['/legacy/repo'], warnings: [] })

    vi.stubEnv('GIT_REPO_ROOTS', '/legacy-workspace')

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/legacy-workspace'] }),
    )
    expect(config.localGit).toBeDefined()
  })

  it('prefers SECRET_HOUSE_PROJECT_ROOTS over legacy GIT_REPO_ROOTS', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: ['/preferred/repo'], warnings: [] })

    vi.stubEnv('SECRET_HOUSE_PROJECT_ROOTS', '/preferred')
    vi.stubEnv('GIT_REPO_ROOTS', '/legacy')

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/preferred'] }),
    )
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
