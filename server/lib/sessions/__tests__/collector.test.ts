import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSessionCollector } from '../collector'
import { execFileSync } from 'node:child_process'

vi.mock('node:child_process')

const mockExecFileSync = vi.mocked(execFileSync)

beforeEach(() => {
  vi.resetAllMocks()
})

function enoentErr(): Error {
  const err = new Error('spawnSync ENOENT')
  Object.defineProperty(err, 'code', { value: 'ENOENT' })
  return err
}

function cliOutput(overview: Record<string, number | string>, tools: Array<{ name: string; count: number; pct: string }>): string {
  const section = (title: string, rows: string[]) => [
    '┌────────────────────────────────────────────────────────┐',
    `│${title}│`,
    '├────────────────────────────────────────────────────────┤',
    ...rows,
    '└────────────────────────────────────────────────────────┘',
  ].join('\n')

  const overviewRows = Object.entries(overview).map(
    ([k, v]) => `│${k.padEnd(48)}${String(v).padStart(6)} │`,
  )

  const toolRows = tools.map(
    t => `│ ${t.name.padEnd(18)} ██████████████████████████████ ${String(t.count).padStart(5)} (${t.pct})│`,
  )

  return [
    section('                       OVERVIEW                         ', overviewRows),
    '',
    section('                      TOOL USAGE                        ', toolRows),
  ].join('\n')
}

describe('createSessionCollector', () => {
  it('parses opencode stats output into sessions and aggregate', async () => {
    const mockOutput = cliOutput(
      {
        Sessions: 2,
        Messages: 4,
        Days: 1,
        'Total Cost': '$12.34',
        'Avg Cost/Day': '$12.34',
        'Avg Tokens/Session': 100,
        'Median Tokens / Session': 80,
        Input: '60',
        Output: '30',
        'Cache Read': 5,
        'Cache Write': 10,
      },
      [
        { name: 'edit', count: 1, pct: '50%' },
        { name: 'search', count: 1, pct: '50%' },
      ],
    )

    mockExecFileSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(2)
    expect(result.sessionUsage!.messages).toBe(4)
    expect(result.sessionUsage!.totalCost).toBe(12.34)
    expect(result.sessionUsage!.averageTokensPerSession).toBe(100)
    expect(result.sessionUsage!.inputTokens).toBe(60)
    expect(result.sessionUsage!.outputTokens).toBe(30)
    expect(result.sessionUsage!.cacheReadTokens).toBe(5)
    expect(result.sessionUsage!.cacheWriteTokens).toBe(10)
    expect(result.sessionUsage!.uniqueTools).toEqual(['edit', 'search'])
    expect(result.sessionUsage!.toolUsage[0]).toMatchObject({ toolName: 'edit', count: 1, percentage: 50 })
    expect(result.sessionUsage!.topActions).toHaveLength(2)
    expect(result.sessionUsage!.topActions[0]!.action).toBe('edit')
    expect(result.sessionUsage!.topActions[0]!.count).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('falls back to short token labels used by current opencode stats output', async () => {
    const mockOutput = cliOutput(
      {
        Sessions: 2,
        Messages: 4,
        Days: 1,
        'Total Cost': '$12.34',
        'Avg Cost/Day': '$12.34',
        'Avg Tokens/Session': 100,
        'Median Tokens/Session': 80,
        Input: '3.8M',
        Output: '597.2K',
        'Cache Read': '29.3M',
        'Cache Write': 0,
      },
      [],
    )

    mockExecFileSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.inputTokens).toBe(3_800_000)
    expect(result.sessionUsage!.outputTokens).toBe(597_200)
    expect(result.sessionUsage!.cacheReadTokens).toBe(29_300_000)
    expect(result.sessionUsage!.cacheWriteTokens).toBe(0)
  })

  it('handles zero sessions from CLI', async () => {
    const mockOutput = cliOutput(
      { Sessions: 0, Messages: 0, Days: 1 },
      [],
    )

    mockExecFileSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(0)
    expect(result.sessionUsage!.messages).toBe(0)
    expect(result.sessionUsage!.uniqueTools).toEqual([])
    expect(result.sessionUsage!.topActions).toEqual([])
  })

  it('returns documented gap when no opencode binary is available', async () => {
    mockExecFileSync.mockImplementation(() => { throw enoentErr() })

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).toBeNull()
    expect(result.gap).not.toBeNull()
    expect(result.gap).toContain('opencode stats CLI unavailable')
    expect(result.gap).toContain('no opencode binary available')
    expect(result.errors).toHaveLength(0)
  })

  it('prioritises opencodeBin over opencodeCommand when both are set', async () => {
    mockExecFileSync.mockImplementationOnce((cmd: string, args: readonly string[] | undefined) => {
      expect(cmd).toBe('/custom/opencode-bin')
      expect(args).toEqual(['stats', '--days', '30'])
      return cliOutput({ Sessions: 0, Messages: 0, Days: 30 }, []) + '\n'
    })

    const collector = createSessionCollector({
      opencodeBin: '/custom/opencode-bin',
      opencodeCommand: '/custom/opencode',
    })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
  })

  it('uses custom opencode command from config.opencodeBin', async () => {
    mockExecFileSync.mockImplementationOnce((cmd: string, args: readonly string[] | undefined) => {
      expect(cmd).toBe('/custom/opencode-bin')
      expect(args).toEqual(['stats', '--days', '30'])
      return cliOutput({ Sessions: 0, Messages: 0, Days: 30 }, []) + '\n'
    })

    const collector = createSessionCollector({ opencodeBin: '/custom/opencode-bin' })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
  })

  it('returns gap on unparseable CLI output', async () => {
    mockExecFileSync.mockReturnValueOnce('garbage output that is not a CLI table\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).toBeNull()
    expect(result.gap).not.toBeNull()
    expect(result.gap).toContain('opencode stats CLI unavailable')
    expect(result.errors).toHaveLength(0)
  })

  it('falls back to known local path when PATH opencode is missing', async () => {
    mockExecFileSync
      .mockImplementationOnce(() => { throw enoentErr() }) // 'opencode' not on PATH
      .mockImplementationOnce(() => { throw enoentErr() }) // $HOME/.opencode/bin/opencode not found
      .mockImplementationOnce(() => cliOutput({ Sessions: 1, Messages: 0, Days: 1 }, []) + '\n') // known local path works

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(1)
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'opencode',
      ['stats', '--days', '30'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      '/home/openclaw/.opencode/bin/opencode',
      ['stats', '--days', '30'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('uses first executable candidate from candidate list', async () => {
    mockExecFileSync.mockReturnValueOnce(cliOutput({ Sessions: 3, Messages: 0, Days: 30 }, []) + '\n')

    const collector = createSessionCollector({ opencodeBin: '/first/bin/opencode' })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/first/bin/opencode',
      ['stats', '--days', '30'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('returns gap when no candidate is found', async () => {
    mockExecFileSync.mockImplementation(() => { throw enoentErr() })

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).toBeNull()
    expect(result.gap).not.toBeNull()
    expect(result.gap).toContain('opencode stats CLI unavailable')
    expect(result.gap).toContain('no opencode binary available')
  })

  it('respects prior env vars over defaults but config over env', async () => {
    vi.stubEnv('OPENCODE_BIN', '/env/opencode')
    vi.stubEnv('OPENCODE_COMMAND', '/env/old-opencode')

    mockExecFileSync.mockReturnValueOnce(cliOutput({ Sessions: 5, Messages: 0, Days: 30 }, []) + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(5)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/env/opencode',
      ['stats', '--days', '30'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )

    vi.unstubAllEnvs()
  })
})
