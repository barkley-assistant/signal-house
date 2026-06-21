import { runRefresh } from './refresh/run-refresh'
import { getPollerConfig as getRuntimePollerConfig } from './runtime-config'

export interface PollerConfig {
  enabled: boolean
  intervalMs: number
  runOnStartup: boolean
  startupDelayMs: number
}

export interface PollerRuntime {
  stop: () => void
}

const POLLER_GUARD_KEY = Symbol.for('signal-house.metrics-poller')

export function getPollerConfig(env: NodeJS.ProcessEnv = process.env): PollerConfig {
  const config = getRuntimePollerConfig(env)
  return {
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    runOnStartup: config.runOnStartup,
    startupDelayMs: config.startupDelayMs,
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
  if ((globalThis as { __prerender__?: boolean }).__prerender__) return null

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
      if (!stopped) {
        scheduleNext(config.intervalMs)
      }
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

export function stopMetricsPoller(): void {
  const guard = getPollerGuard()
  guard.runtime?.stop()
}
