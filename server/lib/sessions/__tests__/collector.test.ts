import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { createSessionCollector } from '../collector'
import { execFileSync } from 'node:child_process'

jest.mock('node:child_process')

const mockExecFileSync = jest.mocked(execFileSync)

const ENV_KEYS = ['OPENCODE_BIN', 'OPENCODE_COMMAND']
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  jest.resetAllMocks()
  savedEnv = {}
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

function enoentErr(): Error {
  const err = new Error('spawnSync ENOENT')
  Object.defineProperty(err, 'code', { value: 'ENOENT' })
  return err
}

function cliOutput(
  overview: Record<string, number | string>,
  tools: Array<{ name: string; count: number; pct: string }>,
  models: Array<{ name: string; messages: number; input: string; output: string; cacheRead: string; cacheWrite: string; cost: string }> = [],
): string {
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

  const modelRows = models.flatMap((model, index) => [
    `│ ${model.name.padEnd(50)} │`,
    `│  Messages${String(model.messages).padStart(42)} │`,
    `│  Input Tokens${model.input.padStart(37)} │`,
    `│  Output Tokens${model.output.padStart(36)} │`,
    `│  Cache Read${model.cacheRead.padStart(39)} │`,
    `│  Cache Write${model.cacheWrite.padStart(38)} │`,
    `│  Cost${model.cost.padStart(47)} │`,
    ...(index < models.length - 1 ? ['├────────────────────────────────────────────────────────┤'] : []),
  ])

  return [
    section('                       OVERVIEW                         ', overviewRows),
    '',
    section('                    COST & TOKENS                       ', []),
    '',
    ...models.length ? [section('                      MODEL USAGE                       ', modelRows)] : [],
    '',
    section('                      TOOL USAGE                        ', toolRows),
  ].join('\n')
}

function sessionListOutput(ids: string[] = []): string {
  return [
    'Session ID                      Title                                   Updated',
    '───────────────────────────────────────────────────────────────────────────────',
    ...ids.map((id, index) => `${id.padEnd(31)}  Session ${index + 1}`.padEnd(79)),
  ].join('\n')
}

function sessionExport(id: string, overrides: Record<string, unknown> = {}): string {
  const overrideInfo = typeof overrides.info === 'object' && overrides.info != null ? overrides.info as Record<string, unknown> : {}
  return JSON.stringify({
    info: {
      id,
      time: {
        created: 1781625988788,
        updated: 1781626315884,
      },
      ...overrideInfo,
    },
    messages: [],
    ...overrides,
  }, null, 2)
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

    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
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
    expect(result.sessionUsage!.modelUsage).toEqual([])
    expect(result.sessionUsage!.topActions).toHaveLength(2)
    expect(result.sessionUsage!.topActions[0]!.action).toBe('edit')
    expect(result.sessionUsage!.topActions[0]!.count).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('parses model usage rows from opencode stats --models output', async () => {
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
      [
        {
          name: 'opencode-go/deepseek-v4-flash',
          messages: 164,
          input: '1.3M',
          output: '80.1K',
          cacheRead: '4.9M',
          cacheWrite: '0',
          cost: '$0.2135',
        },
      ],
    )

    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
    mockExecFileSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.modelUsage).toEqual([
      {
        modelName: 'opencode-go/deepseek-v4-flash',
        messages: 164,
        inputTokens: 1_300_000,
        outputTokens: 80_100,
        cacheReadTokens: 4_900_000,
        cacheWriteTokens: 0,
        cost: 0.2135,
      },
    ])
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

    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
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

    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
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
      expect(args).toEqual(['session', 'list'])
      return sessionListOutput() + '\n'
    }).mockImplementationOnce((cmd: string, args: readonly string[] | undefined) => {
      expect(cmd).toBe('/custom/opencode-bin')
      expect(args).toEqual(['stats', '--days', '30', '--models'])
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
      expect(args).toEqual(['session', 'list'])
      return sessionListOutput() + '\n'
    }).mockImplementationOnce((cmd: string, args: readonly string[] | undefined) => {
      expect(cmd).toBe('/custom/opencode-bin')
      expect(args).toEqual(['stats', '--days', '30', '--models'])
      return cliOutput({ Sessions: 0, Messages: 0, Days: 30 }, []) + '\n'
    })

    const collector = createSessionCollector({ opencodeBin: '/custom/opencode-bin' })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
  })

  it('returns gap on unparseable CLI output', async () => {
    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
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
      .mockImplementationOnce(() => sessionListOutput() + '\n') // known local path works
      .mockImplementationOnce(() => cliOutput({ Sessions: 1, Messages: 0, Days: 1 }, []) + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(1)
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'opencode',
      ['session', 'list'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      3,
      '/home/openclaw/.opencode/bin/opencode',
      ['session', 'list'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })

  it('uses first executable candidate from candidate list', async () => {
    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
    mockExecFileSync.mockReturnValueOnce(cliOutput({ Sessions: 3, Messages: 0, Days: 30 }, []) + '\n')

    const collector = createSessionCollector({ opencodeBin: '/first/bin/opencode' })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/first/bin/opencode',
      ['session', 'list'],
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
    process.env['OPENCODE_BIN'] = '/env/opencode'
    process.env['OPENCODE_COMMAND'] = '/env/old-opencode'

    mockExecFileSync.mockReturnValueOnce(sessionListOutput() + '\n')
    mockExecFileSync.mockReturnValueOnce(cliOutput({ Sessions: 5, Messages: 0, Days: 30 }, []) + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(5)
    expect(mockExecFileSync).toHaveBeenCalledWith(
      '/env/opencode',
      ['session', 'list'],
      expect.objectContaining({ encoding: 'utf-8' }),
    )
  })
})
