import {
  getRefreshInProgress,
  initDb,
  setRefreshInProgress,
  setRefreshRunState,
  setRefreshRunStatus,
} from '../../db/client'
import { maybeCollectDailyTokenUsage } from '../daily-token-usage/collector'
import { maybeCollectHermesDailyTokenUsage } from '../daily-token-usage/hermes-collector'
import { discoverGitRepos } from '../discovery/discovery'
import { getEnv } from '../env'
import type { LocalGitRepoConfig, RepoDiscoveryConfig } from '../git/types'
import { createOrchestrator } from '../orchestrator'
import type { OrchestratorConfig, OrchestratorResult } from '../orchestrator/types'
import { getRuntimeConfig } from '../runtime-config'
import type { SessionCollectorConfig } from '../sessions/types'

export interface RefreshRunResult {
  startedAt: string
  finishedAt: string
  durationMs: number
  success: boolean
  partialData: boolean
  sources: string[]
  warnings: string[]
  errors: string[]
  errorSummary: string | null
  skipped: boolean
  skippedReason: string | null
  orchestratorResult: OrchestratorResult | null
}

export interface RefreshStartResult {
  started: boolean
  skipped?: boolean
  skippedReason?: string
  startedAt?: string
}

function splitCsv(value: string | undefined): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []
}

function repoKeyForPath(path: string): string {
  return `local:${path}`
}

export function buildRefreshConfig(env: NodeJS.ProcessEnv = process.env): OrchestratorConfig {
  const runtimeConfig = getRuntimeConfig(env)
  const config: OrchestratorConfig = {}
  const discoveryWarnings: string[] = []
  const githubConfigs: NonNullable<OrchestratorConfig['github']> = []
  const repoConfigs: LocalGitRepoConfig[] = []

  const githubToken = getEnv(env, 'SECRET_HOUSE_GITHUB_TOKEN', 'GITHUB_TOKEN')
  const githubOwner = getEnv(env, 'SECRET_HOUSE_GITHUB_OWNER', 'GITHUB_OWNER')
  const githubRepo = getEnv(env, 'SECRET_HOUSE_GITHUB_REPO', 'GITHUB_REPO')

  if (githubToken && githubOwner && githubRepo) {
    githubConfigs.push({ owner: githubOwner, repo: githubRepo, token: githubToken })
  }

  for (const path of splitCsv(getEnv(env, 'SECRET_HOUSE_GIT_REPOS', 'GIT_REPOS'))) {
    repoConfigs.push({ path, repoKey: repoKeyForPath(path) })
  }

  const roots = splitCsv(getEnv(env, 'SECRET_HOUSE_PROJECT_ROOTS', 'GIT_REPO_ROOTS'))
  if (roots.length > 0) {
    const discoveryConfig: RepoDiscoveryConfig = { roots }
    const globsRaw = getEnv(env, 'SECRET_HOUSE_GIT_REPO_GLOBS', 'GIT_REPO_GLOBS')
    const maxDepthRaw = getEnv(env, 'SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH', 'GIT_REPO_MAX_DEPTH')
    const excludesRaw = getEnv(env, 'SECRET_HOUSE_GIT_EXCLUDE', 'GIT_REPO_EXCLUDES')

    if (globsRaw) {
      discoveryConfig.globs = splitCsv(globsRaw)
    }

    if (maxDepthRaw) {
      const parsed = Number.parseInt(maxDepthRaw, 10)
      if (!Number.isNaN(parsed) && parsed >= 0) {
        discoveryConfig.maxDepth = parsed
      } else {
        console.warn(`[signal-house] Invalid GIT_DISCOVERY_MAX_DEPTH: "${maxDepthRaw}" - must be non-negative integer. Ignoring.`)
      }
    } else {
      discoveryConfig.maxDepth = runtimeConfig.discovery.maxDepth
    }

    if (excludesRaw) {
      discoveryConfig.excludes = splitCsv(excludesRaw)
    }

    const discovered = discoverGitRepos(discoveryConfig)
    for (const warning of discovered.warnings) {
      console.warn(`[signal-house] Repo discovery warning at ${warning.path}: ${warning.message}`)
      discoveryWarnings.push(`${warning.path}: ${warning.message}`)
    }

    for (const repo of discovered.repos) {
      const repoConfig: LocalGitRepoConfig = {
        path: repo.path,
        repoKey: repo.repoKey,
        name: repo.name,
        remoteUrl: repo.remoteUrl,
        githubOwner: repo.githubOwner,
        githubRepo: repo.githubRepo,
        source: repo.source,
      }

      if (!repoConfigs.some((existing) => existing.repoKey === repoConfig.repoKey || existing.path === repoConfig.path)) {
        repoConfigs.push(repoConfig)
      }

      if (githubToken && repo.githubOwner && repo.githubRepo) {
        const exists = githubConfigs.some((existing) => existing.owner === repo.githubOwner && existing.repo === repo.githubRepo)
        if (!exists) {
          githubConfigs.push({
            owner: repo.githubOwner,
            repo: repo.githubRepo,
            token: githubToken,
          })
        }
      }
    }
  }

  if (repoConfigs.length > 0) {
    config.localGit = { repos: repoConfigs }
  }

  if (discoveryWarnings.length > 0) {
    config.discoveryWarnings = discoveryWarnings
  }

  if (githubConfigs.length > 0) {
    config.github = githubConfigs
  }

  const sessionsConfig: SessionCollectorConfig = {
    periodDays: runtimeConfig.sessions.periodDays,
  }
  config.sessions = sessionsConfig

  return config
}

function skippedRefreshResult(startedAt: string, startedMs: number): RefreshRunResult {
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    success: false,
    partialData: false,
    sources: [],
    warnings: [],
    errors: [],
    errorSummary: 'Refresh already in progress',
    skipped: true,
    skippedReason: 'refresh-in-progress',
    orchestratorResult: null,
  }
}

async function executeRefresh(startedAt: string, startedMs: number): Promise<RefreshRunResult> {
  try {
    const refreshConfig = buildRefreshConfig()
    const orchestrator = createOrchestrator(refreshConfig)
    const orchestratorResult = await orchestrator.collect()
    const success = orchestratorResult.errors.length === 0

    const result: RefreshRunResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      success,
      partialData: orchestratorResult.partialData,
      sources: orchestratorResult.sources,
      warnings: refreshConfig.discoveryWarnings ?? [],
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
      warnings: result.warnings,
      errorSummary: result.errorSummary,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })

    try {
      await maybeCollectDailyTokenUsage()
    } catch (e) {
      console.warn('[daily-token-usage] Daily collection failed:', e instanceof Error ? e.message : String(e))
    }

    try {
      await maybeCollectHermesDailyTokenUsage()
    } catch (e) {
      console.warn('[daily-token-usage-hermes] Daily Hermes collection failed:', e instanceof Error ? e.message : String(e))
    }

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
      warnings: [],
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
      warnings: result.warnings,
      errorSummary: result.errorSummary,
      skipped: result.skipped,
      skippedReason: result.skippedReason,
    })

    return result
  } finally {
    setRefreshInProgress(false)
  }
}

async function acquireRefresh(startedAt: string, startedMs: number): Promise<RefreshRunResult | null> {
  await initDb()

  if (getRefreshInProgress()) {
    return skippedRefreshResult(startedAt, startedMs)
  }

  setRefreshInProgress(true)
  setRefreshRunStatus('running')
  return null
}

export async function runRefresh(): Promise<RefreshRunResult> {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const skipped = await acquireRefresh(startedAt, startedMs)
  if (skipped) {
    return skipped
  }
  return executeRefresh(startedAt, startedMs)
}

export async function startRefreshInBackground(): Promise<RefreshStartResult> {
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const skipped = await acquireRefresh(startedAt, startedMs)

  if (skipped) {
    return {
      started: false,
      skipped: true,
      skippedReason: skipped.skippedReason ?? 'refresh-in-progress',
    }
  }

  void executeRefresh(startedAt, startedMs).catch((error) => {
    console.error('[refresh] background refresh failed:', error)
  })

  return { started: true, startedAt }
}
