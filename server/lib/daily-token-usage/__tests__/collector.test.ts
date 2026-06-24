import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const mocks: {
  mockExecFileSync: jest.Mock
  mockFindOpencodeBinary: jest.Mock
  mockGetLatestDailyTokenUsage: jest.Mock
  mockUpsertDailyTokenUsage: jest.Mock
} = {
  mockExecFileSync: jest.fn(),
  mockFindOpencodeBinary: jest.fn(),
  mockGetLatestDailyTokenUsage: jest.fn(),
  mockUpsertDailyTokenUsage: jest.fn(),
}

jest.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mocks.mockExecFileSync(...args),
}))

jest.mock('../../../db/client', () => ({
  getLatestDailyTokenUsage: mocks.mockGetLatestDailyTokenUsage,
  upsertDailyTokenUsage: mocks.mockUpsertDailyTokenUsage,
}))

jest.mock('../../opencode/binary', () => ({
  findOpencodeBinary: mocks.mockFindOpencodeBinary,
}))

import { maybeCollectDailyTokenUsage, collectAndStoreDailyTokenUsage } from '../collector'

const openCodeOutput = [
  '┌────────────────────────────────────────────────────────┐',
  '│                       OVERVIEW                         │',
  '├────────────────────────────────────────────────────────┤',
  '│Sessions                                             17 │',
  '│Messages                                            274 │',
  '│Days                                                  1 │',
  '└────────────────────────────────────────────────────────┘',
  '',
  '┌────────────────────────────────────────────────────────┐',
  '│                    COST & TOKENS                       │',
  '├────────────────────────────────────────────────────────┤',
  '│Total Cost                                        $0.60 │',
  '│Avg Cost/Day                                      $0.60 │',
  '│Avg Tokens/Session                               622.2K │',
  '│Median Tokens/Session                            267.2K │',
  '│Input                                            687.7K │',
  '│Output                                            87.0K │',
  '│Cache Read                                         9.8M │',
  '│Cache Write                                           0 │',
  '└────────────────────────────────────────────────────────┘',
  '',
  '┌────────────────────────────────────────────────────────┐',
  '│                      MODEL USAGE                       │',
  '├────────────────────────────────────────────────────────┤',
  '│ opencode-go/deepseek-v4-flash                          │',
  '│  Messages                                          155 │',
  '│  Input Tokens                                   441.6K │',
  '│  Output Tokens                                   93.8K │',
  '│  Cache Read                                       4.9M │',
  '│  Cache Write                                         0 │',
  '│  Cost                                          $0.1018 │',
  '├────────────────────────────────────────────────────────┤',
  '│ opencode-go/minimax-m3                                 │',
  '│  Messages                                           71 │',
  '│  Input Tokens                                    94.8K │',
  '│  Output Tokens                                   15.8K │',
  '│  Cache Read                                       3.7M │',
  '│  Cache Write                                         0 │',
  '│  Cost                                          $0.0895 │',
  '├────────────────────────────────────────────────────────┤',
  '│ opencode-go/kimi-k2.6                                  │',
  '│  Messages                                           29 │',
  '│  Input Tokens                                   151.3K │',
  '│  Output Tokens                                   18.8K │',
  '│  Cache Read                                       1.2M │',
  '│  Cache Write                                         0 │',
  '│  Cost                                          $0.4085 │',
  '├────────────────────────────────────────────────────────┤',
  '│ opencode-go/qwen3.7-plus                               │',
  '│  Messages                                            2 │',
  '│  Input Tokens                                        0 │',
  '│  Output Tokens                                       0 │',
  '│  Cache Read                                          0 │',
  '│  Cache Write                                         0 │',
  '│  Cost                                          $0.0000 │',
  '└────────────────────────────────────────────────────────┘',
  '',
  '┌────────────────────────────────────────────────────────┐',
  '│                      TOOL USAGE                        │',
  '├────────────────────────────────────────────────────────┤',
  '│ read               ████████████████████ 199 (39.6%)    │',
  '│ bash               ████████████         127 (25.3%)    │',
  '│ edit               ██████                68 (13.5%)    │',
  '│ todowrite          ████                  43 ( 8.6%)    │',
  '│ glob               ██                    27 ( 5.4%)    │',
  '│ grep               ██                    25 ( 5.0%)    │',
  '│ write              █                     10 ( 2.0%)    │',
  '│ task               █                      2 ( 0.4%)    │',
  '│ skill              █                      1 ( 0.2%)    │',
  '└────────────────────────────────────────────────────────┘',
  '\x1b[1A└────────────────────────────────────────────────────────┘',
].join('\n')

beforeEach(() => {
  jest.clearAllMocks()
})

describe('maybeCollectDailyTokenUsage', () => {
  it('skips CLI call when yesterday already exists in DB', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const date = yesterday.toISOString().slice(0, 10)
    mocks.mockGetLatestDailyTokenUsage.mockReturnValue({
      date,
      totalSessions: 5,
      totalMessages: 10,
      totalTokens: 100,
      totalCost: null,
      modelUsage: [],
      rawJson: null,
      createdAt: new Date().toISOString(),
    })

    const result = await maybeCollectDailyTokenUsage()

    expect(result.success).toBe(true)
    expect(result.row).toBeNull()
    expect(result.errors).toEqual([])
    expect(mocks.mockExecFileSync).not.toHaveBeenCalled()
    expect(mocks.mockFindOpencodeBinary).not.toHaveBeenCalled()
    expect(mocks.mockUpsertDailyTokenUsage).not.toHaveBeenCalled()
  })

  it('returns success: false when the binary is missing', async () => {
    mocks.mockGetLatestDailyTokenUsage.mockReturnValue(null)
    mocks.mockFindOpencodeBinary.mockReturnValue(null)

    const result = await maybeCollectDailyTokenUsage()

    expect(result.success).toBe(false)
    expect(result.row).toBeNull()
    expect(result.errors).toEqual(['OpenCode binary not found'])
    expect(mocks.mockExecFileSync).not.toHaveBeenCalled()
  })
})

describe('collectAndStoreDailyTokenUsage', () => {
  it('parses --days 1 --models output correctly using parseTokenUsage', async () => {
    mocks.mockFindOpencodeBinary.mockReturnValue('/usr/bin/opencode')
    mocks.mockExecFileSync.mockReturnValue(openCodeOutput)

    const result = await collectAndStoreDailyTokenUsage('2026-06-01')

    expect(result.success).toBe(true)
    expect(result.row).not.toBeNull()
    expect(result.row!.date).toBe('2026-06-01')
    expect(result.row!.totalSessions).toBe(17)
    expect(result.row!.totalMessages).toBe(274)
    expect(result.row!.totalTokens).toBe(774700)
    expect(result.row!.totalCost).toBe(0.6)
    expect(result.row!.modelUsage).toHaveLength(4)
    expect(result.row!.modelUsage[0]!.modelName).toBe('opencode-go/deepseek-v4-flash')
    expect(result.row!.modelUsage[0]!.messages).toBe(155)
    expect(result.row!.modelUsage[0]!.inputTokens).toBe(441600)
    expect(result.row!.modelUsage[0]!.outputTokens).toBe(93800)
    expect(result.row!.modelUsage[0]!.cacheReadTokens).toBe(4900000)
    expect(result.row!.modelUsage[0]!.cacheWriteTokens).toBe(0)
    expect(result.row!.modelUsage[0]!.cost).toBe(0.1018)
    expect(result.row!.modelUsage[1]!.modelName).toBe('opencode-go/minimax-m3')
    expect(result.row!.modelUsage[1]!.messages).toBe(71)
    expect(result.row!.modelUsage[1]!.inputTokens).toBe(94800)
    expect(result.row!.modelUsage[1]!.outputTokens).toBe(15800)
    expect(result.row!.modelUsage[2]!.modelName).toBe('opencode-go/kimi-k2.6')
    expect(result.row!.modelUsage[2]!.messages).toBe(29)
    expect(result.row!.modelUsage[2]!.inputTokens).toBe(151300)
    expect(result.row!.modelUsage[2]!.outputTokens).toBe(18800)
    expect(result.row!.modelUsage[3]!.modelName).toBe('opencode-go/qwen3.7-plus')
    expect(result.row!.modelUsage[3]!.messages).toBe(2)
    expect(result.row!.modelUsage[3]!.inputTokens).toBe(0)
    expect(result.row!.modelUsage[3]!.outputTokens).toBe(0)
    expect(result.row!.modelUsage[3]!.cost).toBe(0)
    expect(mocks.mockExecFileSync).toHaveBeenCalledWith(
      '/usr/bin/opencode',
      ['stats', '--days', '1', '--models'],
      expect.objectContaining({ timeout: 15000, encoding: 'utf-8' }),
    )
  })

  it('upserts a row and returns it', async () => {
    mocks.mockFindOpencodeBinary.mockReturnValue('/usr/bin/opencode')
    mocks.mockExecFileSync.mockReturnValue(openCodeOutput)

    const result = await collectAndStoreDailyTokenUsage('2026-06-01')

    expect(result.success).toBe(true)
    expect(result.row).not.toBeNull()
    expect(result.row!.date).toBe('2026-06-01')
    expect(result.row!.totalSessions).toBe(17)
    expect(result.row!.totalMessages).toBe(274)
    expect(result.row!.totalTokens).toBe(774700)
    expect(result.row!.totalCost).toBe(0.6)

    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledTimes(1)
    expect(mocks.mockUpsertDailyTokenUsage).toHaveBeenCalledWith({
      date: '2026-06-01',
      totalSessions: 17,
      totalMessages: 274,
      totalTokens: 774700,
      totalCost: 0.6,
      modelUsage: expect.any(Array),
      rawJson: expect.any(String),
    })
  })

  it('captures failures in the errors array rather than thrown', async () => {
    mocks.mockFindOpencodeBinary.mockReturnValue('/usr/bin/opencode')
    mocks.mockExecFileSync.mockImplementation(() => {
      throw new Error('Command failed with exit code 1')
    })

    const result = await collectAndStoreDailyTokenUsage('2026-06-01')

    expect(result.success).toBe(false)
    expect(result.row).toBeNull()
    expect(result.errors).toEqual(['Daily token usage collection failed: Command failed with exit code 1'])
  })
})
