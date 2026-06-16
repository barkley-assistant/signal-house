import { initDb, setRefreshInProgress, getRefreshInProgress, setRefreshRunState, setRefreshRunStatus } from '../../db/client'
import { createOrchestrator } from '../orchestrator'
import { getEnv } from '../env'
import { discoverGitRepos } from '../discovery/discovery'
import type { OrchestratorConfig, OrchestratorResult } from '../orchestrator/types'
import type { SessionCollectorConfig } from '../sessions/types'
import type { RepoDiscoveryConfig, RepoDiscoveryRepo, LocalGitRepoConfig } from '../git/types'

export interface RefreshRunResult {
  startedAt: string
  finishedAt: string
  durationMs: number
  success: boolean
  partialData: boolean
  sources: string[]
  errors: string[]
  errorSummary: string | null
  skipped: boolean
  skippedReason: string | null
  orchestratorResult: OrchestratorResult | null
}

export function buildRefreshConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const config: OrchestratorConfig = {}

  function normalizeDiscoveredPath(entry: string | { path: string }): string {
    return typeof entry === 'string' ? entry : entry.path
  }

  function repoKeyForPath(path: string): string {
    return `local:${path}`
  }

  const githubToken = getEnv(env, 'SECRET_HOUSE_GITHUB_TOKEN', 'GITHUB_TOKEN')
  const githubOwner = getEnv(env, 'SECRET_HOUSE_GITHUB_OWNER', 'GITHUB_OWNER')
  const githubRepo = getEnv(env, 'SECRET_HOUSE_GITHUB_REPO', 'GITHUB_REPO')
  if (githubToken && githubOwner && githubRepo) {
    config.github = {
      owner: githubOwner,
      repo: githubRepo,
      token: githubToken,
    }
  }

  const gitRepos = getEnv(env, 'SECRET_HOUSE_GIT_REPOS', 'GIT_REPOS')
  const explicitPaths = gitRepos
    ? gitRepos.split(',').map(path => path.trim()).filter(Boolean)
    : []

  const rootsRaw = getEnv(env, 'SECRET_HOUSE_PROJECT_ROOTS', 'GIT_REPO_ROOTS')
  const globsRaw = getEnv(env, 'SECRET_HOUSE_GIT_REPO_GLOBS', 'GIT_REPO_GLOBS')
  const maxDepthRaw = getEnv(env, 'SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH', 'GIT_REPO_MAX_DEPTH')
  const excludesRaw = getEnv(env, 'SECRET_HOUSE_GIT_EXCLUDE', 'GIT_REPO_EXCLUDES')

  const repoConfigs: LocalGitRepoConfig[] = explicitPaths.map(path => ({
    path,
    repoKey: repoKeyForPath(path),
    name: path.split('/').pop() || path,
    remoteUrl: null,
    githubOwner: null,
    githubRepo: null,
    source: 'local',
  }))

  if (rootsRaw) {
    const roots = rootsRaw.split(',').map(r => r.trim()).filter(Boolean)
    if (roots.length > 0) {
      const discoveryConfig: RepoDiscoveryConfig = { roots }
      if (globsRaw) {
        discoveryConfig.globs = globsRaw.split(',').map(g => g.trim()).filter(Boolean)
      }
      if (maxDepthRaw) {
        const parsed = Number.parseInt(maxDepthRaw, 10)
        if (!Number.isNaN(parsed) && parsed >= 0) {
          discoveryConfig.maxDepth = parsed
        } else {
          console.warn(`[signal-house] Invalid GIT_DISCOVERY_MAX_DEPTH: "${maxDepthRaw}" — must be a non-negative integer. Ignoring.`)
        }
      }
      if (excludesRaw) {
        discoveryConfig.excludes = excludesRaw.split(',').map(e => e.trim()).filter(Boolean)
      }
      const discovered = discoverGitRepos(discoveryConfig)
      for (const warning of discovered.warnings) {
        console.warn(`[signal-house] Repo discovery warning at ${warning.path}: ${warning.message}`)
      }
      for (const repo of discovered.repos) {
        const p = normalizeDiscoveredPath(repo)
        const repoConfig: LocalGitRepoConfig = {
          path: p,
          repoKey: repo.repoKey,
          name: repo.name,
          remoteUrl: repo.remoteUrl,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          source: repo.source,
        }
        if (!repoConfigs.some(existing => existing.repoKey === repoConfig.repoKey || existing.path === repoConfig.path)) {
          repoConfigs.push(repoConfig)
        }
      }
    }
  }

  if (repoConfigs.length > 0) {
    config.localGit = {
      repos: repoConfigs,
    }
  }

  const sessionsConfig: SessionCollectorConfig = {}
  const sessionsPeriodDays = getEnv(env, 'SECRET_HOUSE_SESSIONS_PERIOD_DAYS', 'SESSIONS_PERIOD_DAYS')
  if (sessionsPeriodDays) {
    const days = Number.parseInt(sessionsPeriodDays, 10)
    if (!Number.isNaN(days) && days > 0) {
      sessionsConfig.periodDays = days
    }
  }
  const opencodeBin = getEnv(env, 'SECRET_HOUSE_OPENCODE_BIN', 'OPENCODE_BIN')
  if (opencodeBin) {
    sessionsConfig.opencodeBin = opencodeBin
  }
  const opencodeCommand = getEnv(env, 'SECRET_HOUSE_OPENCODE_COMMAND', 'OPENCODE_COMMAND')
  if (opencodeCommand) {
    sessionsConfig.opencodeCommand = opencodeCommand
  }
  if (Object.keys(sessionsConfig).length > 0) {
    config.sessions = sessionsConfig
  }

  return config
}

export async function runRefresh(): Promise<RefreshRunResult> {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()

  await initDb()

  if (getRefreshInProgress()) {
    const result: RefreshRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      success: false,
      partialData: false,
      sources: [],
      errors: [],
      errorSummary: 'Refresh already in progress',
      skipped: true,
      skippedReason: 'refresh-in-progress',
      orchestratorResult: null,
    }
    setRefreshRunState({
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      success: result.success,
      partialData: result.partialData,
      sources: result.sources,
      errorSummary: result.errorSummary,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })
    return result
  }

  setRefreshInProgress(true)
  setRefreshRunStatus('running')

  try {
    const orchestrator = createOrchestrator(buildRefreshConfig())
    const orchestratorResult = await orchestrator.collect()
    const success = orchestratorResult.errors.length === 0

    const result: RefreshRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      success,
      partialData: orchestratorResult.partialData,
      sources: orchestratorResult.sources,
      errors: orchestratorResult.errors,
      errorSummary: orchestratorResult.errors[0] ?? null,
      skipped: false,
      skippedReason: null,
      orchestratorResult,
    }
    setRefreshRunState({
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      success: result.success,
      partialData: result.partialData,
      sources: result.sources,
      errorSummary: result.errorSummary,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result: RefreshRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      success: false,
      partialData: false,
      sources: [],
      errors: [message],
      errorSummary: message,
      skipped: false,
      skippedReason: null,
      orchestratorResult: null,
    }
    setRefreshRunState({
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      success: result.success,
      partialData: result.partialData,
      sources: result.sources,
      errorSummary: result.errorSummary,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })
    return result
  } finally {
    setRefreshInProgress(false)
  }
}
