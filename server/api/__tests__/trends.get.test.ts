import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockSetHeader: vi.fn(),
  mockCreateError: vi.fn((err: any) => err),
  mockInitDb: vi.fn().mockResolvedValue(undefined),
  mockGetAggregatesByType: vi.fn(),
}))

vi.mock('h3', () => ({
  defineEventHandler: (handler: Function) => handler,
  setHeader: mocks.mockSetHeader,
  createError: mocks.mockCreateError,
}))

vi.mock('../../db/client', () => ({
  initDb: mocks.mockInitDb,
  getAggregatesByType: mocks.mockGetAggregatesByType,
}))

import handler from '../trends/[type].get'

describe('GET /api/trends/:type', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockGetAggregatesByType.mockReturnValue([
      { periodStart: '2025-01-01', value: 10 },
      { periodStart: '2025-01-02', value: 20 },
    ])
  })

  it('sets Cache-Control: no-cache header', async () => {
    const mockEvent = { context: { params: { type: 'throughput' } } } as any
    await handler(mockEvent)
    expect(mocks.mockSetHeader).toHaveBeenCalledWith(mockEvent, 'Cache-Control', 'no-cache')
  })

  it('initializes the database', async () => {
    await handler({ context: { params: { type: 'throughput' } } } as any)
    expect(mocks.mockInitDb).toHaveBeenCalledOnce()
  })

  it('returns aggregates for a valid type', async () => {
    const result = await handler({ context: { params: { type: 'cycleTime' } } } as any)
    expect(mocks.mockGetAggregatesByType).toHaveBeenCalledWith('cycleTime', 30)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ periodStart: '2025-01-01', value: 10 })
  })

  it('throws 400 for an invalid type', async () => {
    await expect(handler({ context: { params: { type: 'invalid' } } } as any)).rejects.toThrow()
    expect(mocks.mockCreateError).toHaveBeenCalledWith({ statusCode: 400, statusMessage: 'Invalid aggregate type' })
  })

  it('throws 400 when type is missing', async () => {
    await expect(handler({ context: { params: {} } } as any)).rejects.toThrow()
    expect(mocks.mockCreateError).toHaveBeenCalledWith({ statusCode: 400, statusMessage: 'Invalid aggregate type' })
  })
})
