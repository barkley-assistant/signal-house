import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { upsertDailyTokenUsage, initDb } from '../../db/client'
import { parseTokenUsage } from '../opencode/collector'
import type { DailyTokenUsageInsert } from '../../../types/daily-token-usage'

export interface DailyTokenUsageCollectorResult {
  success: boolean
  date: string
  row: DailyTokenUsageInsert | null
  errors: string[]
}

function isCommandNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT' || e.code === 'EACCES') return true
    const msg = e.message
    if (msg.includes('ENOENT') || msg.includes('EACCES') || msg.includes('not found') || msg.includes('127')) return true
  }
  return false
}

function findOpendencodeBinary(): string | null {
  const candidates: string[] = []
  if (process.env.OPENCODE_BIN) candidates.push(process.env.OPENCODE_BIN)
  candidates.push('opencode')
  candidates.push(path.join(os.homedir(), '.opencode/bin/opencode'))
  candidates.push('/home/openclaw/.opencode/bin/opencode')
  if (process.env.OPENCODE_COMMAND) candidates.push(process.env.OPENCODE_COMMAND)
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
      return cmd
    } catch {
      continue
    }
  }
  return null
}

export async function collectAndStoreDailyTokenUsage(targetDate?: string): Promise<DailyTokenUsageCollectorResult> {
  const errors: string[] = []

  let date: string
  if (targetDate) {
    date = targetDate
  } else {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    date = yesterday.toISOString().slice(0, 10)
  }

  const binary = findOpendencodeBinary()
  if (!binary) {
    errors.push('OpenCode binary not found')
    return { success: false, date, row: null, errors }
  }

  try {
    const stdout = execFileSync(binary, ['stats', '--days', '1', '--models'], { timeout: 15000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
    const parsed = parseTokenUsage(stdout)

    const row: DailyTokenUsageInsert = {
      date,
      totalSessions: parsed.totalSessions,
      totalMessages: parsed.totalMessages,
      totalTokens: parsed.totalTokens,
      totalCost: parsed.totalCost,
      modelUsage: parsed.modelUsage,
      rawJson: parsed.rawJson,
    }

    await initDb()
    upsertDailyTokenUsage(row)

    return { success: true, date, row, errors: [] }
  } catch (err) {
    errors.push(`Daily token usage collector failed: ${err instanceof Error ? err.message : String(err)}`)
    return { success: false, date, row: null, errors }
  }
}
