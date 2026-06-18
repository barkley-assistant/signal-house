import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getDiscoveryMaxDepth,
  getDashboardWindowDays,
  getOrchestratorDefaults,
  getPollerConfig,
  getRefreshHistoryLimit,
  getRuntimeConfig,
  getSessionPeriodDays,
  getStaleThresholdMs,
} from '../runtime-config'

describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('exposes the centralized defaults', () => {
    const config = getRuntimeConfig({})

    expect(config).toMatchObject({
      accessProtection: {
        enabled: false,
        username: 'signal-house',
      },
      poller: {
        enabled: false,
        intervalSeconds: 300,
        intervalMs: 300000,
        runOnStartup: true,
        startupDelaySeconds: 5,
        startupDelayMs: 5000,
      },
      dashboard: {
        windowDays: 28,
      },
      db: {
        refreshHistoryLimit: 10,
        staleThresholdMinutes: 15,
        staleThresholdMs: 900000,
      },
      orchestrator: {
        collectConcurrency: 3,
        githubLookbackDays: 30,
        staleThresholdDays: 14,
      },
      sessions: {
        periodDays: 30,
      },
      discovery: {
        maxDepth: 3,
      },
    })
  })

  it('keeps legacy env fallbacks working', () => {
    vi.stubEnv('METRICS_POLLER_ENABLED', 'true')
    vi.stubEnv('METRICS_POLL_INTERVAL_SECONDS', '2')
    vi.stubEnv('METRICS_POLL_STARTUP_DELAY_SECONDS', '120')
    vi.stubEnv('METRICS_RUN_ON_STARTUP', 'false')
    vi.stubEnv('SESSIONS_PERIOD_DAYS', '45')

    expect(getPollerConfig()).toMatchObject({
      enabled: true,
      intervalMs: 15000,
      runOnStartup: false,
      startupDelayMs: 120000,
    })
    expect(getSessionPeriodDays()).toBe(45)
  })

  it('surfaces the shared runtime helpers', () => {
    expect(getDashboardWindowDays()).toBe(28)
    expect(getRefreshHistoryLimit()).toBe(10)
    expect(getStaleThresholdMs()).toBe(900000)
    expect(getOrchestratorDefaults()).toMatchObject({
      collectConcurrency: 3,
      githubLookbackDays: 30,
      staleThresholdDays: 14,
    })
    expect(getDiscoveryMaxDepth()).toBe(3)
  })

  it('reads the optional access protection env vars', () => {
    vi.stubEnv('SECRET_HOUSE_ACCESS_USERNAME', 'jake')
    vi.stubEnv('SECRET_HOUSE_ACCESS_PASSWORD', 'secret')

    expect(getRuntimeConfig().accessProtection).toMatchObject({
      enabled: true,
      username: 'jake',
    })
  })
})
