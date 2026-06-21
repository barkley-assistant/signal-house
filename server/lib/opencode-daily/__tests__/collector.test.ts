import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { collectDailyOpenCodeUsage, parseOpenCodeDailyStats } from '../collector'
import { execFileSync } from 'node:child_process'

jest.mock('node:child_process')

const mockExecFileSync = jest.mocked(execFileSync)

beforeEach(() => {
  jest.resetAllMocks()
})

function enoentErr(): Error {
  const err = new Error('spawnSync ENOENT')
  Object.defineProperty(err, 'code', { value: 'ENOENT' })
  return err
}

function cliOutput(overview: Record<string, number | string>): string {
  const rows = Object.entries(overview).map(
    ([k, v]) => `│${k.padEnd(48)}${String(v).padStart(6)} │`,
  )

  return [
    '┌────────────────────────────────────────────────────────┐',
    '│                       OVERVIEW                         │',
    '├────────────────────────────────────────────────────────┤',
    ...rows,
    '└────────────────────────────────────────────────────────┘',
  ].join('\n')
}

describe('parseOpenCodeDailyStats', () => {
  it('parses basic stats output', () => {
    const output = cliOutput({
      Sessions: 3,
      Messages: 15,
      Input: '5000',
      Output: '3000',
      'Total Cost': '$1.23',
    })

    const result = parseOpenCodeDailyStats(output, '2026-06-19T12:00:00Z')
    expect(result.totalSessions).toBe(3)
    expect(result.totalMessages).toBe(15)
    expect(result.totalTokens).toBe(8000)
    expect(result.totalCost).toBe(1.23)
    expect(result.rawJson).toBe(output)
  })

  it('handles compact token values (K, M)', () => {
    const output = cliOutput({
      Sessions: 2,
      Messages: 10,
      Input: '3.8M',
      Output: '597.2K',
      'Total Cost': '$12.34',
    })

    const result = parseOpenCodeDailyStats(output, '2026-06-19T12:00:00Z')
    expect(result.totalTokens).toBe(3_800_000 + 597_200)
    expect(result.totalCost).toBe(12.34)
  })

  it('handles zero values', () => {
    const output = cliOutput({
      Sessions: 0,
      Messages: 0,
      Input: '0',
      Output: '0',
    })

    const result = parseOpenCodeDailyStats(output, '2026-06-19T12:00:00Z')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
  })

  it('returns zeros for empty output', () => {
    const result = parseOpenCodeDailyStats('', '2026-06-19T12:00:00Z')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
  })

  it('returns zeros for garbage output', () => {
    const result = parseOpenCodeDailyStats('not a valid CLI table\nsome random text', '2026-06-19T12:00:00Z')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
  })

  it('uses alternative label names (Input Tokens, Output Tokens)', () => {
    const output = cliOutput({
      Sessions: 1,
      Messages: 5,
      'Input Tokens': '2000',
      'Output Tokens': '1000',
    })

    const result = parseOpenCodeDailyStats(output, '2026-06-19T12:00:00Z')
    expect(result.totalTokens).toBe(3000)
  })
})

describe('collectDailyOpenCodeUsage', () => {
  it('parses stdout from opencode stats --days 1', () => {
    const output = cliOutput({
      Sessions: 5,
      Messages: 20,
      Input: '10000',
      Output: '5000',
      'Total Cost': '$5.00',
    })

    mockExecFileSync.mockReturnValueOnce(output + '\n')

    const result = collectDailyOpenCodeUsage()
    expect(result.errors).toHaveLength(0)
    expect(result.totalSessions).toBe(5)
    expect(result.totalMessages).toBe(20)
    expect(result.totalTokens).toBe(15000)
    expect(result.totalCost).toBe(5)
    expect(result.source).toBe('opencode')
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.rawJson).toBe(output + '\n')
  })

  it('returns errors when no opencode binary is available', () => {
    mockExecFileSync.mockImplementation(() => { throw enoentErr() })

    const result = collectDailyOpenCodeUsage()
    expect(result.errors).not.toHaveLength(0)
    expect(result.errors[0]).toContain('OpenCode binary not found')
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
    expect(result.rawJson).toBeNull()
  })

  it('returns zeros for unparseable output (no errors)', () => {
    mockExecFileSync.mockReturnValueOnce('garbage output\n')

    const result = collectDailyOpenCodeUsage()
    expect(result.errors).toHaveLength(0)
    expect(result.totalSessions).toBe(0)
    expect(result.totalMessages).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.totalCost).toBeNull()
    expect(result.rawJson).toBe('garbage output\n')
  })

  it('falls back to candidate paths when opencode not on PATH', () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw enoentErr() })
      .mockImplementationOnce(() => { throw enoentErr() })
      .mockImplementationOnce(() => {
        return cliOutput({ Sessions: 2, Messages: 8, Input: '1000', Output: '500' }) + '\n'
      })

    const result = collectDailyOpenCodeUsage()
    expect(result.errors).toHaveLength(0)
    expect(result.totalSessions).toBe(2)
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'opencode',
      ['stats', '--days', '1'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })
})
