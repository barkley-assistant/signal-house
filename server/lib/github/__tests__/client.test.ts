import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { createApiClient } from '../client'

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}): void {
  const bodyStr = JSON.stringify(body)
  const resHeaders = new Headers({ 'content-type': 'application/json', ...headers })
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bodyStr, { status, headers: resHeaders }))
}

beforeEach(() => {
  jest.restoreAllMocks()
})

describe('createApiClient', () => {
  it('maps issues from GitHub API response', async () => {
    mockFetch(200, [
      {
        number: 42,
        title: 'Fix the thing',
        state: 'open',
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-06T00:00:00Z',
        closed_at: null,
        html_url: 'https://github.com/test/repo/issues/42',
        labels: [{ name: 'bug' }],
        assignee: { login: 'alice' },
        milestone: { title: 'v1.0' },
      },
      {
        number: 43,
        title: 'PR not issue',
        state: 'open',
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-06T00:00:00Z',
        closed_at: null,
        html_url: 'https://github.com/test/repo/pull/43',
        labels: [],
        assignee: null,
        milestone: null,
        pull_request: {},
      },
    ])

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const issues = await client.fetchIssues()

    expect(issues).toHaveLength(1)
    expect(issues[0]!.id).toBe('42')
    expect(issues[0]!.state).toBe('open')
    expect(issues[0]!.labels).toEqual(['bug'])
    expect(issues[0]!.assignee).toBe('alice')
    expect(issues[0]!.milestone).toBe('v1.0')
    expect(issues[0]!.repo).toBe('test/repo')
  })

  it('maps pull requests from GitHub API response', async () => {
    mockFetch(200, [
      {
        number: 7,
        title: 'Add feature',
        state: 'closed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        merged_at: '2025-01-10T00:00:00Z',
        closed_at: '2025-01-10T00:00:00Z',
        html_url: 'https://github.com/test/repo/pull/7',
        user: { login: 'bob' },
        labels: [{ name: 'enhancement' }],
        additions: 100,
        deletions: 50,
        changed_files: 5,
        head: { ref: 'feature', sha: 'abc123' },
        head_sha: 'abc123',
        merged: false,
      },
    ])

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const prs = await client.fetchPullRequests()

    expect(prs).toHaveLength(1)
    expect(prs[0]!.state).toBe('merged')
    expect(prs[0]!.author).toBe('bob')
    expect(prs[0]!.additions).toBeNull()
    expect(prs[0]!.deletions).toBeNull()
    expect(prs[0]!.changedFiles).toBeNull()
    expect(prs[0]!.repo).toBe('test/repo')
  })

  it('treats merged_at as the source of truth for merged PRs', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          number: 8,
          title: 'Fix bug',
          state: 'closed',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-10T00:00:00Z',
          merged_at: '2025-01-10T00:00:00Z',
          closed_at: '2025-01-10T00:00:00Z',
          html_url: 'https://github.com/test/repo/pull/8',
          user: { login: 'carol' },
          labels: [],
          additions: 0,
          deletions: 0,
          changed_files: 0,
          head: { ref: 'fix', sha: 'def456' },
          head_sha: 'def456',
          merged: false,
        },
      ]), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        number: 8,
        title: 'Fix bug',
        state: 'closed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        merged_at: '2025-01-10T00:00:00Z',
        closed_at: '2025-01-10T00:00:00Z',
        html_url: 'https://github.com/test/repo/pull/8',
        user: { login: 'carol' },
        labels: [],
        additions: 12,
        deletions: 3,
        changed_files: 2,
        head: { ref: 'fix', sha: 'def456' },
        head_sha: 'def456',
        merged: false,
      }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const prs = await client.fetchPullRequests()

    expect(prs).toHaveLength(1)
    expect(prs[0]!.state).toBe('merged')
    expect(prs[0]!.additions).toBe(12)
    expect(prs[0]!.deletions).toBe(3)
    expect(prs[0]!.changedFiles).toBe(2)
  })

  it('classifies PR with merged boolean when merged_at is null', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          number: 9,
          title: 'Merged via boolean',
          state: 'closed',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-10T00:00:00Z',
          merged_at: null,
          closed_at: '2025-01-10T00:00:00Z',
          html_url: '',
          user: { login: 'dave' },
          labels: [],
          additions: 0,
          deletions: 0,
          changed_files: 0,
          head: { ref: 'b', sha: 'xyz' },
          head_sha: 'xyz',
          merged: true,
        },
      ]), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        number: 9,
        title: 'Merged via boolean',
        state: 'closed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-10T00:00:00Z',
        merged_at: '2025-01-10T00:00:00Z',
        closed_at: '2025-01-10T00:00:00Z',
        html_url: '',
        user: { login: 'dave' },
        labels: [],
        additions: 30,
        deletions: 5,
        changed_files: 2,
        head: { ref: 'b', sha: 'xyz' },
        head_sha: 'xyz',
        merged: true,
      }), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const prs = await client.fetchPullRequests()

    expect(prs).toHaveLength(1)
    expect(prs[0]!.state).toBe('merged')
    expect(prs[0]!.mergedAt).toBe('2025-01-10T00:00:00Z')
    expect(prs[0]!.additions).toBe(30)
    expect(prs[0]!.deletions).toBe(5)
    expect(prs[0]!.changedFiles).toBe(2)
  })

  it('closed-unmerged PR has null size fields from list endpoint', async () => {
    mockFetch(200, [
      {
        number: 10,
        title: 'Closed unmerged',
        state: 'closed',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-05T00:00:00Z',
        merged_at: null,
        closed_at: '2025-01-05T00:00:00Z',
        html_url: '',
        user: { login: 'eve' },
        labels: [],
        additions: 0,
        deletions: 0,
        changed_files: 0,
        head: { ref: 'c', sha: 'zzz' },
        head_sha: 'zzz',
        merged: false,
      },
    ])

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const prs = await client.fetchPullRequests()

    expect(prs).toHaveLength(1)
    expect(prs[0]!.state).toBe('closed')
    expect(prs[0]!.additions).toBeNull()
    expect(prs[0]!.deletions).toBeNull()
    expect(prs[0]!.changedFiles).toBeNull()
  })

  it('maps workflow runs from GitHub API response', async () => {
    let callCount = 0
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(() => {
      callCount++
      const body = callCount === 1
        ? { workflows: [{ id: 1, name: 'CI Pipeline' }] }
        : [
            {
              id: 100, name: 'test', status: 'completed', conclusion: 'success',
              created_at: '2025-01-06T00:00:00Z', updated_at: '2025-01-06T01:00:00Z',
              head_branch: 'main', html_url: '', run_started_at: '2025-01-06T00:00:00Z',
              head_sha: 'abc123',
              event: 'push', workflow_id: 1,
            },
            {
              id: 101, name: 'lint', status: 'completed', conclusion: 'failure',
              created_at: '2025-01-07T00:00:00Z', updated_at: '2025-01-07T02:00:00Z',
              head_branch: 'feat', html_url: '', run_started_at: '2025-01-07T00:00:00Z',
              head_sha: 'def456',
              event: 'pull_request', workflow_id: 1,
            },
          ]
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }))
    })

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const runs = await client.fetchWorkflowRuns()

    expect(runs).toHaveLength(2)
    expect(runs[0]!.id).toBe('100')
    expect(runs[0]!.conclusion).toBe('success')
    expect(runs[0]!.status).toBe('completed')
    expect(runs[0]!.completedAt).toBe('2025-01-06T01:00:00Z')
    expect(runs[0]!.workflowName).toBe('CI Pipeline')
    expect(runs[0]!.branch).toBe('main')
    expect(runs[1]!.conclusion).toBe('failure')
    expect(runs[1]!.branch).toBe('feat')
  })

  it('maps in-progress workflow runs without completedAt', async () => {
    let callCount = 0
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation(() => {
      callCount++
      const body = callCount === 1
        ? { workflows: [] }
        : [
            {
              id: 200, name: 'test', status: 'in_progress', conclusion: null,
              created_at: '2025-01-06T00:00:00Z', updated_at: '2025-01-06T01:00:00Z',
              head_branch: 'main', html_url: '', run_started_at: '2025-01-06T00:00:00Z',
              head_sha: 'abc123',
              event: 'push', workflow_id: 99,
            },
          ]
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }))
    })

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const runs = await client.fetchWorkflowRuns()

    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('in_progress')
    expect(runs[0]!.conclusion).toBeNull()
    expect(runs[0]!.completedAt).toBeNull()
  })

  it('fetchWorkflowRuns falls back to Workflow id when workflow fetch fails', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        {
          id: 300, name: 'test', status: 'completed', conclusion: 'success',
          created_at: '2025-01-06T00:00:00Z', updated_at: '2025-01-06T01:00:00Z',
          head_branch: 'main', html_url: '', run_started_at: '2025-01-06T00:00:00Z',
          head_sha: 'abc123',
          event: 'push', workflow_id: 42,
        },
      ]), { status: 200, headers: new Headers({ 'content-type': 'application/json' }) }))

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const runs = await client.fetchWorkflowRuns()

    expect(runs).toHaveLength(1)
    expect(runs[0]!.workflowName).toBe('Workflow 42')
  })

  it('handles API errors gracefully', async () => {
    mockFetch(500, { message: 'Internal Server Error' })
    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    await expect(client.fetchIssues()).rejects.toThrow('GitHub API 500')
  })

  it('paginates with Link header', async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      state: 'open' as const,
      created_at: '2025-01-05T00:00:00Z',
      updated_at: '2025-01-06T00:00:00Z',
      closed_at: null,
      html_url: '',
      labels: [],
      assignee: null,
      milestone: null,
    }))
    const page2 = [
      {
        number: 3,
        title: 'Issue 3',
        state: 'open' as const,
        created_at: '2025-01-05T00:00:00Z',
        updated_at: '2025-01-06T00:00:00Z',
        closed_at: null,
        html_url: '',
        labels: [],
        assignee: null,
        milestone: null,
      },
    ]

    const fetchSpy = jest.spyOn(globalThis, 'fetch')
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page1), {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
            link: '<https://api.github.com/repos/test/repo/issues?page=2>; rel="next"',
          }),
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(page2), {
          status: 200,
          headers: new Headers({
            'content-type': 'application/json',
            link: '',
          }),
        }),
      )

    const client = createApiClient({ token: 'tok', baseUrl: 'https://api.github.com/repos/test/repo' })
    const issues = await client.fetchIssues()
    expect(issues).toHaveLength(3)
  })
})
