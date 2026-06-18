import { getBooleanEnv, getEnv } from './env'

const MIN_POLL_INTERVAL_SECONDS = 15
const MAX_POLL_INTERVAL_SECONDS = 3600
const DEFAULT_POLL_INTERVAL_SECONDS = 300
const DEFAULT_POLL_STARTUP_DELAY_SECONDS = 5
const DEFAULT_DASHBOARD_WINDOW_DAYS = 28
const DEFAULT_REFRESH_HISTORY_LIMIT = 10
const DEFAULT_STALE_THRESHOLD_MINUTES = 15
const DEFAULT_ORCHESTRATOR_COLLECT_CONCURRENCY = 3
const DEFAULT_ORCHESTRATOR_LOOKBACK_DAYS = 30
const DEFAULT_ORCHESTRATOR_STALE_THRESHOLD_DAYS = 14
const DEFAULT_SESSION_PERIOD_DAYS = 30
const DEFAULT_DISCOVERY_MAX_DEPTH = 3

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export interface RuntimeConfig {
  accessProtection: {
    enabled: boolean
    username: string
  }
  poller: {
    enabled: boolean
    intervalSeconds: number
    intervalMs: number
    runOnStartup: boolean
    startupDelaySeconds: number
    startupDelayMs: number
  }
  dashboard: {
    windowDays: number
  }
  db: {
    refreshHistoryLimit: number
    staleThresholdMinutes: number
    staleThresholdMs: number
  }
  orchestrator: {
    collectConcurrency: number
    githubLookbackDays: number
    staleThresholdDays: number
  }
  sessions: {
    periodDays: number
  }
  discovery: {
    maxDepth: number
  }
}

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const pollIntervalSeconds = parsePositiveInt(getEnv(env, 'SECRET_HOUSE_POLL_INTERVAL_SECONDS', 'METRICS_POLL_INTERVAL_SECONDS'), DEFAULT_POLL_INTERVAL_SECONDS)
  const startupDelaySeconds = parsePositiveInt(getEnv(env, 'SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS', 'METRICS_POLL_STARTUP_DELAY_SECONDS'), DEFAULT_POLL_STARTUP_DELAY_SECONDS)
  const accessPassword = getEnv(env, 'SECRET_HOUSE_ACCESS_PASSWORD')?.trim() ?? ''

  return {
    accessProtection: {
      enabled: accessPassword.length > 0,
      username: getEnv(env, 'SECRET_HOUSE_ACCESS_USERNAME')?.trim() ?? 'signal-house',
    },
    poller: {
      enabled: getBooleanEnv(env, 'SECRET_HOUSE_POLLER_ENABLED', 'METRICS_POLLER_ENABLED'),
      intervalSeconds: Math.min(MAX_POLL_INTERVAL_SECONDS, Math.max(MIN_POLL_INTERVAL_SECONDS, pollIntervalSeconds)),
      intervalMs: Math.min(MAX_POLL_INTERVAL_SECONDS, Math.max(MIN_POLL_INTERVAL_SECONDS, pollIntervalSeconds)) * 1000,
      runOnStartup: getEnv(env, 'SECRET_HOUSE_RUN_ON_STARTUP', 'METRICS_RUN_ON_STARTUP') !== 'false',
      startupDelaySeconds,
      startupDelayMs: Math.max(0, startupDelaySeconds) * 1000,
    },
    dashboard: {
      windowDays: DEFAULT_DASHBOARD_WINDOW_DAYS,
    },
    db: {
      refreshHistoryLimit: DEFAULT_REFRESH_HISTORY_LIMIT,
      staleThresholdMinutes: DEFAULT_STALE_THRESHOLD_MINUTES,
      staleThresholdMs: DEFAULT_STALE_THRESHOLD_MINUTES * 60 * 1000,
    },
    orchestrator: {
      collectConcurrency: DEFAULT_ORCHESTRATOR_COLLECT_CONCURRENCY,
      githubLookbackDays: DEFAULT_ORCHESTRATOR_LOOKBACK_DAYS,
      staleThresholdDays: DEFAULT_ORCHESTRATOR_STALE_THRESHOLD_DAYS,
    },
    sessions: {
      periodDays: parsePositiveInt(getEnv(env, 'SECRET_HOUSE_SESSIONS_PERIOD_DAYS', 'SESSIONS_PERIOD_DAYS'), DEFAULT_SESSION_PERIOD_DAYS),
    },
    discovery: {
      maxDepth: DEFAULT_DISCOVERY_MAX_DEPTH,
    },
  }
}

export function getDashboardWindowDays(env: NodeJS.ProcessEnv = process.env): number {
  return getRuntimeConfig(env).dashboard.windowDays
}

export function getRefreshHistoryLimit(env: NodeJS.ProcessEnv = process.env): number {
  return getRuntimeConfig(env).db.refreshHistoryLimit
}

export function getStaleThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  return getRuntimeConfig(env).db.staleThresholdMs
}

export function getPollerConfig(env: NodeJS.ProcessEnv = process.env) {
  return getRuntimeConfig(env).poller
}

export function getOrchestratorDefaults(env: NodeJS.ProcessEnv = process.env) {
  return getRuntimeConfig(env).orchestrator
}

export function getSessionPeriodDays(env: NodeJS.ProcessEnv = process.env): number {
  return getRuntimeConfig(env).sessions.periodDays
}

export function getDiscoveryMaxDepth(env: NodeJS.ProcessEnv = process.env): number {
  return getRuntimeConfig(env).discovery.maxDepth
}
