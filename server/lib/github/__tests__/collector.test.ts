import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import * as db from '../../../db/client'
import { createCollector } from '../collector'

function mockOkJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function rateLimitResponse(): Response {
  const resetEpoch = Math.floor(Date.now() / 1000) + 1
  return {
    ok: false,
    status: 403,
    headers: new Headers({
      'content-type': 'application/json',
      'x-ratelimit-reset': String(resetEpoch),
    }),
    json: () => Promise.resolve({ message: 'rate limit exceeded' }),
    text: () => Promise.resolve(JSON.stringify({ message: 'rate limit exceeded' })),
  } as unknown as Response
}

const mockIssues = [
  {
    number: 1, title: 'Bug', state: 'closed',
    created_at: '2025-01-05T00:00:00Z', updated_at: '2025-01-10T00:00:00Z',
    closed_at: '2025-01-10T00:00:00Z', html_url: '', labels: [], assignee: null,
    milestone: null,
  },
  {
    number: 2, title: 'Feature', state: 'open',
    created_at: '2025-01-15T00:00:00Z', updated_at: '2025-01-20T00:00:00Z',
    closed_at: null, html_url: '', labels: [], assignee: null,
    milestone: null,
  },
]

const mockPRs = [
  {
    number: 10, title: 'PR One', state: 'closed',
    created_at: '2025-01-05T00:00:00Z', updated_at: '2025-01-08T00:00:00Z',
    merged_at: '2025-01-08T00:00:00Z', closed_at: '2025-01-08T00:00:00Z',
    html_url: '', user: { login: 'alice' }, labels: [],
    additions: 50, deletions: 10, changed_files: 3,
    head: { ref: 'feat1', sha: 'a' }, merged: true,
    head_sha: 'a',
  },
]

const mockRuns = [
  {
    id: 100, name: 'test', status: 'completed', conclusion: 'success',
    created_at: '2025-01-06T00:00:00Z', updated_at: '2025-01-06T01:00:00Z',
    head_branch: 'main', html_url: '', run_started_at: '2025-01-06T00:00:00Z',
    head_sha: 'a',
    event: 'push', workflow_id: 1,
  },
]

const mockRepo = {
  id: 1, name: 'repo', owner: { login: 'test' },
  description: 'Test repo', default_branch: 'main',
  private: false, updated_at: '2025-01-20T00:00:00Z',
  pushed_at: '2025-01-20T00:00:00Z', html_url: '',
}

const mockWorkflows = { workflows: [{ id: 1, name: 'CI Pipeline' }] }

beforeEach(async () => {
  jest.restoreAllMocks()
  jest.spyOn(db, 'initDb').mockResolvedValue(undefined as never)
  jest.spyOn(db, 'insertSnapshot').mockImplementation(() => {})
  jest.spyOn(db, 'insertAggregate').mockImplementation(() => {})
  jest.spyOn(db, 'getLatestSnapshot').mockReturnValue(null)
})

describe('createCollector', () => {
  it('collects data and returns result with counts', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockOkJson(mockIssues))
      .mockResolvedValueOnce(mockOkJson(mockPRs))
      .mockResolvedValueOnce(mockOkJson(mockPRs[0]))
      .mockResolvedValueOnce(mockOkJson(mockWorkflows))
      .mockResolvedValueOnce(mockOkJson(mockRuns))
      .mockResolvedValueOnce(mockOkJson(mockRepo))

    const collector = createCollector({
      owner: 'test',
      repo: 'repo',
      token: 'ghp_test',
    })

    const result = await collector.collect()

    expect(result.snapshotId).toBeTruthy()
    expect(result.issuesCount).toBe(2)
    expect(result.prsCount).toBe(1)
    expect(result.workflowRunsCount).toBe(1)
    if (result.errors.length > 0) {
      console.error('Unexpected errors:', result.errors)
    }
    expect(result.errors).toHaveLength(0)
    expect(result.partialData).toBe(false)
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('handles partial failures and sets partialData flag', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockOkJson(mockIssues))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockOkJson(mockWorkflows))
      .mockResolvedValueOnce(mockOkJson(mockRuns))
      .mockResolvedValueOnce(mockOkJson(mockRepo))

    const collector = createCollector({
      owner: 'test',
      repo: 'repo',
      token: 'ghp_test',
    })

    const result = await collector.collect()

    expect(result.prsCount).toBe(0)
    expect(result.issuesCount).toBe(2)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.partialData).toBe(true)
  })

  it('warns when PR enrichment fails but keeps the list result', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockOkJson(mockIssues))
      .mockResolvedValueOnce(mockOkJson(mockPRs))
      .mockRejectedValueOnce(new Error('Detail fetch failed'))
      .mockResolvedValueOnce(mockOkJson(mockWorkflows))
      .mockResolvedValueOnce(mockOkJson(mockRuns))
      .mockResolvedValueOnce(mockOkJson(mockRepo))

    const collector = createCollector({
      owner: 'test',
      repo: 'repo',
      token: 'ghp_test',
      skipPersist: true,
    })

    const result = await collector.collect()

    expect(result.prsCount).toBe(1)
    expect(result.errors.some(error => error.includes('Failed to enrich pull request #10'))).toBe(true)
    expect(result.partialData).toBe(true)

    const snapshot = (result as { snapshot?: unknown }).snapshot as { pullRequests: Array<{ additions: unknown; deletions: unknown; changedFiles: unknown }> } | undefined
    expect(snapshot).toBeDefined()
    const pr = snapshot!.pullRequests[0]!
    expect(pr.additions).toBeNull()
    expect(pr.deletions).toBeNull()
    expect(pr.changedFiles).toBeNull()
  })

  it('handles rate limit retry', async () => {
    jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(mockOkJson(mockIssues))
      .mockResolvedValueOnce(mockOkJson(mockPRs))
      .mockResolvedValueOnce(mockOkJson(mockWorkflows))
      .mockResolvedValueOnce(mockOkJson(mockRuns))
      .mockResolvedValueOnce(mockOkJson(mockRepo))

    const collector = createCollector({
      owner: 'test',
      repo: 'repo',
      token: 'ghp_test',
    })

    const result = await collector.collect()
    expect(result.issuesCount).toBe(2)
  }, 15000)
})
