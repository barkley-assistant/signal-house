import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mocks: {
  mockConnectOpencodeDb: jest.Mock
  mockQuerySessionsByDay: jest.Mock
  mockQueryModelBreakdown: jest.Mock
  mockUpsertDailyTokenUsage: jest.Mock
} = {
  mockConnectOpencodeDb: jest.fn(),
  mockQuerySessionsByDay: jest.fn(),
  mockQueryModelBreakdown: jest.fn(),
  mockUpsertDailyTokenUsage: jest.fn(),
}

jest.mock('../../opencode/db-collector', () => ({
  connectOpencodeDb: mocks.mockConnectOpencodeDb,
  querySessionsByDay: mocks.mockQuerySessionsByDay,
  queryModelBreakdown: mocks.mockQueryModelBreakdown,
}))

jest.mock('../../../db/client', () => ({
  upsertDailyTokenUsage: mocks.mockUpsertDailyTokenUsage,
}))

import { maybeCollectDailyTokenUsage } from '../collector'

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
  mocks.mockConnectOpencodeDb.mockReturnValue(mockDb())
  mocks.mockQuerySessionsByDay.mockReturnValue([])
  mocks.mockQueryModelBreakdown.mockReturnValue([])
})

describe('maybeCollectDailyTokenUsage', () => {
  it('returns error when connectOpencodeDb returns null', async () => {
    mocks.mockConnectOpencodeDb.mockReturnValue(null)

    const result = await maybeCollectDailyTokenUsage()

    expect(result.success).toBe(false)
    expect(result.dates).toEqual([])
    expect(result.upserted).toBe(0)
    expect(result.errors).toEqual(['OpenCode DB not found: unable to connect to opencode.db'])
    expect(mocks.mockQuerySessionsByDay).not.toHaveBeenCalled()
  })

  it('returns empty success when no days from querySessionsByDay', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([])

    const result = await maybeCollectDailyTokenUsage()

    expect(result.success).toBe(true)
    expect(result.dates).toEqual([])
    expect(result.upserted).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('updates days that already exist in DB', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-01'),
      makeAgg('2026-06-02'),
    ])

    const result = await maybeCollectDailyTokenUsage()

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

  it('upserts all days including existing ones', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-01'),
      makeAgg('2026-06-02'),
      makeAgg('2026-06-03'),
    ])
    mocks.mockQueryModelBreakdown.mockReturnValue([
      { modelName: 'model-a', sessions: 3, messages: 12, inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5, cost: 0.1 },
      { modelName: 'model-b', sessions: 2, messages: 8, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.023 },
    ])

    const result = await maybeCollectDailyTokenUsage()

    expect(result.success).toBe(true)
    expect(result.dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(result.upserted).toBe(3)
    expect(result.errors).toEqual([])
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(3)
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-01' }),
    )
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-02' }),
    )
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-06-03' }),
    )
  })

  it('upserts all days on every run when collection is called multiple times', async () => {
    // Spec scenario: Multiple collection runs for same window
    // Second run should still upsert every day (not skip already-existing rows)
    const aggs = [
      makeAgg('2026-06-01'),
      makeAgg('2026-06-02'),
      makeAgg('2026-06-03'),
    ]

    // First run: collection produces 3 rows
    mocks.mockQuerySessionsByDay.mockReturnValueOnce(aggs)

    const first = await maybeCollectDailyTokenUsage()
    expect(first.upserted).toBe(3)
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(3)

    // Second run on the same window: must still upsert all 3
    mocks.mockQuerySessionsByDay.mockReturnValueOnce(aggs)

    const second = await maybeCollectDailyTokenUsage()
    expect(second.success).toBe(true)
    expect(second.upserted).toBe(3)
    expect(second.dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(6)
  })

  it('handles model breakdown mapping correctly', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([makeAgg('2026-06-02')])
    mocks.mockQueryModelBreakdown.mockReturnValue([
      { modelName: 'model-a', sessions: 3, messages: 12, inputTokens: 100, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 5, cost: 0.1 },
    ])

    await maybeCollectDailyTokenUsage()

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { modelUsage: Array<{ modelName: string; messages: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number }> }
    expect(inserted.modelUsage).toEqual([
      {
        modelName: 'model-a',
        messages: 12,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
        cost: 0.1,
      },
    ])
  })

  it('builds totalMessages as sessions count, rawJson as null', async () => {
    mocks.mockQuerySessionsByDay.mockReturnValue([
      makeAgg('2026-06-02', { sessions: 7 }),
    ])
    mocks.mockQueryModelBreakdown.mockReturnValue([])

    await maybeCollectDailyTokenUsage()

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    const inserted = mocks.mockUpsertDailyTokenUsage.mock.calls[0]![0] as { totalMessages: number; totalTokens: number; rawJson: unknown }
    expect(inserted.totalMessages).toBe(7)
    expect(inserted.totalTokens).toBe(100 + 50 + 10 + 20 + 5)
    expect(inserted.rawJson).toBeNull()
  })
})
