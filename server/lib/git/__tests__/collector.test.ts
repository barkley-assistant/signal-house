import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { createLocalGitCollector } from '../collector'
import { existsSync } from 'node:fs'

jest.mock('node:fs')

const mockExistsSync = jest.mocked(existsSync)

beforeEach(() => {
  jest.restoreAllMocks()
})

describe('createLocalGitCollector', () => {
  it('returns repo info for a valid git repository', async () => {
    mockExistsSync.mockReturnValue(true)
    const runGitCommand = jest.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git'
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
      if (args[0] === 'log' && args.includes('--format="%cI"')) return '2025-05-30T10:00:00Z\n2025-06-01T12:00:00Z\n'
      if (args[0] === 'log' && args.includes('--format=%aE')) return 'alice@example.com\nbob@example.com\n'
      if (args[0] === 'log' && args[1] === '-1') return '2025-06-01T12:00:00Z'
      return ''
    })

    const collector = createLocalGitCollector({
      repos: [{ path: '/valid/repo' }],
      runGitCommand,
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.defaultBranch).toBe('main')
    expect(result.repos[0]!.recentCommits).toBe(2)
    expect(result.repos[0]!.commitsByDay).toEqual({ '2025-05-30': 1, '2025-06-01': 1 })
    expect(result.repos[0]!.authors).toEqual(['alice@example.com', 'bob@example.com'])
    expect(result.repos[0]!.latestCommitAt).toBe('2025-06-01T12:00:00Z')
    expect(result.errors).toHaveLength(0)
  })

  it('honors concurrency limits across multiple repos', async () => {
    mockExistsSync.mockReturnValue(true)
    let active = 0
    let maxActive = 0
    const runGitCommand = jest.fn(async (args: string[], cwd: string) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 10))
      active -= 1
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git'
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
      if (args[0] === 'log' && args.includes('--format="%cI"')) return '2025-06-01T10:00:00Z\n'
      if (args[0] === 'log' && args.includes('--format=%aE')) return 'alice@example.com\n'
      if (args[0] === 'log' && args[1] === '-1') return '2025-06-01T12:00:00Z'
      return ''
    })

    const collector = createLocalGitCollector({
      repos: [
        { path: '/repo-1' },
        { path: '/repo-2' },
        { path: '/repo-3' },
      ],
      concurrency: 1,
      runGitCommand,
    })

    await collector.collect()

    expect(maxActive).toBe(1)
  })

  it('returns error for non-existent path', async () => {
    mockExistsSync.mockReturnValue(false)

    const collector = createLocalGitCollector({
      repos: [{ path: '/nonexistent/path' }],
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(false)
    expect(result.repos[0]!.error).toContain('Path does not exist')
    expect(result.errors).toHaveLength(1)
  })

  it('returns error for non-git directory', async () => {
    mockExistsSync.mockReturnValue(true)
    const runGitCommand = jest.fn(async () => {
      throw new Error('not a git repository')
    })

    const collector = createLocalGitCollector({
      repos: [{ path: '/not/git' }],
      runGitCommand,
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(false)
    expect(result.repos[0]!.error).toBe('Not a git repository')
    expect(result.errors).toHaveLength(1)
  })

  it('handles missing git log data gracefully', async () => {
    mockExistsSync.mockReturnValue(true)
    const runGitCommand = jest.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git'
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
      throw new Error('empty repo')
    })

    const collector = createLocalGitCollector({
      repos: [{ path: '/empty/repo' }],
      runGitCommand,
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.recentCommits).toBe(0)
    expect(result.repos[0]!.authors).toEqual([])
    expect(result.repos[0]!.latestCommitAt).toBeNull()
    expect(result.repos[0]!.error).toBeNull()
  })

  it('handles multiple repos with mixed results', async () => {
    mockExistsSync.mockReturnValue(true)
    const runGitCommand = jest.fn(async (args: string[], cwd: string) => {
      if (cwd === '/valid/repo') {
        if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git'
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return 'main'
        if (args[0] === 'log' && args.includes('--format="%cI"')) return '2025-06-01T10:00:00Z\n'
        if (args[0] === 'log' && args.includes('--format=%aE')) return 'alice@example.com\n'
        if (args[0] === 'log' && args[1] === '-1') return '2025-06-01T12:00:00Z'
      }
      throw new Error('not a git repo')
    })

    const collector = createLocalGitCollector({
      repos: [
        { path: '/valid/repo' },
        { path: '/invalid/repo' },
      ],
      runGitCommand,
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.error).toBeNull()
    expect(result.repos[1]!.isGitRepo).toBe(false)
    expect(result.repos[1]!.error).toBe('Not a git repository')
    expect(result.errors).toHaveLength(1)
  })

  it('handles empty repo list', async () => {
    const collector = createLocalGitCollector({ repos: [] })
    const result = await collector.collect()
    expect(result.repos).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('returns a git error when a command times out', async () => {
    mockExistsSync.mockReturnValue(true)
    const runGitCommand = jest.fn(async () => {
      throw Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' })
    })

    const collector = createLocalGitCollector({
      repos: [{ path: '/slow/repo' }],
      runGitCommand,
    })

    const result = await collector.collect()

    expect(result.repos[0]!.isGitRepo).toBe(false)
    expect(result.repos[0]!.error).toBe('Not a git repository')
    expect(result.errors).toHaveLength(1)
  })
})
