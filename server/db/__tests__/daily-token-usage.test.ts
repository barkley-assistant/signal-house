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
          tokensReasoning: 0,
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
    // totalTokens is computed from model_usage JSON: 441600 + 93800 + 4900000 + 0 = 5,435,400
    expect(results[0]!.totalTokens).toBe(5435400)
    expect(results[0]!.totalCost).toBe(0.6)
    expect(results[0]!.modelUsage).toEqual([
      {
        modelName: 'opencode-go/deepseek-v4-flash',
        messages: 155,
        inputTokens: 441600,
        outputTokens: 93800,
        tokensReasoning: 0,
        cacheReadTokens: 4900000,
        cacheWriteTokens: 0,
        cost: 0.1018,
      },
    ])
    expect(results[0]!.rawJson).toBe('{"some":"json"}')
  })

  it('updates an existing row on conflict (same date)', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-06-01', { totalSessions: 10, totalMessages: 100, totalCost: 0.3 }))
    upsertDailyTokenUsage(makeRow('2026-06-01', { totalSessions: 20, totalMessages: 200, totalCost: 0.6 }))

    const results = getDailyTokenUsageRange('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.totalSessions).toBe(20)
    expect(results[0]!.totalMessages).toBe(200)
    // totalTokens is computed from model_usage JSON (empty here)
    expect(results[0]!.totalTokens).toBe(0)
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

  it('computes totalTokens as the sum of all 5 token fields across all modelUsage items', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-06-20', {
      modelUsage: [
        {
          modelName: 'a',
          messages: 1,
          inputTokens: 100,
          outputTokens: 50,
          tokensReasoning: 25,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          cost: 0.01,
        },
        {
          modelName: 'b',
          messages: 1,
          inputTokens: 200,
          outputTokens: 0,
          tokensReasoning: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          cost: 0.02,
        },
      ],
    }))

    const [row] = getDailyTokenUsageRange('2026-06-20', '2026-06-20')
    // Sum: (100+50+25+10+5) + (200+0+0+0+0) = 190 + 200 = 390
    expect(row?.totalTokens).toBe(390)
  })

  it('defaults missing token fields in modelUsage to 0 when computing totalTokens (historical data)', async () => {
    // Simulate a row whose model_usage JSON predates the fix and lacks
    // tokensReasoning / cacheReadTokens / cacheWriteTokens.
    await initDb()
    const db = (await import('../client')).getDbPath()
    const Database = (await import('better-sqlite3')).default
    const conn = new Database(db)
    conn.prepare(`
      INSERT INTO daily_token_usage (date, total_sessions, total_messages, total_cost, model_usage, raw_json)
      VALUES (
        '2026-06-21',
        1, 1, 0.1,
        '[{"modelName":"legacy","messages":1,"inputTokens":300,"outputTokens":100,"cost":0.1}]',
        NULL
      )
    `).run()
    conn.close()

    const [row] = getDailyTokenUsageRange('2026-06-21', '2026-06-21')
    // Missing fields default to 0: 300 + 100 + 0 + 0 + 0 = 400
    expect(row?.totalTokens).toBe(400)
  })

  it('handles empty modelUsage by computing totalTokens = 0', async () => {
    await initDb()
    upsertDailyTokenUsage(makeRow('2026-06-22', { modelUsage: [] }))

    const [row] = getDailyTokenUsageRange('2026-06-22', '2026-06-22')
    expect(row?.totalTokens).toBe(0)
  })
})
