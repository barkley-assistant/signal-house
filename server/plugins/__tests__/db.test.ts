import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

const mocks = {
  mockInitDb: jest.fn(),
  mockClose: jest.fn(),
  mockRunRetention: jest.fn().mockReturnValue({ snapshotsDeleted: 0, aggregatesDeleted: 0, dailyMetricsDeleted: 0, sessionsDeleted: 0, workflowRunsDeleted: 0 }),
}

jest.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
  close: mocks.mockClose,
  runRetention: mocks.mockRunRetention,
}))

const mockHooks: { name: string; fn: (...args: unknown[]) => unknown }[] = []

jest.mock('nitropack/runtime', () => ({
  defineNitroPlugin: (def: (nitroApp: unknown) => unknown) => def,
}));

import dbPlugin from '../db'

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

describe('db plugin', () => {
  beforeEach(() => {
    mockHooks.length = 0
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('initializes the database at startup and closes it on shutdown', async () => {
    mocks.mockInitDb.mockResolvedValue(undefined)

    await (dbPlugin as (app: unknown) => Promise<void>)(makeNitroApp())

    expect(mocks.mockInitDb).toHaveBeenCalledTimes(1)
    expect(mocks.mockRunRetention).toHaveBeenCalledTimes(1)

    const closeHook = mockHooks.find(h => h.name === 'close')
    expect(closeHook).toBeDefined()

    closeHook?.fn()
    expect(mocks.mockClose).toHaveBeenCalledTimes(1)
  })
})
