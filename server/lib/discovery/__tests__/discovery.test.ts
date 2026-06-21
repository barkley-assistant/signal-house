import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, mkdirSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverGitRepos } from '../discovery'

let tmpDir: string

function gitRepo(path: string): void {
  mkdirSync(path, { recursive: true })
  mkdirSync(join(path, '.git'), { recursive: true })
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sh-discovery-'))
})

afterEach(() => {
  chmodSync(tmpDir, 0o700)
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('discoverGitRepos', () => {
  function repoPaths(result: ReturnType<typeof discoverGitRepos>): string[] {
    return result.repos.map(repo => repo.path)
  }

  it('discovers git repos in configured roots', () => {
    gitRepo(join(tmpDir, 'repo-a'))
    gitRepo(join(tmpDir, 'repo-b'))
    mkdirSync(join(tmpDir, 'plain-dir'), { recursive: true })

    const result = discoverGitRepos({ roots: [tmpDir] })

    expect(result.repos).toHaveLength(2)
    expect(repoPaths(result)).toContain(join(tmpDir, 'repo-a'))
    expect(repoPaths(result)).toContain(join(tmpDir, 'repo-b'))
    expect(result.warnings).toEqual([])
  })

  it('respects maxDepth', () => {
    gitRepo(join(tmpDir, 'top-repo'))
    gitRepo(join(tmpDir, 'level1', 'inner-repo'))
    gitRepo(join(tmpDir, 'level1', 'level2', 'deep-repo'))

    const result = discoverGitRepos({
      roots: [tmpDir],
      maxDepth: 1,
    })

    expect(repoPaths(result)).toContain(join(tmpDir, 'top-repo'))
    expect(repoPaths(result)).toContain(join(tmpDir, 'level1', 'inner-repo'))
    expect(repoPaths(result)).not.toContain(join(tmpDir, 'level1', 'level2', 'deep-repo'))
  })

  it('skips excluded directories', () => {
    gitRepo(join(tmpDir, 'node_modules'))
    gitRepo(join(tmpDir, 'src'))

    const result = discoverGitRepos({
      roots: [tmpDir],
      excludes: ['node_modules'],
    })

    expect(repoPaths(result)).not.toContain(join(tmpDir, 'node_modules'))
    expect(repoPaths(result)).toContain(join(tmpDir, 'src'))
  })

  it('deduplicates the same repo reached through a symlinked root', () => {
    const repo = join(tmpDir, 'shared-repo')
    gitRepo(repo)
    symlinkSync(repo, join(tmpDir, 'shared-repo-link'))

    const result = discoverGitRepos({
      roots: [repo, join(tmpDir, 'shared-repo-link')],
    })

    expect(repoPaths(result)).toEqual([repo])
  })

  it('warns for missing roots but keeps scanning other roots', () => {
    gitRepo(join(tmpDir, 'real-repo'))

    const result = discoverGitRepos({
      roots: [join(tmpDir, 'missing-root'), tmpDir],
    })

    expect(repoPaths(result)).toContain(join(tmpDir, 'real-repo'))
    expect(result.warnings.some(warning => warning.path.includes('missing-root'))).toBe(true)
  })

  it('warns for inaccessible directories without crashing', () => {
    const locked = join(tmpDir, 'locked')
    mkdirSync(locked, { recursive: true })
    chmodSync(locked, 0o000)

    try {
      const result = discoverGitRepos({ roots: [locked] })
      expect(result.repos).toEqual([])
      expect(result.warnings.some(warning => warning.path === locked)).toBe(true)
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it('returns empty arrays for empty roots', () => {
    expect(discoverGitRepos({ roots: [] })).toEqual({ repos: [], warnings: [] })
  })
})
