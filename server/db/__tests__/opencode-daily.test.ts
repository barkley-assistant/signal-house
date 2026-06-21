import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb, upsertOpenCodeDailyUsage, getOpenCodeDailyUsages, getLatestOpenCodeDailyUsage, close } from '../client'
import type { OpenCodeDailyUsageInsert } from '../../../types/opencode-daily'

let tmpDir: string

function makeRow(date: string, overrides: Partial<OpenCodeDailyUsageInsert> = {}): OpenCodeDailyUsageInsert {
  return {
    date,
    source: 'opencode',
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: null,
    rawJson: null,
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'opencode-daily-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('opencode_daily_usage table', () => {
  it('inserts a row and retrieves it', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', {
      totalSessions: 5,
      totalMessages: 10,
      totalTokens: 5000,
      totalCost: 1.23,
    }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.date).toBe('2026-06-01')
    expect(results[0]!.source).toBe('opencode')
    expect(results[0]!.totalSessions).toBe(5)
    expect(results[0]!.totalMessages).toBe(10)
    expect(results[0]!.totalTokens).toBe(5000)
    expect(results[0]!.totalCost).toBe(1.23)
    expect(results[0]!.rawJson).toBeNull()
  })

  it('upserts same date updating the same row', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { totalSessions: 5, totalMessages: 10 }))
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { totalSessions: 8, totalMessages: 15 }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(1)
    expect(results[0]!.totalSessions).toBe(8)
    expect(results[0]!.totalMessages).toBe(15)
  })

  it('preserves different dates separately', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { totalSessions: 3 }))
    upsertOpenCodeDailyUsage(makeRow('2026-06-02', { totalSessions: 7 }))
    upsertOpenCodeDailyUsage(makeRow('2026-06-03', { totalSessions: 1 }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-03')
    expect(results).toHaveLength(3)
    expect(results.find((r) => r.date === '2026-06-02')!.totalSessions).toBe(7)
  })

  it('queries a date range returning only days that have data', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01'))
    upsertOpenCodeDailyUsage(makeRow('2026-06-03'))
    upsertOpenCodeDailyUsage(makeRow('2026-06-05'))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-05')
    expect(results).toHaveLength(3)
    const days = results.map((r) => r.date).sort()
    expect(days).toEqual(['2026-06-01', '2026-06-03', '2026-06-05'])
  })

  it('returns empty array when no days in range', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01'))

    const results = getOpenCodeDailyUsages('2026-06-10', '2026-06-20')
    expect(results).toHaveLength(0)
  })

  it('returns results in descending order', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01'))
    upsertOpenCodeDailyUsage(makeRow('2026-06-02'))
    upsertOpenCodeDailyUsage(makeRow('2026-06-03'))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-03')
    expect(results.map((r) => r.date)).toEqual(['2026-06-03', '2026-06-02', '2026-06-01'])
  })

  it('getLatestOpenCodeDailyUsage returns the most recent row', async () => {
    await initDb()
    expect(getLatestOpenCodeDailyUsage()).toBeNull()

    upsertOpenCodeDailyUsage(makeRow('2026-06-01'))
    expect(getLatestOpenCodeDailyUsage()!.date).toBe('2026-06-01')

    upsertOpenCodeDailyUsage(makeRow('2026-06-05'))
    expect(getLatestOpenCodeDailyUsage()!.date).toBe('2026-06-05')
  })

  it('coexists with different source values', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { source: 'opencode', totalSessions: 5 }))
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { source: 'manual', totalSessions: 3 }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-01')
    expect(results).toHaveLength(2)
    const opencode = results.find((r) => r.source === 'opencode')
    const manual = results.find((r) => r.source === 'manual')
    expect(opencode!.totalSessions).toBe(5)
    expect(manual!.totalSessions).toBe(3)
  })

  it('stores rawJson text', async () => {
    await initDb()
    const raw = '{"sessions": 5, "messages": 10, "modelUsage": [{"modelName":"a","messages":2,"inputTokens":1,"outputTokens":2,"cacheReadTokens":null,"cacheWriteTokens":null,"cost":0.1}]}'
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { rawJson: raw }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-01')
    expect(results[0]!.rawJson).toBe(raw)
  })

  it('handles null totalCost', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01', { totalCost: null }))

    const results = getOpenCodeDailyUsages('2026-06-01', '2026-06-01')
    expect(results[0]!.totalCost).toBeNull()
  })

  it('returns all rows when called without date range', async () => {
    await initDb()
    upsertOpenCodeDailyUsage(makeRow('2026-06-01'))
    upsertOpenCodeDailyUsage(makeRow('2026-06-02'))

    const results = getOpenCodeDailyUsages()
    expect(results).toHaveLength(2)
  })
})
