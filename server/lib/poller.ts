import { runRefresh } from './refresh/run-refresh'

export interface PollerConfig {
  enabled: boolean
  intervalMs: number
  runOnStartup: boolean
  startupDelayMs: number
}

export interface PollerRuntime {
  stop: () => void
}

const MIN_INTERVAL_SECONDS = 15
const MAX_INTERVAL_SECONDS = 3600
const DEFAULT_INTERVAL_SECONDS = 300
const DEFAULT_STARTUP_DELAY_SECONDS = 5
const POLLER_GUARD_KEY = Symbol.for('engineering-metrics-dashboard.metrics-poller')

function parseSeconds(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getPollerConfig(env: NodeJS.ProcessEnv = process.env): PollerConfig {
  const enabled = env.METRICS_POLLER_ENABLED === 'true'
  const intervalSeconds = parseSeconds(env.METRICS_POLL_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS)
  const startupDelaySeconds = parseSeconds(env.METRICS_POLL_STARTUP_DELAY_SECONDS, DEFAULT_STARTUP_DELAY_SECONDS)

  return {
    enabled,
    intervalMs: Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, intervalSeconds)) * 1000,
    runOnStartup: env.METRICS_RUN_ON_STARTUP !== 'false',
    startupDelayMs: Math.max(0, startupDelaySeconds) * 1000,
  }
}

function getPollerGuard(): { running: boolean; runtime: PollerRuntime | null } {
  const globalState = globalThis as typeof globalThis & {
    [POLLER_GUARD_KEY]?: { running: boolean; runtime: PollerRuntime | null }
  }

  if (!globalState[POLLER_GUARD_KEY]) {
    globalState[POLLER_GUARD_KEY] = { running: false, runtime: null }
  }

  return globalState[POLLER_GUARD_KEY]!
}

export function startMetricsPoller(config: PollerConfig = getPollerConfig()): PollerRuntime | null {
  if (!config.enabled) return null
  if (import.meta.prerender) return null

  const guard = getPollerGuard()
  if (guard.running) return guard.runtime

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let inFlight = false

  const scheduleNext = (delayMs: number) => {
    if (stopped) return
    timer = setTimeout(async () => {
      timer = null
      await tick()
    }, delayMs)
  }

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const result = await runRefresh()
      if (result.skipped) {
        console.info('[poller] refresh skipped:', result.errorSummary ?? 'unknown reason')
      } else if (!result.success) {
        console.warn('[poller] refresh completed with errors:', result.errorSummary ?? 'unknown error')
      } else {
        console.info('[poller] refresh completed successfully')
      }
    } catch (error) {
      console.error('[poller] refresh loop failed:', error)
    } finally {
      inFlight = false
      scheduleNext(config.intervalMs)
    }
  }

  guard.running = true
  guard.runtime = {
    stop: () => {
      stopped = true
      guard.running = false
      guard.runtime = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }

  scheduleNext(config.runOnStartup ? config.startupDelayMs : config.intervalMs)
  return guard.runtime
}
