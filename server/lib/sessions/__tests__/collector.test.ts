import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSessionCollector } from '../collector'
import { execSync } from 'node:child_process'

vi.mock('node:child_process')

const mockExecSync = vi.mocked(execSync)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('createSessionCollector', () => {
  it('parses opencode stats output into sessions and aggregate', async () => {
    const mockOutput = JSON.stringify({
      sessions: [
        {
          id: 's1',
          toolName: 'opencode',
          action: 'edit',
          timestamp: '2025-06-01T10:00:00Z',
          durationMs: 1500,
          success: true,
        },
        {
          id: 's2',
          toolName: 'opencode',
          action: 'search',
          timestamp: '2025-06-01T11:00:00Z',
          durationMs: 800,
          success: true,
        },
      ],
      period: {
        start: '2025-05-01T00:00:00Z',
        end: '2025-06-01T12:00:00Z',
      },
    })

    mockExecSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(2)
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(2)
    expect(result.sessionUsage!.uniqueTools).toEqual(['opencode'])
    expect(result.sessionUsage!.topActions).toHaveLength(2)
    expect(result.sessionUsage!.topActions[0]!.action).toBe('edit')
    expect(result.sessionUsage!.topActions[0]!.count).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('handles sessions with minimal fields', async () => {
    const mockOutput = JSON.stringify({
      sessions: [
        { action: 'view' },
      ],
    })

    mockExecSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]!.toolName).toBe('opencode')
    expect(result.sessions[0]!.action).toBe('view')
    expect(result.sessions[0]!.success).toBe(true)
  })

  it('handles empty sessions from CLI', async () => {
    const mockOutput = JSON.stringify({ sessions: [] })
    mockExecSync.mockReturnValueOnce(mockOutput + '\n')

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).not.toBeNull()
    expect(result.sessionUsage!.totalSessions).toBe(0)
    expect(result.sessionUsage!.uniqueTools).toEqual([])
    expect(result.sessionUsage!.topActions).toEqual([])
  })

  it('returns documented gap when CLI is unavailable', async () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('command not found: opencode')
    })

    const collector = createSessionCollector()
    const result = await collector.collect()

    expect(result.sessions).toHaveLength(0)
    expect(result.sessionUsage).toBeNull()
    expect(result.gap).not.toBeNull()
    expect(result.gap).toContain('opencode stats CLI unavailable')
    expect(result.errors).toHaveLength(0)
  })

  it('uses custom opencode command path', async () => {
    mockExecSync.mockImplementationOnce((cmd: string) => {
      expect(cmd).toContain('/custom/opencode')
      return JSON.stringify({ sessions: [] }) + '\n'
    })

    const collector = createSessionCollector({ opencodeCommand: '/custom/opencode' })
    const result = await collector.collect()

    expect(result.gap).toBeNull()
    expect(result.sessions).toHaveLength(0)
  })
})
