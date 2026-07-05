import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { collectTokenUsageSnapshot } from '../collector'

const mockDb = { close: jest.fn() }

jest.mock('../db-collector', () => ({
  connectOpencodeDb: jest.fn(() => mockDb),
  querySessionsByDay: jest.fn(() => [
    {
      day: '2026-05-30',
      sessions: 2,
      startedSessions: 2,
      completedSessions: 2,
      erroredSessions: 0,
      cost: 0.75,
      tokensInput: 500,
      tokensOutput: 300,
      tokensReasoning: 0,
      tokensCacheRead: 50,
      tokensCacheWrite: 25,
    },
    {
      day: '2026-06-01',
      sessions: 1,
      startedSessions: 1,
      completedSessions: 1,
      erroredSessions: 0,
      cost: 0.5,
      tokensInput: 200,
      tokensOutput: 100,
      tokensReasoning: 0,
      tokensCacheRead: 10,
      tokensCacheWrite: 5,
    },
  ]),
  queryModelBreakdown: jest.fn(() => [
    {
      modelName: 'opencode-go/minimax-m3',
      sessions: 2,
      messages: 8,
      inputTokens: 500,
      outputTokens: 300,
      reasoningTokens: 0,
      cacheReadTokens: 50,
      cacheWriteTokens: 25,
      cost: 0.75,
    },
    {
      modelName: 'opencode-go/deepseek-v4-flash',
      sessions: 1,
      messages: 3,
      inputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 0,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cost: 0.5,
    },
  ]),
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe('collectTokenUsageSnapshot', () => {
  it('returns aggregated token usage from opencode.db', () => {
    const result = collectTokenUsageSnapshot()

    expect(result.source).toBe('opencodedb')
    expect(result.toolName).toBe('opencode')
    expect(result.rawJson).toBeNull()
    expect(result.totalSessions).toBe(3)
    expect(result.totalMessages).toBe(3)
    expect(result.totalTokens).toBe(1190)
    expect(result.totalCost).toBe(1.25)
    expect(result.modelUsage).toEqual([
      {
        modelName: 'opencode-go/minimax-m3',
        messages: 8,
        inputTokens: 500,
        outputTokens: 300,
        tokensReasoning: 0,
        cacheReadTokens: 50,
        cacheWriteTokens: 25,
        cost: 0.75,
      },
      {
        modelName: 'opencode-go/deepseek-v4-flash',
        messages: 3,
        inputTokens: 200,
        outputTokens: 100,
        tokensReasoning: 0,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        cost: 0.5,
      },
    ])
    expect(result.errors).toHaveLength(0)
    expect(mockDb.close).toHaveBeenCalledTimes(1)
  })

  it('sums all 5 token types in totalTokens and includes tokensReasoning per model', () => {
    // Override the default mocks to include non-zero reasoning tokens
    // so we can prove the sum covers all 5 types.
    const { querySessionsByDay, queryModelBreakdown } = jest.requireMock('../db-collector') as {
      querySessionsByDay: jest.Mock
      queryModelBreakdown: jest.Mock
    }
    querySessionsByDay.mockReturnValueOnce([
      {
        day: '2026-06-01',
        sessions: 1,
        startedSessions: 1,
        completedSessions: 1,
        erroredSessions: 0,
        cost: 0.5,
        tokensInput: 100,
        tokensOutput: 50,
        tokensReasoning: 25,
        tokensCacheRead: 10,
        tokensCacheWrite: 5,
      },
    ])
    queryModelBreakdown.mockReturnValueOnce([
      {
        modelName: 'm',
        sessions: 1,
        messages: 1,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        cost: 0.5,
      },
    ])

    const result = collectTokenUsageSnapshot()

    // Sum = 100 + 50 + 25 + 10 + 5 = 190
    expect(result.totalTokens).toBe(190)
    expect(result.modelUsage[0]?.tokensReasoning).toBe(25)
  })

  it('returns a zeroed fallback when the opencode.db is unavailable', () => {
    const { connectOpencodeDb } = jest.requireMock('../db-collector') as {
      connectOpencodeDb: jest.Mock
    }
    connectOpencodeDb.mockReturnValueOnce(null)

    const result = collectTokenUsageSnapshot()

    expect(result.source).toBe('opencodedb')
    expect(result.toolName).toBe('opencode')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
    expect(result.modelUsage).toEqual([])
    expect(result.rawJson).toBeNull()
    expect(result.errors).toEqual([
      'OpenCode DB not found: unable to connect to opencode.db',
    ])
  })
})
