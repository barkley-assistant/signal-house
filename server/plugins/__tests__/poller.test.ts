import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

const mocks = {
  mockInitDb: jest.fn(),
  mockStartMetricsPoller: jest.fn(),
  mockStopMetricsPoller: jest.fn(),
  mockGetPollerConfig: jest.fn(),
}

jest.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
}));

jest.mock('../../lib/poller', () => ({
  getPollerConfig: mocks.mockGetPollerConfig,
  startMetricsPoller: mocks.mockStartMetricsPoller,
  stopMetricsPoller: mocks.mockStopMetricsPoller,
}));

const mockHooks: { name: string; fn: (...args: unknown[]) => unknown }[] = []

jest.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (def: (nitroApp: unknown) => unknown) => def,
}));

import pollerPlugin from '../poller'

function makeNitroApp() {
  return {
    hooks: {
      hook: (name: string, fn: (...args: unknown[]) => unknown) => {
        mockHooks.push({ name, fn })
        return () => {}
      },
    },
  }
}

describe('poller plugin', () => {
  beforeEach(() => {
    mockHooks.length = 0
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not start the poller or register a close hook when disabled', async () => {
    mocks.mockInitDb.mockResolvedValue(undefined)
    mocks.mockGetPollerConfig.mockReturnValue({
      enabled: false,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 0,
    })

    await (pollerPlugin as (app: unknown) => Promise<void>)(makeNitroApp())

    expect(mocks.mockInitDb).toHaveBeenCalledTimes(1)
    expect(mocks.mockStartMetricsPoller).not.toHaveBeenCalled()
    expect(mockHooks).toHaveLength(0)
  })

  it('starts the poller at process startup and stops it on the close hook', async () => {
    const runtime = { stop: jest.fn() }
    mocks.mockInitDb.mockResolvedValue(undefined)
    mocks.mockGetPollerConfig.mockReturnValue({
      enabled: true,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    mocks.mockStartMetricsPoller.mockReturnValue(runtime)

    await (pollerPlugin as (app: unknown) => Promise<void>)(makeNitroApp())

    expect(mocks.mockInitDb).toHaveBeenCalledTimes(1)
    expect(mocks.mockStartMetricsPoller).toHaveBeenCalledWith({
      enabled: true,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 0,
    })

    const closeHook = mockHooks.find(h => h.name === 'close')
    expect(closeHook).toBeDefined()

    closeHook?.fn()
    expect(runtime.stop).toHaveBeenCalledTimes(1)
  })

  it('does not throw on close when startMetricsPoller returned null', async () => {
    mocks.mockInitDb.mockResolvedValue(undefined)
    mocks.mockGetPollerConfig.mockReturnValue({
      enabled: true,
      intervalMs: 300000,
      runOnStartup: true,
      startupDelayMs: 0,
    })
    mocks.mockStartMetricsPoller.mockReturnValue(null)

    await (pollerPlugin as (app: unknown) => Promise<void>)(makeNitroApp())

    const closeHook = mockHooks.find(h => h.name === 'close')
    expect(closeHook).toBeDefined()
    expect(() => closeHook?.fn()).not.toThrow()
  })
})
