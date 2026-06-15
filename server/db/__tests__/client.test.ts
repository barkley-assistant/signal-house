import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initDb, getLatestState, close, setRefreshRunState, getRefreshRunState } from '../client'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'metrics-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('initDb on fresh database', () => {
  it('initializes and returns a valid db', async () => {
    const db = await initDb()
    expect(db).toBeTruthy()
    expect(typeof db.run).toBe('function')
  })

  it('getLatestState returns defaults on empty db', async () => {
    await initDb()
    const state = getLatestState()
    expect(state.snapshot).toBeNull()
    expect(state.lastRefreshAt).toBeNull()
    expect(state.lastSuccessfulRefreshAt).toBeNull()
    expect(state.refreshInProgress).toBe(false)
    expect(state.isStale).toBe(true)
    expect(state.refreshState).toEqual({
      status: 'idle',
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      nextRunAt: null,
      lastError: null,
      durationMs: null,
      sourceHealth: {},
      runHistory: [],
    })
  })

  it('getLatestState can be called multiple times', async () => {
    await initDb()
    const state1 = getLatestState()
    const state2 = getLatestState()
    expect(state1).toEqual(state2)
  })

  it('persists structured refresh run state with capped history', async () => {
    await initDb()

    for (let i = 0; i < 12; i += 1) {
      setRefreshRunState({
        startedAt: `2026-06-15T10:${String(i).padStart(2, '0')}:00.000Z`,
        finishedAt: `2026-06-15T10:${String(i).padStart(2, '0')}:30.000Z`,
        durationMs: 30000,
        success: i % 2 === 0,
        partialData: i % 3 === 0,
        sources: ['github'],
        errorSummary: i % 2 === 0 ? null : 'GitHub collector failed',
        skipped: false,
        skippedReason: null,
      })
    }

    const runState = getRefreshRunState()
    expect(runState.status).toBe('failed')
    expect(runState.runHistory).toHaveLength(10)
    expect(runState.lastFailureAt).toBe('2026-06-15T10:11:30.000Z')
    expect(runState.lastSuccessAt).toBe('2026-06-15T10:10:30.000Z')
    expect(runState.sourceHealth.github?.status).toBe('degraded')

    const latestState = getLatestState()
    expect(latestState.refreshState.runHistory).toHaveLength(10)
  })
})
