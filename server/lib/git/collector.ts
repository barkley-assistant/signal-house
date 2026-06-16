import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LocalGitCollectorConfig, LocalGitRepoInfo, LocalGitCollectorResult } from './types'

const GIT_TIMEOUT = 10_000

function runGit(args: string[], cwd: string): string {
  return execSync(`git ${args.join(' ')}`, {
    cwd,
    timeout: GIT_TIMEOUT,
    stdio: 'pipe',
    encoding: 'utf-8',
  }).trim()
}

export function createLocalGitCollector(config: LocalGitCollectorConfig) {
  const lookbackDays = config.lookbackDays ?? 30

  async function inspectRepo(repoPath: string): Promise<LocalGitRepoInfo> {
    const resolvedPath = resolve(repoPath)
    const repoName = resolvedPath.split('/').pop() || resolvedPath

    if (!existsSync(resolvedPath)) {
      return {
        path: resolvedPath,
        repoName,
        defaultBranch: null,
        isGitRepo: false,
        recentCommits: 0,
        commitsByDay: {},
        authors: [],
        latestCommitAt: null,
        error: `Path does not exist: ${resolvedPath}`,
      }
    }

    let isGitRepo = false
    try {
      runGit(['rev-parse', '--git-dir'], resolvedPath)
      isGitRepo = true
    } catch {
      return {
        path: resolvedPath,
        repoName,
        defaultBranch: null,
        isGitRepo: false,
        recentCommits: 0,
        commitsByDay: {},
        authors: [],
        latestCommitAt: null,
        error: 'Not a git repository',
      }
    }

    let defaultBranch: string | null = null
    try {
      defaultBranch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], resolvedPath)
    } catch {
      defaultBranch = null
    }

    const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()
    let recentCommits = 0
    let commitsByDay: Record<string, number> = {}
    let authors: string[] = []
    let latestCommitAt: string | null = null

    try {
      const dateOutput = runGit(
        ['log', `--since="${sinceDate}"`, '--format="%cI"'],
        resolvedPath,
      )
      const lines = dateOutput ? dateOutput.split('\n') : []
      recentCommits = lines.length
      for (const line of lines) {
        const clean = line.replace(/^"|"$/g, '').trim()
        if (clean) {
          const day = clean.slice(0, 10)
          commitsByDay[day] = (commitsByDay[day] || 0) + 1
        }
      }

      const authorsOutput = runGit(
        ['log', `--since="${sinceDate}"`, '--format=%aE'],
        resolvedPath,
      )
      const rawAuthors = authorsOutput ? authorsOutput.split('\n') : []
      authors = [...new Set(rawAuthors.map(a => a.trim()).filter(Boolean))].sort()

      const latestOutput = runGit(['log', '-1', '--format=%cI'], resolvedPath)
      latestCommitAt = latestOutput || null
    } catch {
      // git log commands can fail (empty repo), return what we have
    }

    return {
      path: resolvedPath,
      repoName,
      defaultBranch,
      isGitRepo,
      recentCommits,
      commitsByDay,
      authors,
      latestCommitAt,
      error: null,
    }
  }

  return {
    async collect(): Promise<LocalGitCollectorResult> {
      const results = await Promise.all(
        config.repos.map(cfg => inspectRepo(cfg.path)),
      )
      const errors = results.filter(r => r.error !== null).map(r => r.error!)
      return { repos: results, errors }
    },
  }
}

export type LocalGitCollector = ReturnType<typeof createLocalGitCollector>
