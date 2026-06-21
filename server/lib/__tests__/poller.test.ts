import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

jest.mock('../refresh/run-refresh', () => ({
  runRefresh: jest.fn(),
}))

import { runRefresh as mockRunRefresh } from '../refresh/run-refresh'
import { getPollerConfig, startMetricsPoller, stopMetricsPoller } from '../poller'

const ENV_KEYS = [
  'SECRET_HOUSE_POLLER_ENABLED',
  'SECRET_HOUSE_POLL_INTERVAL_SECONDS',
  'SECRET_HOUSE_RUN_ON_STARTUP',
  'SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS',
  'METRICS_POLLER_ENABLED',
  'METRICS_POLL_INTERVAL_SECONDS',
  'METRICS_RUN_ON_STARTUP',
  'METRICS_POLL_STARTUP_DELAY_SECONDS',
]

describe('getPollerConfig', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
  })

  it('applies the default disabled config', () => {
    expect(getPollerConfig()).toEqual({
      enabled: false,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 5000,
    })
  })

  it('prefers the new SECRET_HOUSE prefix', () => {
    process.env['SECRET_HOUSE_POLLER_ENABLED'] = 'true'
    process.env['SECRET_HOUSE_POLL_INTERVAL_SECONDS'] = '2'
    process.env['SECRET_HOUSE_RUN_ON_STARTUP'] = 'false'
    process.env['SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS'] = '120'

    expect(getPollerConfig()).toEqual({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: false,
      startupDelayMs: 120000,
    })
  })

  it('falls back to the legacy METRICS prefix', () => {
    process.env['METRICS_POLLER_ENABLED'] = 'true'
    process.env['METRICS_POLL_INTERVAL_SECONDS'] = '2'
    process.env['METRICS_RUN_ON_STARTUP'] = 'false'
    process.env['METRICS_POLL_STARTUP_DELAY_SECONDS'] = '120'

    expect(getPollerConfig()).toEqual({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: false,
      startupDelayMs: 120000,
    })
  })
})

describe('startMetricsPoller', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.mocked(mockRunRefresh).mockResolvedValue({
      startedAt: '2026-06-15T00:00:00.000Z',
      finishedAt: '2026-06-15T00:00:01.000Z',
      durationMs: 1000,
      success: true,
      partialData: false,
      sources: [],
      errors: [],
      errorSummary: null,
      skipped: false,
      skippedReason: null,
      orchestratorResult: null,
    })
  })

  afterEach(() => {
    jest.useRealTimers()
    stopMetricsPoller()
  })

  it('does nothing when disabled', () => {
    expect(startMetricsPoller({ enabled: false, intervalMs: 300000, runOnStartup: true, startupDelayMs: 5000 })).toBeNull()
    expect(jest.mocked(mockRunRefresh)).not.toHaveBeenCalled()
  })

  it('starts a guarded loop and avoids duplicate startups in the same process', async () => {
    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })

    expect(runtime).toBeTruthy()
    jest.runOnlyPendingTimers()
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(1)

    const secondRuntime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(secondRuntime).toBe(runtime)
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(1)
    runtime?.stop()
  })

  it('clears the pending timer and in-memory state on stop', async () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout')

    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(runtime).toBeTruthy()

    runtime?.stop()
    expect(clearTimeoutSpy).toHaveBeenCalled()

    jest.runOnlyPendingTimers()
    expect(jest.mocked(mockRunRefresh)).not.toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
  })

  it('prevents further runs after stop, but allows a fresh start after stop', async () => {
    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(runtime).toBeTruthy()

    runtime?.stop()
    jest.runOnlyPendingTimers()
    expect(jest.mocked(mockRunRefresh)).not.toHaveBeenCalled()

    const restarted = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(restarted).toBeTruthy()
    expect(restarted).not.toBe(runtime)

    jest.runOnlyPendingTimers()
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(1)

    restarted?.stop()
  })

  it('skips a scheduled tick while a previous refresh is still in flight', async () => {
    const pendingResult = {
      startedAt: '2026-06-15T00:00:00.000Z',
      finishedAt: '2026-06-15T00:00:01.000Z',
      durationMs: 1000,
      success: true,
      partialData: false,
      sources: [],
      errors: [],
      errorSummary: null,
      skipped: false,
      skippedReason: null,
      orchestratorResult: null,
    }
    let releaseFirst: () => void = () => {}
    let calls = 0
    const pendingPromise = new Promise<unknown>((resolve) => {
      releaseFirst = () => { resolve(pendingResult) }
    })
    ;(jest.mocked(mockRunRefresh) as jest.Mock).mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return pendingPromise
      }
      return Promise.resolve(pendingResult)
    })

    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(runtime).toBeTruthy()

    jest.runOnlyPendingTimers()
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(15000 * 5)
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(1)

    releaseFirst()
    await pendingPromise
    jest.advanceTimersByTime(15000)
    expect(jest.mocked(mockRunRefresh)).toHaveBeenCalledTimes(2)

    runtime?.stop()
  })

  it('stopMetricsPoller stops the active runtime and is a no-op when nothing is running', () => {
    expect(() => stopMetricsPoller()).not.toThrow()

    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(runtime).toBeTruthy()

    stopMetricsPoller()
    expect(runtime).toBeTruthy()
    runtime?.stop()
  })
})
