import { createApiClient, type GitHubApiClient } from './client'
import { deriveAll } from './aggregates'
import { TtlCache } from '../../cache/index'
import { initDb, insertSnapshot, insertAggregate, getLatestSnapshot } from '../../db/client'
import type { GitHubCollectorConfig, CollectorResult, CollectorProgress } from './types'
import type { IssueMetric, PullRequestMetric, CheckRunMetric, RepositoryMetric, ErrorMetric } from '../../../types/metrics'
import type { MetricSnapshot } from '../../../types/snapshot'
import type { AggregateType } from '../../../types/aggregates'
import { randomUUID } from 'node:crypto'

type ProgressCallback = (progress: CollectorProgress) => void

export function createCollector(config: GitHubCollectorConfig, onProgress?: ProgressCallback) {
  const baseUrl = config.baseUrl ?? 'https://api.github.com'
  const apiUrl = `${baseUrl.replace(/\/+$/, '')}/repos/${config.owner}/${config.repo}`
  const staleThresholdDays = config.staleThresholdDays ?? 14
  const lookbackDays = config.lookbackDays ?? 30

  const apiClient: GitHubApiClient = createApiClient({
    token: config.token,
    baseUrl: apiUrl,
  })

  const rawCache = new TtlCache<IssueMetric[] | PullRequestMetric[] | CheckRunMetric[]>(5 * 60 * 1000)

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
      const prs = await apiClient.fetchPullRequests()
      rawCache.set('pullRequests', prs)
      return { prs, errors: [] }
    } catch (err) {
      const msg = `Failed to fetch pull requests: ${err instanceof Error ? err.message : String(err)}`
      return { prs: [], errors: [msg] }
    }
  }

  async function collectCheckRuns(): Promise<{ checkRuns: CheckRunMetric[]; errors: string[] }> {
    const cached = rawCache.get('checkRuns') as CheckRunMetric[] | undefined
    if (cached) return { checkRuns: cached, errors: [] }

    try {
      emit('fetching', 'Fetching workflow runs from GitHub...')
      const checkRuns = await apiClient.fetchCheckRuns()
      rawCache.set('checkRuns', checkRuns)
      return { checkRuns, errors: [] }
    } catch (err) {
      const msg = `Failed to fetch check runs: ${err instanceof Error ? err.message : String(err)}`
      return { checkRuns: [], errors: [msg] }
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

      const { checkRuns, errors: checkRunErrors } = await collectCheckRuns()
      allErrors.push(...checkRunErrors)

      const { repo, errors: repoErrors } = await collectRepository()
      allErrors.push(...repoErrors)

      emit('deriving', 'Computing aggregate signals...')

      const deriveConfig = { staleThresholdDays, lookbackDays }
      const aggregates = deriveAll(issues, prs, checkRuns, deriveConfig)

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
        pullRequests: prs,
        checkRuns,
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
        prsCount: prs.length,
        checkRunsCount: checkRuns.length,
        errors: allErrors,
        partialData,
        durationMs: Date.now() - startTime,
        ...(config.skipPersist ? { snapshot } : {}),
      }
    },
  }
}

export type GitHubCollector = ReturnType<typeof createCollector>
