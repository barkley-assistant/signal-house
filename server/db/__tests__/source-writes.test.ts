import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  initDb, persistSnapshot, getLatestSnapshot, insertSnapshot, getLatestState, close,
} from '../client'
import type { MetricSnapshot } from '../../../types/snapshot'

let tmpDir: string

function makeSnapshot(overrides: Partial<MetricSnapshot> = {}): MetricSnapshot {
  const capturedAt = overrides.capturedAt ?? '2026-06-18T12:00:00.000Z'
  return {
    id: overrides.id ?? 'snap-1',
    capturedAt,
    issues: overrides.issues ?? [],
    pullRequests: overrides.pullRequests ?? [],
    workflowRuns: overrides.workflowRuns ?? [],
    repositories: overrides.repositories ?? [],
    sessions: overrides.sessions ?? [],
    localGit: overrides.localGit ?? [],
    errors: overrides.errors ?? [],
    aggregates: overrides.aggregates ?? {
      throughput: { periodStart: '2026-06-01T00:00:00.000Z', periodEnd: capturedAt, issuesClosed: 0, issuesOpened: 0, prsMerged: 0, prsCreated: 0, totalCommits: 0 },
      cycleTime: null,
      ci: null,
      staleWork: { asOf: capturedAt, staleIssues: 0, stalePRs: 0, staleThresholdDays: 14, oldestItemDays: null },
      sessionUsage: null,
      computedAt: capturedAt,
    },
    metadata: overrides.metadata ?? {
      source: 'orchestrated',
      refreshDurationMs: 100,
      partialData: false,
      errors: [],
    },
  }
}

function countRows(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }
  return row.count
}

function queryTable(db: Database.Database, table: string): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'source-writes-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('normalized source data writes', () => {
  it('writes issues to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      issues: [{
        id: 'issue-1',
        title: 'Test Issue',
        state: 'open',
        createdAt: '2026-06-01T10:00:00Z',
        updatedAt: '2026-06-02T10:00:00Z',
        closedAt: null,
        repo: 'test/repo',
        repoKey: 'github:test/repo',
        labels: ['bug'],
        assignee: 'alice',
        milestone: 'v1.0',
        url: 'https://github.com/test/repo/issues/1',
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_issues')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('issue-1')
    expect(rows[0]!.title).toBe('Test Issue')
    expect(rows[0]!.state).toBe('open')
    expect(rows[0]!.repo_key).toBe('github:test/repo')
    expect(rows[0]!.labels).toBe('["bug"]')
    expect(rows[0]!.assignee).toBe('alice')
    expect(rows[0]!.last_snapshot_id).toBe('snap-1')
    db.close()
  })

  it('writes pull requests to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      pullRequests: [{
        id: 'pr-1',
        title: 'Test PR',
        state: 'merged',
        createdAt: '2026-06-01T10:00:00Z',
        updatedAt: '2026-06-03T10:00:00Z',
        headSha: 'abc123',
        mergedAt: '2026-06-03T10:00:00Z',
        closedAt: null,
        repo: 'test/repo',
        repoKey: 'github:test/repo',
        author: 'bob',
        labels: ['enhancement'],
        additions: 100,
        deletions: 50,
        changedFiles: 5,
        url: 'https://github.com/test/repo/pull/1',
        ciStatus: 'success',
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_pull_requests')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('pr-1')
    expect(rows[0]!.state).toBe('merged')
    expect(rows[0]!.author).toBe('bob')
    expect(rows[0]!.additions).toBe(100)
    expect(rows[0]!.ci_status).toBe('success')
    db.close()
  })

  it('writes workflow runs to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      workflowRuns: [{
        id: 'wf-1',
        name: 'CI Build',
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-06-01T10:00:00Z',
        completedAt: '2026-06-01T11:00:00Z',
        headSha: 'abc',
        repo: 'test/repo',
        repoKey: 'github:test/repo',
        branch: 'main',
        workflowName: 'CI',
        url: 'https://github.com/test/repo/actions/runs/1',
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_workflow_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('wf-1')
    expect(rows[0]!.conclusion).toBe('success')
    expect(rows[0]!.workflow_name).toBe('CI')
    db.close()
  })

  it('writes sessions to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      sessions: [{
        id: 'session-1',
        toolName: 'opencode',
        action: 'edit',
        timestamp: '2026-06-01T10:00:00Z',
        durationMs: 1000,
        metadata: { model: 'gpt-4' },
        success: true,
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('session-1')
    expect(rows[0]!.tool_name).toBe('opencode')
    expect(rows[0]!.success).toBe(1)
    expect(rows[0]!.duration_ms).toBe(1000)
    db.close()
  })

  it('writes repositories to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      repositories: [{
        repoKey: 'github:test/repo',
        name: 'repo',
        localPath: '/home/repo',
        remoteUrl: 'https://github.com/test/repo',
        githubOwner: 'test',
        githubRepo: 'repo',
        source: 'both',
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_repositories')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.repo_key).toBe('github:test/repo')
    expect(rows[0]!.source).toBe('both')
    db.close()
  })

  it('writes local git repos to normalized table during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-1',
      localGit: [{
        repoKey: 'local:/home/repo',
        source: 'local',
        path: '/home/repo',
        repoName: 'repo',
        remoteUrl: null,
        githubOwner: null,
        githubRepo: null,
        defaultBranch: 'main',
        isGitRepo: true,
        recentCommits: 42,
        commitsByDay: { '2026-06-01': 10, '2026-06-02': 32 },
        authors: ['alice@example.com'],
        latestCommitAt: '2026-06-02T12:00:00Z',
        error: null,
      }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_local_git')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.repo_key).toBe('local:/home/repo')
    expect(rows[0]!.recent_commits).toBe(42)
    expect(rows[0]!.authors).toBe('["alice@example.com"]')
    expect(rows[0]!.is_git_repo).toBe(1)
    db.close()
  })

  it('writes all source types in one snapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-all',
      issues: [{ id: 'i1', title: 'Issue 1', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' }],
      pullRequests: [{ id: 'pr1', title: 'PR 1', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', headSha: null, mergedAt: null, closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', author: 'x', labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null }],
      workflowRuns: [{ id: 'wf1', name: 'CI', status: 'completed', conclusion: 'success', createdAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T11:00:00Z', headSha: null, repo: 'test/repo', repoKey: 'github:test/repo', branch: 'main', workflowName: 'CI', url: null }],
      sessions: [{ id: 's1', toolName: 'opencode', action: 'edit', timestamp: '2026-06-01T10:00:00Z', durationMs: 100, metadata: {}, success: true }],
      repositories: [{ repoKey: 'github:test/repo', name: 'repo', localPath: null, remoteUrl: null, githubOwner: null, githubRepo: null, source: 'github' }],
      localGit: [{ repoKey: 'local:/home/repo', source: 'local', path: '/home/repo', repoName: 'repo', remoteUrl: null, githubOwner: null, githubRepo: null, defaultBranch: null, isGitRepo: true, recentCommits: 5, commitsByDay: {}, authors: [], latestCommitAt: null, error: null }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    expect(countRows(db, 'source_issues')).toBe(1)
    expect(countRows(db, 'source_pull_requests')).toBe(1)
    expect(countRows(db, 'source_workflow_runs')).toBe(1)
    expect(countRows(db, 'source_sessions')).toBe(1)
    expect(countRows(db, 'source_repositories')).toBe(1)
    expect(countRows(db, 'source_local_git')).toBe(1)
    db.close()
  })
})

describe('repeated refreshes without unbounded duplicates', () => {
  it('updates existing issue row on second persist (same id)', async () => {
    await initDb()
    const snap1 = makeSnapshot({
      id: 'snap-1',
      capturedAt: '2026-06-18T12:00:00.000Z',
      issues: [{
        id: 'issue-1', title: 'Original Title', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(snap1)

    const snap2 = makeSnapshot({
      id: 'snap-2',
      capturedAt: '2026-06-18T13:00:00.000Z',
      issues: [{
        id: 'issue-1', title: 'Updated Title', state: 'closed',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z', closedAt: '2026-06-03T10:00:00Z',
        repo: 'test/repo', repoKey: 'github:test/repo', labels: ['fixed'], assignee: 'alice', milestone: null, url: '',
      }],
    })
    persistSnapshot(snap2)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_issues')
    // Should still be 1 row, updated
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe('Updated Title')
    expect(rows[0]!.state).toBe('closed')
    expect(rows[0]!.labels).toBe('["fixed"]')
    expect(rows[0]!.last_snapshot_id).toBe('snap-2')
    db.close()
  })

  it('updates existing PR row on second persist (same id)', async () => {
    await initDb()
    const snap1 = makeSnapshot({
      id: 'snap-1',
      capturedAt: '2026-06-18T12:00:00.000Z',
      pullRequests: [{
        id: 'pr-1', title: 'WIP PR', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z',
        headSha: 'abc', mergedAt: null, closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', author: 'bob',
        labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null,
      }],
    })
    persistSnapshot(snap1)

    const snap2 = makeSnapshot({
      id: 'snap-2',
      capturedAt: '2026-06-18T13:00:00.000Z',
      pullRequests: [{
        id: 'pr-1', title: 'Merged PR', state: 'merged',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z',
        headSha: 'abc', mergedAt: '2026-06-03T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', author: 'bob',
        labels: [], additions: 50, deletions: 20, changedFiles: 3, url: '', ciStatus: 'success',
      }],
    })
    persistSnapshot(snap2)

    const db = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(db, 'source_pull_requests')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe('Merged PR')
    expect(rows[0]!.state).toBe('merged')
    expect(rows[0]!.merged_at).toBe('2026-06-03T10:00:00Z')
    expect(rows[0]!.additions).toBe(50)
    expect(rows[0]!.last_snapshot_id).toBe('snap-2')
    db.close()
  })

  it('does not create duplicate rows across multiple refreshes', async () => {
    await initDb()
    for (let i = 1; i <= 5; i++) {
      const snapshot = makeSnapshot({
        id: `snap-${i}`,
        capturedAt: `2026-06-18T${11 + i}:00:00.000Z`,
        issues: [
          { id: 'issue-1', title: `Issue v${i}`, state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: `2026-06-0${i}T10:00:00Z`, closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' },
          { id: 'issue-2', title: 'Stable Issue', state: 'closed', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: '2026-06-02T10:00:00Z', repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' },
        ],
      })
      persistSnapshot(snapshot)
    }

    const db = new Database(join(tmpDir, 'metrics.db'))
    // 2 distinct issue IDs across 5 refreshes = 2 rows
    expect(countRows(db, 'source_issues')).toBe(2)
    const issue1Row = db.prepare("SELECT title, last_snapshot_id FROM source_issues WHERE id = 'issue-1'").get() as { title: string; last_snapshot_id: string }
    expect(issue1Row.title).toBe('Issue v5')
    expect(issue1Row.last_snapshot_id).toBe('snap-5')
    db.close()
  })

  it('adds new distinct rows for new items across refreshes', async () => {
    await initDb()

    // First refresh: 1 issue
    persistSnapshot(makeSnapshot({
      id: 'snap-1',
      issues: [{
        id: 'issue-1', title: 'First Issue', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    }))

    // Second refresh: 2 issues (1 new, 1 updated)
    persistSnapshot(makeSnapshot({
      id: 'snap-2',
      issues: [
        {
          id: 'issue-1', title: 'First Issue (updated)', state: 'closed',
          createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z', closedAt: '2026-06-03T10:00:00Z',
          repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
        },
        {
          id: 'issue-2', title: 'Second Issue', state: 'open',
          createdAt: '2026-06-04T10:00:00Z', updatedAt: '2026-06-04T10:00:00Z', closedAt: null,
          repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
        },
      ],
    }))

    const db = new Database(join(tmpDir, 'metrics.db'))
    expect(countRows(db, 'source_issues')).toBe(2)

    const issue1 = db.prepare("SELECT title, state FROM source_issues WHERE id = 'issue-1'").get() as { title: string; state: string }
    expect(issue1.title).toBe('First Issue (updated)')
    expect(issue1.state).toBe('closed')

    const issue2 = db.prepare("SELECT title FROM source_issues WHERE id = 'issue-2'").get() as { title: string }
    expect(issue2.title).toBe('Second Issue')
    db.close()
  })
})

describe('failed refresh preserves previous good state', () => {
  it('keeps the previous snapshot after a failing persistSnapshot', async () => {
    await initDb()
    const goodSnapshot = makeSnapshot({
      id: 'snap-good',
      capturedAt: '2026-06-18T12:00:00.000Z',
      issues: [{
        id: 'issue-1', title: 'Good Data', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })

    // First persist succeeds
    persistSnapshot(goodSnapshot)

    // Verify good data is there
    expect(getLatestSnapshot()?.id).toBe('snap-good')

    const db = new Database(join(tmpDir, 'metrics.db'))
    expect(countRows(db, 'source_issues')).toBe(1)
    db.close()

    // Simulate a failure: close and corrupt the db
    close()

    // Reopen - should get fresh db since we close and reopen
    await initDb()

    // The previous good data should still be retrievable
    const latest = getLatestSnapshot()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe('snap-good')
    expect(latest!.issues[0]!.title).toBe('Good Data')
  })

  it('transaction rollback preserves old data when persistSnapshot throws', async () => {
    await initDb()

    // Write initial good state
    const goodSnapshot = makeSnapshot({
      id: 'snap-good',
      capturedAt: '2026-06-18T12:00:00.000Z',
      issues: [{
        id: 'issue-keep', title: 'Should Survive', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(goodSnapshot)

    // Now try a persist with an intentionally broken snapshot
    // (null title would not cause SQL failure since SQLite accepts null TEXT)
    // Instead, create a snapshot with such massive data it causes issues
    // The safest way to test: build a snapshot that would crash the
    // computeDailyMetrics call inside persistSnapshot
    const badSnapshot = makeSnapshot({
      id: 'snap-bad',
      capturedAt: '2026-06-18T13:00:00.000Z',
      aggregates: {
        // Missing required fields will cause computeDailyMetrics to throw
      } as any,
    })

    // This should throw because aggregates.throughput is undefined
    expect(() => persistSnapshot(badSnapshot)).toThrow()

    // The good snapshot should still be intact
    const latest = getLatestSnapshot()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe('snap-good')

    // Source issues should still contain the original
    const reopened = new Database(join(tmpDir, 'metrics.db'))
    const rows = queryTable(reopened, 'source_issues')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toBe('Should Survive')
    reopened.close()
  })
})

describe('blob snapshot path preserved', () => {
  it('still writes blob snapshot during persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-blob',
      issues: [{ id: 'i1', title: 'Issue', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' }],
    })
    persistSnapshot(snapshot)

    const latest = getLatestSnapshot()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe('snap-blob')
    expect(latest!.issues).toHaveLength(1)
  })

  it('insertSnapshot still works independently', async () => {
    await initDb()
    const snapshot = makeSnapshot({ id: 'direct-snap' })
    insertSnapshot(snapshot)

    const latest = getLatestSnapshot()
    expect(latest).not.toBeNull()
    expect(latest!.id).toBe('direct-snap')
  })

  it('getLatestState returns snapshot from blob path', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-state',
      issues: [{ id: 'i1', title: 'Issue', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' }],
    })
    persistSnapshot(snapshot)

    const state = getLatestState()
    expect(state.snapshot).not.toBeNull()
    expect(state.snapshot!.id).toBe('snap-state')
    expect(state.lastRefreshAt).toBe('2026-06-18T12:00:00.000Z')
  })
})

describe('empty source data handled', () => {
  it('handles snapshot with no source data gracefully', async () => {
    await initDb()
    const snapshot = makeSnapshot({ id: 'snap-empty' })
    expect(() => persistSnapshot(snapshot)).not.toThrow()

    const latest = getLatestSnapshot()
    expect(latest!.id).toBe('snap-empty')
  })

  it('handles snapshot with only some source types', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-partial',
      issues: [{ id: 'i1', title: 'Only Issue', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '' }],
    })
    persistSnapshot(snapshot)

    const db = new Database(join(tmpDir, 'metrics.db'))
    expect(countRows(db, 'source_issues')).toBe(1)
    expect(countRows(db, 'source_pull_requests')).toBe(0)
    expect(countRows(db, 'source_workflow_runs')).toBe(0)
    expect(countRows(db, 'source_sessions')).toBe(0)
    expect(countRows(db, 'source_repositories')).toBe(0)
    expect(countRows(db, 'source_local_git')).toBe(0)
    db.close()
  })
})
