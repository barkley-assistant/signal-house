import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

const mocks: {
  mockInitDb: jest.Mock
  mockGetRefreshInProgress: jest.Mock
  mockSetRefreshInProgress: jest.Mock
  mockSetRefreshRunState: jest.Mock
  mockSetRefreshRunStatus: jest.Mock
  mockCollect: jest.Mock
  mockDiscoverGitRepos: jest.Mock
} = {
  mockInitDb: jest.fn().mockResolvedValue(undefined),
  mockGetRefreshInProgress: jest.fn(),
  mockSetRefreshInProgress: jest.fn(),
  mockSetRefreshRunState: jest.fn(),
  mockSetRefreshRunStatus: jest.fn(),
  mockCollect: jest.fn(),
  mockDiscoverGitRepos: jest.fn(),
}

jest.mock('../../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getRefreshInProgress: mocks.mockGetRefreshInProgress,
  setRefreshInProgress: mocks.mockSetRefreshInProgress,
  setRefreshRunState: mocks.mockSetRefreshRunState,
  setRefreshRunStatus: mocks.mockSetRefreshRunStatus,
}))

jest.mock('../../orchestrator', () => ({
  createOrchestrator: jest.fn(() => ({
    collect: mocks.mockCollect,
  })),
}))

jest.mock('../../discovery/discovery', () => ({
  discoverGitRepos: mocks.mockDiscoverGitRepos,
}))

import { buildRefreshConfig, runRefresh } from '../run-refresh'

const ENV_KEYS = [
  'GITHUB_TOKEN',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GIT_REPOS',
  'SESSIONS_PERIOD_DAYS',
  'SECRET_HOUSE_PROJECT_ROOTS',
  'SECRET_HOUSE_GIT_REPOS',
  'SECRET_HOUSE_GIT_REPO_GLOBS',
  'SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH',
  'SECRET_HOUSE_GIT_EXCLUDE',
  'GIT_REPO_ROOTS',
]

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  jest.clearAllMocks()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

describe('buildRefreshConfig', () => {
  it('builds collector config from environment variables', () => {
    process.env['GITHUB_TOKEN'] = 'token'
    process.env['GITHUB_OWNER'] = 'owner'
    process.env['GITHUB_REPO'] = 'repo'
    process.env['GIT_REPOS'] = ' /tmp/a , /tmp/b '
    process.env['SESSIONS_PERIOD_DAYS'] = '21'

    expect(buildRefreshConfig()).toMatchObject({
      github: [{
        owner: 'owner',
        repo: 'repo',
        token: 'token',
      }],
      localGit: {
        repos: [{ path: '/tmp/a' }, { path: '/tmp/b' }],
      },
      sessions: {
        periodDays: 21,
      },
    })
  })

  it('discovers repos from SECRET_HOUSE_PROJECT_ROOTS', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [
        { repoKey: 'local:/discovered/a', name: 'a', path: '/discovered/a', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
        { repoKey: 'local:/discovered/b', name: 'b', path: '/discovered/b', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
      ],
      warnings: [],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/workspace'] }),
    )
    expect(config.localGit).toMatchObject({
      repos: [
        expect.objectContaining({ path: '/discovered/a', repoKey: 'local:/discovered/a' }),
        expect.objectContaining({ path: '/discovered/b', repoKey: 'local:/discovered/b' }),
      ],
    })
  })

  it('merges explicit repos with discovered repos', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [
        { repoKey: 'local:/discovered/repo', name: 'repo', path: '/discovered/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
      ],
      warnings: [],
    })

    process.env['SECRET_HOUSE_GIT_REPOS'] = '/explicit/repo'
    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(config.localGit).toMatchObject({
      repos: [
        expect.objectContaining({ path: '/explicit/repo', repoKey: 'local:/explicit/repo' }),
        expect.objectContaining({ path: '/discovered/repo', repoKey: 'local:/discovered/repo' }),
      ],
    })
  })

  it('includes discovery warnings in the refresh config', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [],
      warnings: [
        { path: '/workspace', message: 'Unable to read directory: permission denied' },
      ],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const warnSpy: jest.SpiedFunction<typeof console.warn> = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const config = buildRefreshConfig()

      expect(config.discoveryWarnings).toEqual([
        '/workspace: Unable to read directory: permission denied',
      ])
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('deduplicates when explicit and discovered repos overlap', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [
        { repoKey: 'local:/explicit/repo', name: 'repo', path: '/explicit/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
      ],
      warnings: [],
    })

    process.env['SECRET_HOUSE_GIT_REPOS'] = '/explicit/repo'
    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(config.localGit!.repos).toHaveLength(1)
    expect(config.localGit!.repos[0]!.path).toBe('/explicit/repo')
  })

  it('passes globs to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_REPO_GLOBS'] = 'project-*'

    buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ globs: ['project-*'] }),
    )
  })

  it('passes maxDepth to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH'] = '5'

    buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: 5 }),
    )
  })

  it('passes excludes to the discovery function', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_EXCLUDE'] = 'node_modules,dist'

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
      process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
      process.env['SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH'] = 'not-a-number'

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
      process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
      process.env['SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH'] = '-1'

      buildRefreshConfig()

      expect(warnings.some(w => w.includes('Invalid') && w.includes('GIT_DISCOVERY_MAX_DEPTH'))).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })

  it('does not call discoverGitRepos when GIT_REPO_ROOTS is empty', () => {
    buildRefreshConfig({} as NodeJS.ProcessEnv)
    expect(mocks.mockDiscoverGitRepos).not.toHaveBeenCalled()
  })

  it('uses legacy GIT_REPO_ROOTS fallback', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [{ repoKey: 'local:/legacy/repo', name: 'repo', path: '/legacy/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' }],
      warnings: [],
    })

    process.env['GIT_REPO_ROOTS'] = '/legacy-workspace'

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/legacy-workspace'] }),
    )
    expect(config.localGit).toBeDefined()
  })

  it('prefers SECRET_HOUSE_PROJECT_ROOTS over legacy GIT_REPO_ROOTS', () => {
    mocks.mockDiscoverGitRepos.mockReturnValue({
      repos: [{ repoKey: 'local:/preferred/repo', name: 'repo', path: '/preferred/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' }],
      warnings: [],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/preferred'
    process.env['GIT_REPO_ROOTS'] = '/legacy'

    const config = buildRefreshConfig()

    expect(mocks.mockDiscoverGitRepos).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/preferred'] }),
    )
  })
})

describe('runRefresh', () => {
  beforeEach(() => {
    mocks.mockGetRefreshInProgress.mockReturnValue(false)
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

    expect(mocks.mockInitDb).toHaveBeenCalledTimes(1)
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

  it('propagates the full orchestrator result structure on success', async () => {
    const orchestratorResult = {
      snapshotId: 'snap-42',
      capturedAt: '2026-06-15T12:00:00.000Z',
      sources: ['github', 'localGit', 'sessions'],
      errors: [],
      partialData: false,
      durationMs: 123,
    }

    mocks.mockCollect.mockResolvedValue(orchestratorResult)

    const result = await runRefresh()

    expect(result.success).toBe(true)
    expect(result.partialData).toBe(false)
    expect(result.sources).toEqual(['github', 'localGit', 'sessions'])
    expect(result.errors).toEqual([])
    expect(result.errorSummary).toBeNull()
    expect(result.orchestratorResult).toEqual(orchestratorResult)
    expect(result.skipped).toBe(false)
  })

  it('propagates partial data flag and errors from orchestrator result', async () => {
    const orchestratorResult = {
      snapshotId: 'snap-99',
      capturedAt: '2026-06-15T14:00:00.000Z',
      sources: ['github'],
      errors: ['GitHub rate limited'],
      partialData: true,
      durationMs: 55,
    }

    mocks.mockCollect.mockResolvedValue(orchestratorResult)

    const result = await runRefresh()

    expect(result.success).toBe(false)
    expect(result.partialData).toBe(true)
    expect(result.errors).toEqual(['GitHub rate limited'])
    expect(result.errorSummary).toBe('GitHub rate limited')
    expect(result.orchestratorResult).toEqual(orchestratorResult)
  })
})
