import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLocalGitCollector } from '../collector'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

vi.mock('node:child_process')
vi.mock('node:fs')

const mockExecSync = vi.mocked(execSync)
const mockExistsSync = vi.mocked(existsSync)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('createLocalGitCollector', () => {
  it('returns repo info for a valid git repository', async () => {
    mockExistsSync.mockReturnValue(true)

    mockExecSync
      .mockReturnValueOnce('.git')          // rev-parse --git-dir
      .mockReturnValueOnce('main\n')         // rev-parse --abbrev-ref HEAD
      .mockReturnValueOnce('2025-05-30T10:00:00Z\n2025-06-01T12:00:00Z\n') // log --format="%cI"
      .mockReturnValueOnce('alice@example.com\nbob@example.com\n') // log --format=%aE
      .mockReturnValueOnce('2025-06-01T12:00:00Z\n') // log -1 --format=%cI

    const collector = createLocalGitCollector({
      repos: [{ path: '/valid/repo' }],
    })

    const result = await collector.collect()

    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.repoKey).toBe('local:/valid/repo')
    expect(result.repos[0]!.repoName).toBe('repo')
    expect(result.repos[0]!.defaultBranch).toBe('main')
    expect(result.repos[0]!.recentCommits).toBe(2)
    expect(result.repos[0]!.commitsByDay).toEqual({ '2025-05-30': 1, '2025-06-01': 1 })
    expect(result.repos[0]!.authors).toEqual(['alice@example.com', 'bob@example.com'])
    expect(result.repos[0]!.latestCommitAt).toBe('2025-06-01T12:00:00Z')
    expect(result.repos[0]!.error).toBeNull()
    expect(result.errors).toHaveLength(0)
  })

  it('returns error for non-existent path', async () => {
    mockExistsSync.mockReturnValue(false)

    const collector = createLocalGitCollector({
      repos: [{ path: '/nonexistent/path' }],
    })

    const result = await collector.collect()

    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.isGitRepo).toBe(false)
    expect(result.repos[0]!.repoKey).toBe('local:/nonexistent/path')
    expect(result.repos[0]!.error).toContain('Path does not exist')
    expect(result.errors).toHaveLength(1)
  })

  it('returns error for non-git directory', async () => {
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('not a git repository')
    })

    const collector = createLocalGitCollector({
      repos: [{ path: '/not/git' }],
    })

    const result = await collector.collect()

    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.isGitRepo).toBe(false)
    expect(result.repos[0]!.repoKey).toBe('local:/not/git')
    expect(result.repos[0]!.error).toBe('Not a git repository')
    expect(result.errors).toHaveLength(1)
  })

  it('handles missing git log data gracefully', async () => {
    mockExistsSync.mockReturnValue(true)

    mockExecSync
      .mockReturnValueOnce('.git')          // rev-parse --git-dir
      .mockReturnValueOnce('main\n')         // rev-parse --abbrev-ref HEAD
      .mockImplementationOnce(() => { throw new Error('empty repo') }) // git log fails

    const collector = createLocalGitCollector({
      repos: [{ path: '/empty/repo' }],
    })

    const result = await collector.collect()

    expect(result.repos).toHaveLength(1)
    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.repoKey).toBe('local:/empty/repo')
    expect(result.repos[0]!.recentCommits).toBe(0)
    expect(result.repos[0]!.authors).toEqual([])
    expect(result.repos[0]!.latestCommitAt).toBeNull()
    expect(result.repos[0]!.error).toBeNull()
  })

  it('handles multiple repos with mixed results', async () => {
    mockExistsSync.mockReturnValue(true)

    mockExecSync
      // Repo 1: valid
      .mockReturnValueOnce('.git')
      .mockReturnValueOnce('main\n')
      .mockReturnValueOnce('2025-06-01T10:00:00Z\n')
      .mockReturnValueOnce('alice@example.com\n')
      .mockReturnValueOnce('2025-06-01T12:00:00Z\n')
      // Repo 2: not a git repo
      .mockImplementationOnce(() => { throw new Error('not a git repo') })

    const collector = createLocalGitCollector({
      repos: [
        { path: '/valid/repo' },
        { path: '/invalid/repo' },
      ],
    })

    const result = await collector.collect()

    expect(result.repos).toHaveLength(2)
    expect(result.repos[0]!.isGitRepo).toBe(true)
    expect(result.repos[0]!.repoKey).toBe('local:/valid/repo')
    expect(result.repos[0]!.error).toBeNull()
    expect(result.repos[1]!.isGitRepo).toBe(false)
    expect(result.repos[1]!.repoKey).toBe('local:/invalid/repo')
    expect(result.repos[1]!.error).toBe('Not a git repository')
    expect(result.errors).toHaveLength(1)
  })

  it('handles empty repo list', async () => {
    const collector = createLocalGitCollector({ repos: [] })
    const result = await collector.collect()
    expect(result.repos).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})
