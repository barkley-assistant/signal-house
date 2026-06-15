import { initDb, setRefreshInProgress, getRefreshInProgress } from '../../db/client'
import { createOrchestrator } from '../orchestrator'
import type { OrchestratorConfig, OrchestratorResult } from '../orchestrator/types'
import type { SessionCollectorConfig } from '../sessions/types'

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

  if (env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO) {
    config.github = {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      token: env.GITHUB_TOKEN,
    }
  }

  if (env.GIT_REPOS) {
    const paths = env.GIT_REPOS.split(',').map(path => path.trim()).filter(Boolean)
    if (paths.length > 0) {
      config.localGit = {
        repos: paths.map(path => ({ path })),
      }
    }
  }

  const sessionsConfig: SessionCollectorConfig = {}
  if (env.SESSIONS_PERIOD_DAYS) {
    const days = Number.parseInt(env.SESSIONS_PERIOD_DAYS, 10)
    if (!Number.isNaN(days) && days > 0) {
      sessionsConfig.periodDays = days
    }
  }
  if (env.OPENCODE_BIN) {
    sessionsConfig.opencodeBin = env.OPENCODE_BIN
  }
  if (env.OPENCODE_COMMAND) {
    sessionsConfig.opencodeCommand = env.OPENCODE_COMMAND
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
    return {
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
  }

  setRefreshInProgress(true)

  try {
    const orchestrator = createOrchestrator(buildRefreshConfig())
    const orchestratorResult = await orchestrator.collect()
    const success = orchestratorResult.errors.length === 0

    return {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
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
  } finally {
    setRefreshInProgress(false)
  }
}
