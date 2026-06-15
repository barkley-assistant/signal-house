import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockRunRefresh: vi.fn(),
}))

vi.mock('../refresh/run-refresh', () => ({
  runRefresh: mocks.mockRunRefresh,
}))

import { getPollerConfig, startMetricsPoller } from '../poller'

describe('getPollerConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('applies the default disabled config', () => {
    expect(getPollerConfig()).toEqual({
      enabled: false,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 5000,
    })
  })

  it('clamps and parses runtime values', () => {
    vi.stubEnv('METRICS_POLLER_ENABLED', 'true')
    vi.stubEnv('METRICS_POLL_INTERVAL_SECONDS', '2')
    vi.stubEnv('METRICS_RUN_ON_STARTUP', 'false')
    vi.stubEnv('METRICS_POLL_STARTUP_DELAY_SECONDS', '120')

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
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'setTimeout')
    vi.spyOn(globalThis, 'clearTimeout')
    vi.clearAllMocks()
    mocks.mockRunRefresh.mockResolvedValue({
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
    vi.useRealTimers()
    vi.unstubAllEnvs()
    startMetricsPoller({ enabled: false, intervalMs: 300000, runOnStartup: true, startupDelayMs: 5000 })?.stop()
  })

  it('does nothing when disabled', () => {
    expect(startMetricsPoller({ enabled: false, intervalMs: 300000, runOnStartup: true, startupDelayMs: 5000 })).toBeNull()
    expect(mocks.mockRunRefresh).not.toHaveBeenCalled()
  })

  it('starts a guarded loop and avoids overlapping runs', async () => {
    const runtime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })

    expect(runtime).toBeTruthy()
    await vi.runOnlyPendingTimersAsync()
    expect(mocks.mockRunRefresh).toHaveBeenCalledTimes(1)

    const secondRuntime = startMetricsPoller({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    expect(secondRuntime).toBe(runtime)
    runtime?.stop()
  })
})
