import { execSync } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseGithubOriginRemote } from '../git/remotes'
import type { RepoDiscoveryConfig, RepoDiscoveryRepo, RepoDiscoveryResult, RepoDiscoveryWarning } from '../git/types'

const DEFAULT_EXCLUDES = new Set(['node_modules', '.git'])
const DEFAULT_MAX_DEPTH = 3

function matchesGlob(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === '*/*') return true
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${regexStr}$`).test(name)
  })
}

function warn(warnings: RepoDiscoveryWarning[], path: string, message: string): void {
  warnings.push({ path, message })
}

function isGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

function readOriginRemote(path: string): string | null {
  try {
    const output = execSync('git config --get remote.origin.url', {
      cwd: path,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim()
    return output || null
  } catch {
    return null
  }
}

function repoKeyFromDiscovery(path: string, remoteUrl: string | null, parsedRemote: ReturnType<typeof parseGithubOriginRemote>): string {
  if (parsedRemote) {
    return `github:${parsedRemote.githubOwner}/${parsedRemote.githubRepo}`
  }
  return `local:${path}`
}

function walk(
  currentPath: string,
  depth: number,
  globs: string[],
  maxDepth: number,
  excludes: Set<string>,
  found: RepoDiscoveryRepo[],
  seenRealpaths: Set<string>,
  warnings: RepoDiscoveryWarning[],
): void {
  if (maxDepth >= 0 && depth > maxDepth) return

  let entries: string[]
  try {
    entries = readdirSync(currentPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warn(warnings, currentPath, `Unable to read directory: ${message}`)
    return
  }

  for (const entry of entries) {
    if (excludes.has(entry)) continue

    const fullPath = join(currentPath, entry)

    let stat
    try {
      stat = statSync(fullPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(warnings, fullPath, `Unable to inspect path: ${message}`)
      continue
    }

    if (!stat.isDirectory()) continue

    if (isGitRepo(fullPath)) {
      if (matchesGlob(entry, globs)) {
        try {
          const repoRealpath = realpathSync(fullPath)
          if (!seenRealpaths.has(repoRealpath)) {
            seenRealpaths.add(repoRealpath)
            const originRemoteUrl = readOriginRemote(fullPath)
            const parsedRemote = originRemoteUrl ? parseGithubOriginRemote(originRemoteUrl) : null
            found.push({
              repoKey: repoKeyFromDiscovery(fullPath, originRemoteUrl, parsedRemote),
              name: parsedRemote ? parsedRemote.githubRepo : entry,
              path: fullPath,
              remoteUrl: originRemoteUrl,
              githubOwner: parsedRemote?.githubOwner ?? null,
              githubRepo: parsedRemote?.githubRepo ?? null,
              source: parsedRemote ? 'both' : 'local',
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          warn(warnings, fullPath, `Unable to resolve repo path: ${message}`)
        }
      }
      continue
    }

    walk(fullPath, depth + 1, globs, maxDepth, excludes, found, seenRealpaths, warnings)
  }
}

export function discoverGitRepos(config: RepoDiscoveryConfig): RepoDiscoveryResult {
  const roots = config.roots ?? []
  const globs = config.globs ?? []
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(config.excludes ?? [])])
  const warnings: RepoDiscoveryWarning[] = []
  const found: RepoDiscoveryRepo[] = []
  const seenRealpaths = new Set<string>()

  for (const root of roots) {
    const resolvedRoot = resolve(root)

    if (!existsSync(resolvedRoot)) {
      warn(warnings, resolvedRoot, 'Root directory does not exist')
      continue
    }

    let rootStats
    try {
      rootStats = statSync(resolvedRoot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      warn(warnings, resolvedRoot, `Unable to inspect root: ${message}`)
      continue
    }

    if (!rootStats.isDirectory()) {
      warn(warnings, resolvedRoot, 'Root path is not a directory')
      continue
    }

    if (isGitRepo(resolvedRoot) && matchesGlob(resolvedRoot.split('/').pop() ?? resolvedRoot, globs)) {
      try {
        const repoRealpath = realpathSync(resolvedRoot)
        if (!seenRealpaths.has(repoRealpath)) {
          seenRealpaths.add(repoRealpath)
          const originRemoteUrl = readOriginRemote(resolvedRoot)
          const parsedRemote = originRemoteUrl ? parseGithubOriginRemote(originRemoteUrl) : null
          found.push({
            repoKey: repoKeyFromDiscovery(resolvedRoot, originRemoteUrl, parsedRemote),
            name: parsedRemote ? parsedRemote.githubRepo : (resolvedRoot.split('/').pop() ?? resolvedRoot),
            path: resolvedRoot,
            remoteUrl: originRemoteUrl,
            githubOwner: parsedRemote?.githubOwner ?? null,
            githubRepo: parsedRemote?.githubRepo ?? null,
            source: parsedRemote ? 'both' : 'local',
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warn(warnings, resolvedRoot, `Unable to resolve repo path: ${message}`)
      }
    }

    walk(resolvedRoot, 0, globs, maxDepth, excludes, found, seenRealpaths, warnings)
  }

  return {
    repos: found,
    warnings,
  }
}
