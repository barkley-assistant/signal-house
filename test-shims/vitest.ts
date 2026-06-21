import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

type EnvMap = Record<string, string | undefined>

const snapshotEnv = (): EnvMap => ({ ...process.env })

const restoreEnv = (snapshot: EnvMap) => {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const vi = {
  fn: jest.fn,
  mock: jest.mock,
  mocked: jest.mocked,
  spyOn: jest.spyOn,
  clearAllMocks: jest.clearAllMocks,
  resetAllMocks: jest.resetAllMocks,
  restoreAllMocks: jest.restoreAllMocks,
  useFakeTimers: jest.useFakeTimers,
  useRealTimers: jest.useRealTimers,
  runOnlyPendingTimersAsync: jest.runOnlyPendingTimersAsync,
  advanceTimersByTimeAsync: jest.advanceTimersByTimeAsync,
  hoisted: <T>(factory: () => T): T => factory(),
  stubEnv: (key: string, value: string) => {
    process.env[key] = value
  },
  unstubAllEnvs: () => {},
}

export { afterEach, beforeEach, describe, expect, it, vi }
