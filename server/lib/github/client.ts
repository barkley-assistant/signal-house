import type { IssueMetric, PullRequestMetric, WorkflowRunMetric, RepositoryMetric } from '../../../types/metrics'
import type {
  GHIssueRaw,
  GHPullRequestRaw,
  GHWorkflowRunRaw,
  GHWorkflowRaw,
  GHRepoRaw,
  PAClientOptions,
} from './types'

const DEFAULT_PER_PAGE = 100

export function createApiClient(opts: PAClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    Authorization: `Bearer ${opts.token}`,
    'User-Agent': 'signal-house/1.0',
  }
  const segments = baseUrl.split('/')
  const owner = segments.at(-2) ?? ''
  const repo = segments.at(-1) ?? ''
  const repoFullName = `${owner}/${repo}`
  const repoKey = `github:${repoFullName}`

  async function request<T>(path: string): Promise<{ data: T; headers: Headers }> {
    const url = `${baseUrl}${path}`
    const res = await fetch(url, { headers })

    if (res.status === 204) {
      return { data: undefined as T, headers: res.headers }
    }

    if (res.status === 403 || res.status === 429) {
      const resetEpoch = res.headers.get('X-RateLimit-Reset')
      if (resetEpoch) {
        const waitMs = Math.max(Number(resetEpoch) * 1000 - Date.now(), 0) + 1000
        await new Promise(r => setTimeout(r, waitMs))
        return request<T>(path)
      }
      const retryAfter = res.headers.get('Retry-After')
      if (retryAfter) {
        await new Promise(r => setTimeout(r, Number(retryAfter) * 1000))
        return request<T>(path)
      }
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`)
    }

    const data = await res.json() as T
    return { data, headers: res.headers }
  }

  async function paginate<T>(path: string): Promise<T[]> {
    const allItems: T[] = []
    let page = 1
    let hasMore = true

    while (hasMore) {
      const pagePath = `${path}${path.includes('?') ? '&' : '?'}per_page=${DEFAULT_PER_PAGE}&page=${page}`
      const { data, headers } = await request<T[]>(pagePath)
      if (Array.isArray(data)) {
        allItems.push(...data)
      }
      const link = headers.get('Link')
      if (!link || !link.includes('rel="next"')) {
        hasMore = false
      } else {
        page++
      }
    }

    return allItems
  }

  async function fetchWorkflows(): Promise<Map<number, string>> {
    const workflows = new Map<number, string>()
    try {
      const { data } = await request<{ workflows: GHWorkflowRaw[] }>('/actions/workflows?per_page=100')
      for (const wf of data.workflows ?? []) {
        workflows.set(wf.id, wf.name)
      }
    } catch {
      // workflows endpoint is optional; continue with empty map
    }
    return workflows
  }

  async function fetchPullRequestDetail(number: number): Promise<GHPullRequestRaw> {
    const { data } = await request<GHPullRequestRaw>(`/pulls/${number}`)
    return data
  }

  function mapPullRequest(item: GHPullRequestRaw): PullRequestMetric {
    let state: PullRequestMetric['state'] = 'open'
    if (item.merged_at ?? item.merged) {
      state = 'merged'
    } else if (item.state === 'closed') {
      state = 'closed'
    }

    return {
      id: String(item.number),
      title: item.title,
      state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      headSha: item.head_sha ?? item.head?.sha ?? null,
      mergedAt: item.merged_at,
      closedAt: item.closed_at,
      repo: repoFullName,
      repoKey,
      author: item.user.login,
      labels: (item.labels ?? []).map(l => l.name),
      additions: item.additions,
      deletions: item.deletions,
      changedFiles: item.changed_files,
      url: item.html_url,
      ciStatus: null,
    }
  }

  return {
    async fetchIssues(): Promise<IssueMetric[]> {
      const raw = await paginate<GHIssueRaw>('/issues?state=all&filter=all&direction=desc')
      const issues: IssueMetric[] = []
      for (const item of raw) {
        if (item.pull_request) continue
        issues.push({
          id: String(item.number),
          title: item.title,
          state: item.state,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          closedAt: item.closed_at,
          repo: repoFullName,
          repoKey,
          labels: (item.labels ?? []).map(l => l.name),
          assignee: item.assignee?.login ?? null,
          milestone: item.milestone?.title ?? null,
          url: item.html_url,
        })
      }
      return issues
    },

    async fetchPullRequests(): Promise<PullRequestMetric[]> {
      const { prs } = await this.fetchPullRequestsWithWarnings()
      return prs
    },

    async fetchPullRequestsWithWarnings(): Promise<{ prs: PullRequestMetric[]; warnings: string[] }> {
      const raw = await paginate<GHPullRequestRaw>('/pulls?state=all&direction=desc&sort=updated')
      const prs: PullRequestMetric[] = []
      const warnings: string[] = []
      for (const item of raw) {
        const mapped = mapPullRequest(item)

        if (mapped.state === 'open' || mapped.state === 'merged') {
          try {
            const detail = await fetchPullRequestDetail(item.number)
            prs.push(mapPullRequest(detail))
            continue
          } catch (err) {
            warnings.push(
              `Failed to enrich pull request #${item.number}: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }

        prs.push({
          ...mapped,
          additions: null,
          deletions: null,
          changedFiles: null,
        })
      }
      return { prs, warnings }
    },

    async fetchWorkflowRuns(): Promise<WorkflowRunMetric[]> {
      const workflowNames = await fetchWorkflows()
      const raw = await paginate<GHWorkflowRunRaw>('/actions/runs?status=all&per_page=100')
      const runs: WorkflowRunMetric[] = []
      for (const item of raw) {
        runs.push({
          id: String(item.id),
          name: item.name,
          status: item.status,
          conclusion: item.conclusion,
          createdAt: item.created_at,
          completedAt: item.status === 'completed' ? item.updated_at : null,
          repo: repoFullName,
          repoKey,
          branch: item.head_branch,
          headSha: item.head_sha ?? null,
          workflowName: workflowNames.get(item.workflow_id) ?? `Workflow ${item.workflow_id}`,
          url: item.html_url,
        })
      }
      return runs
    },

    async fetchRepository(): Promise<RepositoryMetric> {
      const { data } = await request<GHRepoRaw>('')
      return {
        id: String(data.id),
        name: data.name,
        repoKey,
        localPath: null,
        remoteUrl: data.html_url,
        githubOwner: data.owner.login,
        githubRepo: data.name,
        source: 'github',
        owner: data.owner.login,
        description: data.description,
        defaultBranch: data.default_branch,
        isPrivate: data.private,
        updatedAt: data.updated_at,
        pushedAt: data.pushed_at,
        url: data.html_url,
      }
    },
  }
}

export type GitHubApiClient = ReturnType<typeof createApiClient>
