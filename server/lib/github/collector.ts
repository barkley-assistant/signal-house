import { createApiClient, type GitHubApiClient } from './client'
import { deriveAll } from './aggregates'
import { TtlCache } from '../../cache/index'
import { initDb, insertSnapshot, insertAggregate, getLatestSnapshot } from '../../db/client'
import type { GitHubCollectorConfig, CollectorResult, CollectorProgress } from './types'
import type { IssueMetric, PullRequestMetric, WorkflowRunMetric, RepositoryMetric, ErrorMetric } from '../../../types/metrics'
import type { MetricSnapshot } from '../../../types/snapshot'
import type { AggregateType } from '../../../types/aggregates'
import { randomUUID } from 'node:crypto'

type ProgressCallback = (progress: CollectorProgress) => void

function deriveCiStatus(
  prs: PullRequestMetric[],
  workflowRuns: WorkflowRunMetric[],
): PullRequestMetric[] {
  const runsBySha = new Map<string, WorkflowRunMetric[]>()
  for (const run of workflowRuns) {
    if (!run.headSha) continue
    const list = runsBySha.get(run.headSha) ?? []
    list.push(run)
    runsBySha.set(run.headSha, list)
  }

  return prs.map((pr) => {
    if (!pr.headSha) return { ...pr, ciStatus: null }

    const matchingRuns = runsBySha.get(pr.headSha) ?? []
    if (matchingRuns.length === 0) return { ...pr, ciStatus: null }

    const latestRun = matchingRuns
      .slice()
      .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime())[0]!

    let ciStatus: PullRequestMetric['ciStatus'] = null
    if (latestRun.status !== 'completed') {
      ciStatus = 'pending'
    } else if (latestRun.conclusion === 'success') {
      ciStatus = 'success'
    } else if (latestRun.conclusion === 'failure' || latestRun.conclusion === 'timed_out' || latestRun.conclusion === 'startup_failure') {
      ciStatus = 'failure'
    } else if (latestRun.conclusion === 'cancelled') {
      ciStatus = 'cancelled'
    }

    return { ...pr, ciStatus }
  })
}

export async function collectWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return []
  }

  const results = new Array<R>(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex += 1
      if (currentIndex >= items.length) {
        return
      }
      results[currentIndex] = await fn(items[currentIndex]!, currentIndex)
    }
  })

  await Promise.all(workers)
  return results
}

export function createCollector(config: GitHubCollectorConfig, onProgress?: ProgressCallback) {
  const baseUrl = config.baseUrl ?? 'https://api.github.com'
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/repos/${config.owner}/${config.repo}`
  const staleThresholdDays = config.staleThresholdDays ?? 14
  const lookbackDays = config.lookbackDays ?? 30

  const apiClient: GitHubApiClient = createApiClient({
    token: config.token,
    baseUrl: apiUrl,
  })

  const rawCache = new TtlCache<IssueMetric[] | PullRequestMetric[] | WorkflowRunMetric[]>(5 * 60 * 1000)

  function emit(stage: CollectorProgress['stage'], message: string) {
    onProgress?.({ stage, message })
  }

  async function collectIssues(): Promise<{ issues: IssueMetric[]; errors: string[] }> {
    const cached = rawCache.get('issues') as IssueMetric[] | undefined
    if (cached) return { issues: cached, errors: [] }

    try {
      emit('fetching', 'Fetching issues from GitHub...')
      const issues = await apiClient.fetchIssues()
      rawCache.set('issues', issues)
      return { issues, errors: [] }
    } catch (err) {
      const msg = `Failed to fetch issues: ${err instanceof Error ? err.message : String(err)}`
      return { issues: [], errors: [msg] }
    }
  }

  async function collectPullRequests(): Promise<{ prs: PullRequestMetric[]; errors: string[] }> {
    const cached = rawCache.get('pullRequests') as PullRequestMetric[] | undefined
    if (cached) return { prs: cached, errors: [] }

    try {
      emit('fetching', 'Fetching pull requests from GitHub...')
      const client = apiClient as GitHubApiClient & {
        fetchPullRequestsWithWarnings?: () => Promise<{ prs: PullRequestMetric[]; warnings: string[] }>
      }
      const enriched = client.fetchPullRequestsWithWarnings
        ? await client.fetchPullRequestsWithWarnings()
        : { prs: await apiClient.fetchPullRequests(), warnings: [] }
      const { prs, warnings } = enriched
      rawCache.set('pullRequests', prs)
      return { prs, errors: warnings }
    } catch (err) {
      const msg = `Failed to fetch pull requests: ${err instanceof Error ? err.message : String(err)}`
      return { prs: [], errors: [msg] }
    }
  }

  async function collectWorkflowRuns(): Promise<{ workflowRuns: WorkflowRunMetric[]; errors: string[] }> {
    const cached = rawCache.get('workflowRuns') as WorkflowRunMetric[] | undefined
    if (cached) return { workflowRuns: cached, errors: [] }

    try {
      emit('fetching', 'Fetching workflow runs from GitHub...')
      const workflowRuns = await apiClient.fetchWorkflowRuns()
      rawCache.set('workflowRuns', workflowRuns)
      return { workflowRuns, errors: [] }
    } catch (err) {
      const msg = `Failed to fetch workflow runs: ${err instanceof Error ? err.message : String(err)}`
      return { workflowRuns: [], errors: [msg] }
    }
  }

  async function collectRepository(): Promise<{ repo: RepositoryMetric | null; errors: string[] }> {
    try {
      emit('fetching', 'Fetching repository info from GitHub...')
      const repo = await apiClient.fetchRepository()
      return { repo, errors: [] }
    } catch (err) {
      const msg = `Failed to fetch repository: ${err instanceof Error ? err.message : String(err)}`
      return { repo: null, errors: [msg] }
    }
  }

  return {
    getApiClient(): GitHubApiClient {
      return apiClient
    },

    async collect(): Promise<CollectorResult> {
      const startTime = Date.now()
      emit('fetching', 'Starting GitHub data collection...')

      const allErrors: string[] = []
      const { issues, errors: issueErrors } = await collectIssues()
      allErrors.push(...issueErrors)

      const { prs, errors: prErrors } = await collectPullRequests()
      allErrors.push(...prErrors)

      const { workflowRuns, errors: workflowRunErrors } = await collectWorkflowRuns()
      allErrors.push(...workflowRunErrors)

      const { repo, errors: repoErrors } = await collectRepository()
      allErrors.push(...repoErrors)

      emit('deriving', 'Computing aggregate signals...')

      const prsWithCi = deriveCiStatus(prs, workflowRuns)

      const deriveConfig = { staleThresholdDays, lookbackDays }
      const aggregates = deriveAll(issues, prsWithCi, workflowRuns, deriveConfig)

      const captureTime = new Date()
      const capturedAt = captureTime.toISOString()
      const snapshotId = randomUUID()

      const errorMetrics: ErrorMetric[] = allErrors.map((msg, i) => ({
        id: `err-${snapshotId}-${i}`,
        source: 'github-collector',
        level: 'error' as const,
        message: msg,
        timestamp: capturedAt,
        stackTrace: null,
        metadata: {},
      }))

      const partialData = allErrors.length > 0
      const snapshot: MetricSnapshot = {
        id: snapshotId,
        capturedAt,
        issues,
        pullRequests: prsWithCi,
        workflowRuns,
        repositories: repo ? [repo] : [],
        sessions: [],
        localGit: [],
        errors: errorMetrics,
        aggregates: {
          ...aggregates,
          computedAt: capturedAt,
        },
        metadata: {
          source: 'github',
          refreshDurationMs: Date.now() - startTime,
          partialData,
          errors: allErrors,
        },
      }

      if (!config.skipPersist) {
        emit('caching', 'Persisting snapshot to local cache...')
        try {
          await initDb()
          insertSnapshot(snapshot)

          const aggTypes: Array<{ type: AggregateType; data: unknown }> = [
            { type: 'throughput', data: aggregates.throughput },
            { type: 'cycleTime', data: aggregates.cycleTime },
            { type: 'ci', data: aggregates.ci },
            { type: 'staleWork', data: aggregates.staleWork },
          ]

          for (const { type, data } of aggTypes) {
            if (data !== null) {
              insertAggregate(
                `${type}-${capturedAt}`,
                type,
                aggregates.throughput.periodStart,
                aggregates.throughput.periodEnd,
                data,
                snapshotId,
              )
            }
          }
        } catch (err) {
          const msg = `Failed to cache snapshot: ${err instanceof Error ? err.message : String(err)}`
          allErrors.push(msg)
        }
      }

      emit('done', 'Collection complete.')

      return {
        snapshotId,
        capturedAt,
        issuesCount: issues.length,
        prsCount: prsWithCi.length,
        workflowRunsCount: workflowRuns.length,
        errors: allErrors,
        partialData,
        durationMs: Math.max(1, Date.now() - startTime),
        ...(config.skipPersist ? { snapshot } : {}),
      }
    },
  }
}

export type GitHubCollector = ReturnType<typeof createCollector>
