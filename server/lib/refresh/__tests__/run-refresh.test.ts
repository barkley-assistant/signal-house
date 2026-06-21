import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

jest.mock('../../../db/client', () => ({
  initDb: jest.fn(),
  getRefreshInProgress: jest.fn(),
  setRefreshInProgress: jest.fn(),
  setRefreshRunState: jest.fn(),
  setRefreshRunStatus: jest.fn(),
}))

jest.mock('../../orchestrator', () => ({
  createOrchestrator: jest.fn(() => ({
    collect: jest.fn(),
  })),
}))

jest.mock('../../discovery/discovery', () => ({
  discoverGitRepos: jest.fn(),
}))

import { initDb, getRefreshInProgress, setRefreshInProgress, setRefreshRunState, setRefreshRunStatus } from '../../../db/client'
import { createOrchestrator as mockCreateOrchestratorFn } from '../../orchestrator'
import { discoverGitRepos } from '../../discovery/discovery'

import { buildRefreshConfig, runRefresh } from '../run-refresh'

const ENV_KEYS = [
  "GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO",
  "GIT_REPOS", "SECRET_HOUSE_GIT_REPOS",
  "SESSIONS_PERIOD_DAYS", "OPENCODE_BIN", "OPENCODE_COMMAND",
  "SECRET_HOUSE_PROJECT_ROOTS", "SECRET_HOUSE_GIT_REPO_GLOBS",
  "SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH", "SECRET_HOUSE_GIT_EXCLUDE",
  "GIT_REPO_ROOTS",
]


describe('buildRefreshConfig', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    jest.clearAllMocks()
  })

  it('builds collector config from environment variables', () => {
    process.env['GITHUB_TOKEN'] = 'token'
    process.env['GITHUB_OWNER'] = 'owner'
    process.env['GITHUB_REPO'] = 'repo'
    process.env['GIT_REPOS'] = ' /tmp/a , /tmp/b '
    process.env['SESSIONS_PERIOD_DAYS'] = '21'
    process.env['OPENCODE_BIN'] = '/usr/local/bin/opencode'
    process.env['OPENCODE_COMMAND'] = 'opencode stats'

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
        opencodeBin: '/usr/local/bin/opencode',
        opencodeCommand: 'opencode stats',
      },
    })
  })

  it('discovers repos from SECRET_HOUSE_PROJECT_ROOTS', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [
        { repoKey: 'local:/discovered/a', name: 'a', path: '/discovered/a', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
        { repoKey: 'local:/discovered/b', name: 'b', path: '/discovered/b', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' },
      ],
      warnings: [],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
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
    jest.mocked(discoverGitRepos).mockReturnValue({
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

  it('adds discovered GitHub repos to the GitHub config list when a token is available', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [
        { repoKey: 'github:test/one', name: 'one', path: '/one', remoteUrl: 'https://github.com/test/one', githubOwner: 'test', githubRepo: 'one', source: 'github' },
        { repoKey: 'github:test/two', name: 'two', path: '/two', remoteUrl: 'https://github.com/test/two', githubOwner: 'test', githubRepo: 'two', source: 'github' },
      ],
      warnings: [],
    })

    process.env['GITHUB_TOKEN'] = 'token'
    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(config.github).toEqual([
      { owner: 'test', repo: 'one', token: 'token' },
      { owner: 'test', repo: 'two', token: 'token' },
    ])
  })

  it('deduplicates discovered GitHub repos against explicit owner and repo', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [
        { repoKey: 'github:test/repo', name: 'repo', path: '/repo', remoteUrl: 'https://github.com/test/repo', githubOwner: 'test', githubRepo: 'repo', source: 'github' },
      ],
      warnings: [],
    })

    process.env['GITHUB_TOKEN'] = 'token'
    process.env['GITHUB_OWNER'] = 'test'
    process.env['GITHUB_REPO'] = 'repo'
    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(config.github).toEqual([
      { owner: 'test', repo: 'repo', token: 'token' },
    ])
  })

  it('includes discovery warnings in the refresh config', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [],
      warnings: [
        { path: '/workspace', message: 'Unable to read directory: permission denied' },
      ],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'

    const config = buildRefreshConfig()

    expect(config.discoveryWarnings).toEqual([
      '/workspace: Unable to read directory: permission denied',
    ])
  })

  it('deduplicates when explicit and discovered repos overlap', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
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
    jest.mocked(discoverGitRepos).mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_REPO_GLOBS'] = 'project-*'

    buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
      expect.objectContaining({ globs: ['project-*'] }),
    )
  })

  it('passes maxDepth to the discovery function', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH'] = '5'

    buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
      expect.objectContaining({ maxDepth: 5 }),
    )
  })

  it('passes excludes to the discovery function', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({ repos: [], warnings: [] })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
    process.env['SECRET_HOUSE_GIT_EXCLUDE'] = 'node_modules,dist'

    buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
      expect.objectContaining({ excludes: ['node_modules', 'dist'] }),
    )
  })

  it('warns and ignores invalid GIT_DISCOVERY_MAX_DEPTH', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({ repos: [], warnings: [] })
    const warnings: string[] = []
    const origWarn = console.warn
    console.warn = (msg: string) => { warnings.push(msg) }

    try {
      process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/workspace'
      process.env['SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH'] = 'not-a-number'

      buildRefreshConfig()

      expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
        expect.objectContaining({ roots: ['/workspace'] }),
      )
      expect(jest.mocked(discoverGitRepos)).not.toHaveBeenCalledWith(
        expect.objectContaining({ maxDepth: expect.any(Number) }),
      )
      expect(warnings.some(w => w.includes('Invalid') && w.includes('GIT_DISCOVERY_MAX_DEPTH'))).toBe(true)
    } finally {
      console.warn = origWarn
    }
  })

  it('warns and ignores negative GIT_DISCOVERY_MAX_DEPTH', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({ repos: [], warnings: [] })
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
    expect(jest.mocked(discoverGitRepos)).not.toHaveBeenCalled()
  })

  it('uses legacy GIT_REPO_ROOTS fallback', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [{ repoKey: 'local:/legacy/repo', name: 'repo', path: '/legacy/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' }],
      warnings: [],
    })

    process.env['GIT_REPO_ROOTS'] = '/legacy-workspace'

    const config = buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/legacy-workspace'] }),
    )
    expect(config.localGit).toBeDefined()
  })

  it('prefers SECRET_HOUSE_PROJECT_ROOTS over legacy GIT_REPO_ROOTS', () => {
    jest.mocked(discoverGitRepos).mockReturnValue({
      repos: [{ repoKey: 'local:/preferred/repo', name: 'repo', path: '/preferred/repo', remoteUrl: null, githubOwner: null, githubRepo: null, source: 'local' }],
      warnings: [],
    })

    process.env['SECRET_HOUSE_PROJECT_ROOTS'] = '/preferred'
    process.env['GIT_REPO_ROOTS'] = '/legacy'

    const config = buildRefreshConfig()

    expect(jest.mocked(discoverGitRepos)).toHaveBeenCalledWith(
      expect.objectContaining({ roots: ['/preferred'] }),
    )
  })
})

describe('runRefresh', () => {
  let mockCollect: ReturnType<typeof jest.fn>
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    jest.clearAllMocks()
    mockCollect = jest.fn()
    jest.mocked(mockCreateOrchestratorFn).mockReturnValue({ collect: mockCollect })
    jest.mocked(getRefreshInProgress).mockReturnValue(false)
  })

  it('returns a structured skipped result when a refresh is already running', async () => {
    jest.mocked(getRefreshInProgress).mockReturnValue(true)

    const result = await runRefresh()

    expect(result.skipped).toBe(true)
    expect(result.success).toBe(false)
    expect(result.errorSummary).toBe('Refresh already in progress')
    expect(jest.mocked(setRefreshInProgress)).not.toHaveBeenCalled()
    expect(mockCollect).not.toHaveBeenCalled()
  })

  it('runs the orchestrator and returns a structured success result', async () => {
    mockCollect.mockResolvedValue({
      snapshotId: 'snapshot-1',
      capturedAt: '2026-06-15T12:00:00.000Z',
      sources: ['github', 'localGit'],
      errors: [],
      partialData: false,
      durationMs: 42,
    })

    const result = await runRefresh()

    expect(jest.mocked(initDb)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(setRefreshInProgress)).toHaveBeenNthCalledWith(1, true)
    expect(jest.mocked(setRefreshInProgress)).toHaveBeenNthCalledWith(2, false)
    expect(result.success).toBe(true)
    expect(result.partialData).toBe(false)
    expect(result.sources).toEqual(['github', 'localGit'])
    expect(result.errors).toEqual([])
    expect(result.orchestratorResult?.snapshotId).toBe('snapshot-1')
  })

  it('captures orchestrator failures as structured errors', async () => {
    mockCollect.mockRejectedValue(new Error('collector blew up'))

    const result = await runRefresh()

    expect(result.success).toBe(false)
    expect(result.skipped).toBe(false)
    expect(result.errors).toEqual(['collector blew up'])
    expect(result.errorSummary).toBe('collector blew up')
    expect(jest.mocked(setRefreshInProgress)).toHaveBeenCalledTimes(2)
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

    mockCollect.mockResolvedValue(orchestratorResult)

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

    mockCollect.mockResolvedValue(orchestratorResult)

    const result = await runRefresh()

    expect(result.success).toBe(false)
    expect(result.partialData).toBe(true)
    expect(result.errors).toEqual(['GitHub rate limited'])
    expect(result.errorSummary).toBe('GitHub rate limited')
    expect(result.orchestratorResult).toEqual(orchestratorResult)
  })
})
