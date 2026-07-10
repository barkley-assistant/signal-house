import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mocks: {
  mockConnectHermesDb: jest.Mock
  mockQuerySessionsByDay: jest.Mock
  mockQueryModelBreakdown: jest.Mock
  mockUpsertDailyTokenUsage: jest.Mock
} = {
  mockConnectHermesDb: jest.fn(),
  mockQuerySessionsByDay: jest.fn(),
  mockQueryModelBreakdown: jest.fn(),
  mockUpsertDailyTokenUsage: jest.fn(),
}

jest.mock('../../hermes/db-collector', () => ({
  connectHermesDb: mocks.mockConnectHermesDb,
  querySessionsByDay: mocks.mockQuerySessionsByDay,
  queryModelBreakdown: mocks.mockQueryModelBreakdown,
}))

jest.mock('../../../db/client', () => ({
  upsertDailyTokenUsage: mocks.mockUpsertDailyTokenUsage,
}))

import { maybeCollectHermesDailyTokenUsage } from '../hermes-collector'

function mockDb() {
  return { close: jest.fn() }
}

function makeAgg(day: string, overrides?: Partial<{
  sessions: number
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
}>): {
  day: string
  sessions: number
  startedSessions: number
  completedSessions: number
  erroredSessions: number
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensReasoning: number
  tokensCacheRead: number
  tokensCacheWrite: number
} {
  return {
    day,
    sessions: 5,
    startedSessions: 5,
    completedSessions: 4,
    erroredSessions: 1,
    cost: 0.123,
    tokensInput: 100,
    tokensOutput: 50,
    tokensReasoning: 10,
    tokensCacheRead: 20,
    tokensCacheWrite: 5,
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mocks.mockConnectHermesDb.mockReturnValue(mockDb())
  mocks.mockQuerySessionsByDay.mockReturnValue([])
  mocks.mockQueryModelBreakdown.mockReturnValue([])
})

describe('maybeCollectHermesDailyTokenUsage', () => {
  it('returns error when connectHermesDb returns null', async () => {
    mocks.mockConnectHermesDb.mockReturnValue(null)

    const result = await maybeCollectHermesDailyTokenUsage()

    expect(result.success).toBe(false)
    expect(result.dates).toEqual([])
    expect(result.upserted).toBe(0)
    expect(result.errors).toEqual(['Hermes DB not found: unable to connect to state.db'])
    expect(mocks.mockQuerySessionsByDay).not.toHaveBeenCalled()
  })

  it('returns empty success when no days from querySessionsByDay', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([])

    const result = await maybeCollectHermesDailyTokenUsage()

    expect(result.success).toBe(true)
    expect(result.dates).toEqual([])
    expect(result.upserted).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('upserts multiple days successfully', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-01'),
      makeAgg('2026-06-02'),
    ])

    const result = await maybeCollectHermesDailyTokenUsage()

    expect(result.success).toBe(true)
    expect(result.dates).toEqual(['2026-06-01', '2026-06-02'])
    expect(result.upserted).toBe(2)
    expect(result.errors).toEqual([])
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(2)
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-01' }),
    )
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-02' }),
    )
  })

  it('sets source to hermes in upserted rows', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([makeAgg('2026-06-01')])
    mocks.mockQueryModelBreakdown.mockReturnValue([])

    await maybeCollectHermesDailyTokenUsage()

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { source: string }
    expect(inserted.source).toBe('hermes')
  })

  it('passes epoch-seconds timestamps to queryModelBreakdown for Hermes DB', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([makeAgg('2026-06-02')])
    mocks.mockQueryModelBreakdown.mockReturnValue([])

    await maybeCollectHermesDailyTokenUsage()

    expect(mocks.mockQueryModelBreakdown).toHaveBeenCalledTimes(1)
    const [dayStart, dayEnd] = mocks.mockQueryModelBreakdown.mock.calls[0]! as [number, number]

    // Verify dayStart and dayEnd are epoch seconds (not milliseconds)
    // June 2 2026 UTC at midnight has a known epoch second value
    const expectedDayStart = Math.floor(Date.UTC(2026, 5, 2) / 1000)
    expect(dayStart).toBe(expectedDayStart)
    expect(dayEnd).toBe(expectedDayStart + 86400)
    // Sanity: epoch seconds should be ~10 digits, not 13 (milliseconds would be 13)
    expect(String(dayStart).length).toBeLessThanOrEqual(10)
  })

  it('handles model breakdown mapping correctly', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([makeAgg('2026-06-02')])
    mocks.mockQueryModelBreakdown.mockReturnValue([
      { modelName: 'model-a', sessions: 3, messages: 12, inputTokens: 100, outputTokens: 50, reasoningTokens: 17, cacheReadTokens: 20, cacheWriteTokens: 5, cost: 0.1 },
    ])

    await maybeCollectHermesDailyTokenUsage()

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { modelUsage: Array<{ modelName: string; messages: number; inputTokens: number; outputTokens: number; tokensReasoning: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }> }
    expect(inserted.modelUsage).toEqual([
      {
        modelName: 'model-a',
        messages: 12,
        inputTokens: 100,
        outputTokens: 50,
        tokensReasoning: 17,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        cost: 0.1,
      },
    ])
  })

  it('builds totalMessages as sessions count, totalTokens from all token fields, rawJson as null', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-02', { sessions: 7 }),
    ])
    mocks.mockQueryModelBreakdown.mockReturnValue([])

    await maybeCollectHermesDailyTokenUsage()

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { totalMessages: number; totalTokens: number; rawJson: unknown }
    expect(inserted.totalMessages).toBe(7)
    expect(inserted.totalTokens).toBe(100 + 50 + 10 + 20 + 5)
    expect(inserted.rawJson).toBeNull()
  })

  it('carries reasoningTokens through modelUsage items', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([makeAgg('2026-06-04')])
    mocks.mockQueryModelBreakdown.mockReturnValue([
      { modelName: 'model-a', sessions: 1, messages: 1, inputTokens: 10, outputTokens: 20, reasoningTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
    ])

    await maybeCollectHermesDailyTokenUsage()

    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { modelUsage: Array<{ tokensReasoning: number | null }> }
    expect(inserted.modelUsage[0]?.tokensReasoning).toBe(7)
  })

  it('continues processing remaining days when a single day upsert fails', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-01'),
      makeAgg('2026-06-02'),
      makeAgg('2026-06-03'),
    ])
    mocks.mockQueryModelBreakdown.mockReturnValue([])

    // Fail on the second day only
    mocks.mockUpsertDailyTokenUsage
      .mockImplementationOnce(() => { /* succeeds for day 1 */ })
      .mockImplementationOnce(() => { throw new Error('upsert error') })
      .mockImplementationOnce(() => { /* succeeds for day 3 */ })

    const result = await maybeCollectHermesDailyTokenUsage()

    expect(result.success).toBe(false)
    expect(result.dates).toEqual(['2026-06-01', '2026-06-03'])
    expect(result.upserted).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Failed to upsert daily Hermes token usage for 2026-06-02')
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(3)
  })
})
