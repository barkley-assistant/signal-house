import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb, upsertDailyTokenUsage, getDailyTokenUsageRange, getLatestDailyTokenUsage, close } from '../client'
import type { DailyTokenUsageInsert } from '../../../types/daily-token-usage'

let tmpDir: string

function makeRow(date: string, overrides: Partial<DailyTokenUsageInsert> = {}): DailyTokenUsageInsert {
  return {
    date,
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: null,
    modelUsage: [],
    rawJson: null,
    ...overrides,
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'daily-token-usage-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('daily_token_usage table', () => {
  it('inserts a new row', async () => {
    await initDb()
    const row = makeRow('2026-06-01', {
      totalSessions: 17,
      totalMessages: 274,
      totalTokens: 774700,
      totalCost: 0.6,
      modelUsage: [
        {
          modelName: 'opencode-go/deepseek-v4-flash',
          messages: 155,
          inputTokens: 441600,
          outputTokens: 93800,
          cacheReadTokens: 4900000,
          cacheWriteTokens: 0,
          cost: 0.1018,
        },
      ],
      rawJson: '{"some":"json"}',
    })
    upsertDailyTokenUsage(row)

    const results = getDailyTokenUsageRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.date).toBe('2026-06-01')
    expect(results[0]!.totalSessions).toBe(17)
    expect(results[0]!.totalMessages).toBe(274)
    expect(results[0]!.totalTokens).toBe(774700)
    expect(results[0]!.totalCost).toBe(0.6)
    expect(results[0]!.modelUsage).toEqual([
      {
        modelName: 'opencode-go/deepseek-v4-flash',
        messages: 155,
        inputTokens: 441600,
        outputTokens: 93800,
        cacheReadTokens: 4900000,
        cacheWriteTokens: 0,
        cost: 0.1018,
      },
    ])
    expect(results[0]!.rawJson).toBe('{"some":"json"}')
  })

  it('updates an existing row on conflict (same date)', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-06-01', { totalSessions: 10, totalMessages: 100, totalTokens: 500000, totalCost: 0.3 }))
    upsertDailyTokenUsage(makeRow('2026-06-01', { totalSessions: 20, totalMessages: 200, totalTokens: 1000000, totalCost: 0.6 }))

    const results = getDailyTokenUsageRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.totalSessions).toBe(20)
    expect(results[0]!.totalMessages).toBe(200)
    expect(results[0]!.totalTokens).toBe(1000000)
    expect(results[0]!.totalCost).toBe(0.6)
  })

  it('returns rows ordered by date DESC', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-06-01', { totalSessions: 1 }))
    upsertDailyTokenUsage(makeRow('2026-06-02', { totalSessions: 2 }))
    upsertDailyTokenUsage(makeRow('2026-06-03', { totalSessions: 3 }))

    const results = getDailyTokenUsageRange('2026-06-01', '2026-06-03')
    expect(results.map((r) => r.date)).toEqual(['2026-06-03', '2026-06-02', '2026-06-01'])
  })

  it('respects fromDate and toDate filters', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-05-01'))
    upsertDailyTokenUsage(makeRow('2026-05-15'))
    upsertDailyTokenUsage(makeRow('2026-06-01'))
    upsertDailyTokenUsage(makeRow('2026-06-15'))
    upsertDailyTokenUsage(makeRow('2026-07-01'))

    const results = getDailyTokenUsageRange('2026-05-15', '2026-06-15')
    expect(results).toHaveLength(3)
    const dates = results.map((r) => r.date)
    expect(dates).toContain('2026-05-15')
    expect(dates).toContain('2026-06-01')
    expect(dates).toContain('2026-06-15')
    expect(dates).not.toContain('2026-05-01')
    expect(dates).not.toContain('2026-07-01')
  })
})
