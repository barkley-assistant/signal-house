import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import {
  initDb, persistSnapshot, getNormalizedSnapshot, hasNormalizedData,
  getLatestState, getLatestSnapshot, close, insertSnapshot,
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'normalized-reads-test-'))
  process.env['DB_DIR'] = tmpDir
})

afterEach(() => {
  close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('normalized read helpers', () => {
  it('hasNormalizedData returns false on empty database', async () => {
    await initDb()
    expect(hasNormalizedData('nonexistent')).toBe(false)
  })

  it('hasNormalizedData returns true after persistSnapshot', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-norm',
      issues: [{
        id: 'i1', title: 'Issue', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(snapshot)
    expect(hasNormalizedData('snap-norm')).toBe(true)
  })

  it('getNormalizedSnapshot returns null on empty database', async () => {
    await initDb()
    expect(getNormalizedSnapshot()).toBeNull()
  })

  it('getNormalizedSnapshot reconstructs a full snapshot from normalized rows', async () => {
    await initDb()
    const original = makeSnapshot({
      id: 'snap-full',
      capturedAt: '2026-06-18T12:00:00.000Z',
      issues: [{
        id: 'i1', title: 'Issue 1', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: ['bug'], assignee: 'alice', milestone: 'v1', url: 'https://example.com/1',
      }],
      pullRequests: [{
        id: 'pr1', title: 'PR 1', state: 'merged',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z',
        headSha: 'abc', mergedAt: '2026-06-03T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', author: 'bob',
        labels: [], additions: 10, deletions: 5, changedFiles: 2, url: 'https://example.com/pr/1', ciStatus: 'success',
      }],
      workflowRuns: [{
        id: 'wf1', name: 'CI', status: 'completed', conclusion: 'success',
        createdAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T11:00:00Z',
        headSha: 'abc', repo: 'test/repo', repoKey: 'github:test/repo',
        branch: 'main', workflowName: 'CI', url: 'https://example.com/run/1',
      }],
      sessions: [{
        id: 's1', toolName: 'opencode', action: 'edit',
        timestamp: '2026-06-01T10:00:00Z', durationMs: 1000,
        metadata: { model: 'gpt-4' }, success: true,
      }],
      repositories: [{
        repoKey: 'github:test/repo', name: 'repo',
        localPath: '/home/repo', remoteUrl: 'https://github.com/test/repo',
        githubOwner: 'test', githubRepo: 'repo', source: 'both',
      }],
      localGit: [{
        repoKey: 'local:/home/repo', source: 'local',
        path: '/home/repo', repoName: 'repo',
        remoteUrl: null, githubOwner: null, githubRepo: null,
        defaultBranch: 'main', isGitRepo: true, recentCommits: 42,
        commitsByDay: { '2026-06-01': 10 }, authors: ['alice@example.com'],
        latestCommitAt: '2026-06-02T12:00:00Z', error: null,
      }],
    })
    persistSnapshot(original)

    const reconstructed = getNormalizedSnapshot()
    expect(reconstructed).not.toBeNull()
    expect(reconstructed!.id).toBe('snap-full')
    expect(reconstructed!.capturedAt).toBe('2026-06-18T12:00:00.000Z')

    expect(reconstructed!.issues).toHaveLength(1)
    expect(reconstructed!.issues[0]!.title).toBe('Issue 1')
    expect(reconstructed!.issues[0]!.labels).toEqual(['bug'])
    expect(reconstructed!.issues[0]!.assignee).toBe('alice')

    expect(reconstructed!.pullRequests).toHaveLength(1)
    expect(reconstructed!.pullRequests[0]!.state).toBe('merged')
    expect(reconstructed!.pullRequests[0]!.additions).toBe(10)
    expect(reconstructed!.pullRequests[0]!.ciStatus).toBe('success')

    expect(reconstructed!.workflowRuns).toHaveLength(1)
    expect(reconstructed!.workflowRuns[0]!.conclusion).toBe('success')

    expect(reconstructed!.sessions).toHaveLength(1)
    expect(reconstructed!.sessions[0]!.toolName).toBe('opencode')
    expect(reconstructed!.sessions[0]!.success).toBe(true)

    expect(reconstructed!.repositories).toHaveLength(1)
    expect(reconstructed!.repositories[0]!.source).toBe('both')

    expect(reconstructed!.localGit).toHaveLength(1)
    expect(reconstructed!.localGit[0]!.recentCommits).toBe(42)
    expect(reconstructed!.localGit[0]!.authors).toEqual(['alice@example.com'])
  })

  it('getNormalizedSnapshot reconstructs aggregates from the aggregates table', async () => {
    await initDb()
    const original = makeSnapshot({
      id: 'snap-agg',
      aggregates: {
        throughput: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-18T12:00:00Z', issuesClosed: 5, issuesOpened: 10, prsMerged: 3, prsCreated: 7, totalCommits: 20 },
        cycleTime: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-18T12:00:00Z', averageDays: 2.5, medianDays: 2, p95Days: 5, sampleSize: 3 },
        ci: { periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-18T12:00:00Z', totalRuns: 10, passCount: 8, failCount: 2, passRate: 0.8, averageDurationMs: 1200 },
        staleWork: { asOf: '2026-06-18T12:00:00Z', staleIssues: 2, stalePRs: 1, staleThresholdDays: 14, oldestItemDays: 30 },
        sessionUsage: {
          periodStart: '2026-06-01T00:00:00Z', periodEnd: '2026-06-18T12:00:00Z',
          totalSessions: 5, startedSessions: 5, completedSessions: 4, erroredSessions: 1, stuckSessions: 0,
          lastActivityAt: '2026-06-18T11:00:00Z', messages: 20, activeDays: 3,
          totalCost: 10, averageCostPerDay: 3.33, averageTokensPerSession: 100, medianTokensPerSession: 80,
          inputTokens: 60, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 10,
          uniqueTools: ['edit'], toolUsage: [{ toolName: 'edit', count: 5, percentage: 100 }],
          topActions: [{ action: 'edit', count: 5 }], errorCount: 1,
        },
        computedAt: '2026-06-18T12:00:00Z',
      },
    })
    persistSnapshot(original)

    const reconstructed = getNormalizedSnapshot()
    expect(reconstructed).not.toBeNull()
    expect(reconstructed!.aggregates.throughput.issuesClosed).toBe(5)
    expect(reconstructed!.aggregates.throughput.totalCommits).toBe(20)
    expect(reconstructed!.aggregates.cycleTime).not.toBeNull()
    expect(reconstructed!.aggregates.cycleTime!.averageDays).toBe(2.5)
    expect(reconstructed!.aggregates.ci).not.toBeNull()
    expect(reconstructed!.aggregates.ci!.passRate).toBe(0.8)
    expect(reconstructed!.aggregates.staleWork.staleIssues).toBe(2)
    expect(reconstructed!.aggregates.sessionUsage).not.toBeNull()
    expect(reconstructed!.aggregates.sessionUsage!.totalSessions).toBe(5)
  })
})

describe('getLatestState prefers normalized snapshot', () => {
  it('returns normalized snapshot when both blob and normalized exist', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-both',
      issues: [{
        id: 'i1', title: 'Normalized Issue', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(snapshot)

    const state = getLatestState()
    expect(state.snapshot).not.toBeNull()
    expect(state.snapshot!.id).toBe('snap-both')
    expect(state.snapshot!.issues).toHaveLength(1)
    expect(state.snapshot!.issues[0]!.title).toBe('Normalized Issue')
  })

  it('falls back to blob snapshot when normalized data is missing', async () => {
    await initDb()
    const snapshot = makeSnapshot({ id: 'snap-blob-only' })
    insertSnapshot(snapshot)

    const state = getLatestState()
    expect(state.snapshot).not.toBeNull()
    expect(state.snapshot!.id).toBe('snap-blob-only')
  })

  it('returns null snapshot when neither normalized nor blob exist', async () => {
    await initDb()
    const state = getLatestState()
    expect(state.snapshot).toBeNull()
  })
})

describe('response shape parity between normalized and blob paths', () => {
  it('normalized snapshot produces same issues/PRs/workflowRuns as blob', async () => {
    await initDb()
    const original = makeSnapshot({
      id: 'snap-parity',
      issues: [
        { id: 'i1', title: 'Issue 1', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', labels: ['bug'], assignee: null, milestone: null, url: '' },
        { id: 'i2', title: 'Issue 2', state: 'closed', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z', closedAt: '2026-06-03T10:00:00Z', repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: 'alice', milestone: null, url: '' },
      ],
      pullRequests: [
        { id: 'pr1', title: 'PR 1', state: 'merged', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-03T10:00:00Z', headSha: 'abc', mergedAt: '2026-06-03T10:00:00Z', closedAt: null, repo: 'test/repo', repoKey: 'github:test/repo', author: 'bob', labels: [], additions: 10, deletions: 5, changedFiles: 2, url: '', ciStatus: 'success' },
      ],
      workflowRuns: [
        { id: 'wf1', name: 'CI', status: 'completed', conclusion: 'success', createdAt: '2026-06-01T10:00:00Z', completedAt: '2026-06-01T11:00:00Z', headSha: null, repo: 'test/repo', repoKey: 'github:test/repo', branch: 'main', workflowName: 'CI', url: null },
      ],
    })
    persistSnapshot(original)

    const blobSnapshot = getLatestSnapshot()
    const normalizedSnapshot = getNormalizedSnapshot()

    expect(normalizedSnapshot).not.toBeNull()
    expect(blobSnapshot).not.toBeNull()

    expect(normalizedSnapshot!.issues).toHaveLength(blobSnapshot!.issues.length)
    expect(normalizedSnapshot!.pullRequests).toHaveLength(blobSnapshot!.pullRequests.length)
    expect(normalizedSnapshot!.workflowRuns).toHaveLength(blobSnapshot!.workflowRuns.length)

    for (let i = 0; i < normalizedSnapshot!.issues.length; i++) {
      const norm = normalizedSnapshot!.issues[i]!
      const blob = blobSnapshot!.issues[i]!
      expect(norm.id).toBe(blob.id)
      expect(norm.title).toBe(blob.title)
      expect(norm.state).toBe(blob.state)
      expect(norm.repoKey).toBe(blob.repoKey)
      expect(norm.labels).toEqual(blob.labels)
    }

    for (let i = 0; i < normalizedSnapshot!.pullRequests.length; i++) {
      const norm = normalizedSnapshot!.pullRequests[i]!
      const blob = blobSnapshot!.pullRequests[i]!
      expect(norm.id).toBe(blob.id)
      expect(norm.state).toBe(blob.state)
      expect(norm.additions).toBe(blob.additions)
    }

    for (let i = 0; i < normalizedSnapshot!.workflowRuns.length; i++) {
      const norm = normalizedSnapshot!.workflowRuns[i]!
      const blob = blobSnapshot!.workflowRuns[i]!
      expect(norm.id).toBe(blob.id)
      expect(norm.conclusion).toBe(blob.conclusion)
    }
  })
})

describe('repo filtering on normalized data', () => {
  it('normalized snapshot supports filtering by repoKey', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-filter',
      issues: [
        { id: 'i1', title: 'Repo A issue', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null, repo: 'demo/repo-a', repoKey: 'github:demo/repo-a', labels: [], assignee: null, milestone: null, url: '' },
        { id: 'i2', title: 'Repo B issue', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null, repo: 'demo/repo-b', repoKey: 'github:demo/repo-b', labels: [], assignee: null, milestone: null, url: '' },
      ],
      pullRequests: [
        { id: 'pr1', title: 'Repo A PR', state: 'open', createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', headSha: null, mergedAt: null, closedAt: null, repo: 'demo/repo-a', repoKey: 'github:demo/repo-a', author: 'a', labels: [], additions: null, deletions: null, changedFiles: null, url: '', ciStatus: null },
      ],
    })
    persistSnapshot(snapshot)

    const normalized = getNormalizedSnapshot()!
    const repoAIssues = normalized.issues.filter(i => i.repoKey === 'github:demo/repo-a')
    const repoBIssues = normalized.issues.filter(i => i.repoKey === 'github:demo/repo-b')
    const repoAPrs = normalized.pullRequests.filter(pr => pr.repoKey === 'github:demo/repo-a')

    expect(repoAIssues).toHaveLength(1)
    expect(repoAIssues[0]!.title).toBe('Repo A issue')
    expect(repoBIssues).toHaveLength(1)
    expect(repoBIssues[0]!.title).toBe('Repo B issue')
    expect(repoAPrs).toHaveLength(1)
  })
})

describe('stale and refresh metadata preserved', () => {
  it('getLatestState preserves isStale and refresh metadata from normalized path', async () => {
    await initDb()
    const snapshot = makeSnapshot({
      id: 'snap-stale',
      capturedAt: '2026-06-18T12:00:00.000Z',
    })
    persistSnapshot(snapshot)

    const state = getLatestState()
    expect(state.lastRefreshAt).toBe('2026-06-18T12:00:00.000Z')
    expect(state.lastSuccessfulRefreshAt).toBe('2026-06-18T12:00:00.000Z')
    expect(state.refreshInProgress).toBe(false)
    expect(state.refreshState).toBeDefined()
    expect(state.refreshState.status).toBeDefined()
  })
})

describe('failed refresh preserves last good state via normalized path', () => {
  it('normalized data from a good persist survives after close/reopen', async () => {
    await initDb()
    const goodSnapshot = makeSnapshot({
      id: 'snap-good-norm',
      issues: [{
        id: 'i1', title: 'Good Normalized', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(goodSnapshot)

    close()
    await initDb()

    const normalized = getNormalizedSnapshot()
    expect(normalized).not.toBeNull()
    expect(normalized!.id).toBe('snap-good-norm')
    expect(normalized!.issues).toHaveLength(1)
    expect(normalized!.issues[0]!.title).toBe('Good Normalized')
  })

  it('transaction rollback preserves normalized data when persistSnapshot throws', async () => {
    await initDb()

    const goodSnapshot = makeSnapshot({
      id: 'snap-good-rollback',
      issues: [{
        id: 'i-survive', title: 'Survives Rollback', state: 'open',
        createdAt: '2026-06-01T10:00:00Z', updatedAt: '2026-06-02T10:00:00Z', closedAt: null,
        repo: 'test/repo', repoKey: 'github:test/repo', labels: [], assignee: null, milestone: null, url: '',
      }],
    })
    persistSnapshot(goodSnapshot)

    const badSnapshot = makeSnapshot({
      id: 'snap-bad-rollback',
      aggregates: {} as any,
    })

    expect(() => persistSnapshot(badSnapshot)).toThrow()

    const normalized = getNormalizedSnapshot()
    expect(normalized).not.toBeNull()
    expect(normalized!.id).toBe('snap-good-rollback')
    expect(normalized!.issues).toHaveLength(1)
    expect(normalized!.issues[0]!.title).toBe('Survives Rollback')
  })
})
