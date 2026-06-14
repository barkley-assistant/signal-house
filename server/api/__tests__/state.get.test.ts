import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockSetHeader: vi.fn(),
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetLatestState: vi.fn(),
}))

vi.mock('h3', () => ({
  defineEventHandler: (handler: Function) => handler,
  setHeader: mocks.mockSetHeader,
}))

vi.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getLatestState: mocks.mockGetLatestState,
}))

import handler from '../state.get'

describe('GET /api/state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetLatestState.mockReturnValue({
      snapshot: null,
      lastRefreshAt: null,
      lastSuccessfulRefreshAt: null,
      refreshInProgress: false,
      isStale: true,
    })
  })

  it('sets Cache-Control: no-cache header', async () => {
    const mockEvent = {} as any
    await handler(mockEvent)
    expect(mocks.mockSetHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
  })

  it('initializes the database', async () => {
    await handler({} as any)
    expect(mocks.mockInitDb).toHaveBeenCalledOnce()
  })

  it('returns the latest state from the database', async () => {
    const state = {
      snapshot: { id: 'snap-1', capturedAt: new Date().toISOString() },
      lastRefreshAt: '2025-01-01T00:00:00Z',
      lastSuccessfulRefreshAt: '2025-01-01T00:00:00Z',
      refreshInProgress: false,
      isStale: false,
    }
    mocks.mockGetLatestState.mockReturnValue(state)

    const result = await handler({} as any)
    expect(mocks.mockGetLatestState).toHaveBeenCalledOnce()
    expect(result).toEqual(state)
  })

  it('propagates refreshInProgress from the database', async () => {
    mocks.mockGetLatestState.mockReturnValue({
      snapshot: null,
      lastRefreshAt: null,
      lastSuccessfulRefreshAt: null,
      refreshInProgress: true,
      isStale: true,
    })

    const result = await handler({} as any)
    expect(result.refreshInProgress).toBe(true)
  })
})
