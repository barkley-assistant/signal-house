import { createCollector as createGitHubCollector } from '../github/collector'
import { createLocalGitCollector } from '../git/collector'
import { createSessionCollector } from '../sessions/collector'
import { initDb, insertSnapshot, insertAggregate, getLatestSnapshot, upsertDailyMetrics } from '../../db/client'
import { computeDailyMetrics } from '../daily-metrics'
import { randomUUID } from 'node:crypto'
import type { GitHubCollectorConfig } from '../github/types'
import type { LocalGitCollectorConfig, LocalGitRepoInfo } from '../git/types'
import type { SessionCollectorConfig } from '../sessions/types'
import type { OrchestratorConfig, OrchestratorResult } from './types'
import type { MetricSnapshot } from '../../../types/snapshot'
import type { DashboardAggregates, AggregateType } from '../../../types/aggregates'
import type {
  IssueMetric,
  PullRequestMetric,
  CheckRunMetric,
  RepositoryIdentity,
  RepositoryMetric,
  SessionMetric,
  LocalGitRepoMetric,
  ErrorMetric,
} from '../../../types/metrics'

function mergeSource(a: RepositoryIdentity['source'], b: RepositoryIdentity['source']): RepositoryIdentity['source'] {
  if (a === b) return a
  return 'both'
}

function mergeIdentity(existing: RepositoryIdentity | undefined, next: RepositoryIdentity): RepositoryIdentity {
  if (!existing) return next
  return {
    repoKey: existing.repoKey,
    name: existing.name || next.name,
    localPath: existing.localPath ?? next.localPath,
    remoteUrl: existing.remoteUrl ?? next.remoteUrl,
    githubOwner: existing.githubOwner ?? next.githubOwner,
    githubRepo: existing.githubRepo ?? next.githubRepo,
    source: mergeSource(existing.source, next.source),
  }
}

function toLocalGitRepoMetric(info: LocalGitRepoInfo): LocalGitRepoMetric {
  return {
    repoKey: info.repoKey,
    source: info.source,
    path: info.path,
    repoName: info.repoName,
    remoteUrl: info.remoteUrl,
    githubOwner: info.githubOwner,
    githubRepo: info.githubRepo,
    defaultBranch: info.defaultBranch,
    isGitRepo: info.isGitRepo,
    recentCommits: info.recentCommits,
    commitsByDay: info.commitsByDay,
    authors: info.authors,
    latestCommitAt: info.latestCommitAt,
    error: info.error,
  }
}

function toRepositoryMetric(info: LocalGitRepoInfo): RepositoryIdentity {
  return {
    repoKey: info.repoKey,
    name: info.githubRepo ?? info.repoName,
    localPath: info.path,
    remoteUrl: info.remoteUrl,
    githubOwner: info.githubOwner,
    githubRepo: info.githubRepo,
    source: info.source,
  }
}

function normalizeRepositoryMetric(info: RepositoryIdentity): RepositoryIdentity {
  return {
    repoKey: info.repoKey,
    name: info.name,
    localPath: info.localPath,
    remoteUrl: info.remoteUrl,
    githubOwner: info.githubOwner,
    githubRepo: info.githubRepo,
    source: info.source,
  }
}

export function createOrchestrator(config: OrchestratorConfig) {
  return {
    async collect(): Promise<OrchestratorResult> {
      const startTime = Date.now()
      const capturedAt = new Date().toISOString()
      const snapshotId = randomUUID()
      const allErrors: string[] = []
      const sources: string[] = []

      let issues: IssueMetric[] = []
      let pullRequests: PullRequestMetric[] = []
      let checkRuns: CheckRunMetric[] = []
      let repositories: RepositoryIdentity[] = []
      let sessions: SessionMetric[] = []
      let localGit: LocalGitRepoMetric[] = []
      let aggregates: DashboardAggregates | null = null
      let sessionUsageFromCollector: import('../../../types/aggregates').SessionUsageAggregate | null = null

      // 1. GitHub collector
      if (config.github) {
        sources.push('github')
        try {
          const ghCollector = createGitHubCollector({
            ...config.github,
            skipPersist: true,
          })
          const ghResult = await ghCollector.collect()
          if (ghResult.snapshot) {
            issues = ghResult.snapshot.issues
            pullRequests = ghResult.snapshot.pullRequests
            checkRuns = ghResult.snapshot.checkRuns
            repositories = ghResult.snapshot.repositories.map(normalizeRepositoryMetric)
            aggregates = ghResult.snapshot.aggregates
          }
          allErrors.push(...ghResult.errors)
        } catch (err) {
          allErrors.push(`GitHub collector failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // 2. Local git collector
      if (config.localGit) {
        sources.push('localGit')
        try {
          const gitCollector = createLocalGitCollector(config.localGit)
          const gitResult = await gitCollector.collect()
          const repoMetrics = gitResult.repos.map(toRepositoryMetric)
          for (const repo of repoMetrics) {
            const existing = repositories.find(item => item.repoKey === repo.repoKey)
            const merged = mergeIdentity(existing, repo)
            repositories = repositories.filter(item => item.repoKey !== repo.repoKey).concat([merged])
          }
          localGit = gitResult.repos.map(toLocalGitRepoMetric)
          allErrors.push(...gitResult.errors)
        } catch (err) {
          allErrors.push(`Local git collector failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // 3. Session usage collector
      if (config.sessions) {
        sources.push('sessions')
        try {
          const sessionCollector = createSessionCollector(config.sessions)
          const sessionResult = await sessionCollector.collect()
          sessions = sessionResult.sessions
          sessionUsageFromCollector = sessionResult.sessionUsage
          if (sessionResult.sessionUsage && aggregates) {
            aggregates = {
              ...aggregates,
              sessionUsage: sessionResult.sessionUsage,
              computedAt: capturedAt,
            }
          }
          if (sessionResult.gap) {
            allErrors.push(sessionResult.gap)
          }
          allErrors.push(...sessionResult.errors)
        } catch (err) {
          allErrors.push(`Session collector failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Build aggregates if we didn't get them from GitHub
      if (!aggregates) {
        const now = new Date()
        aggregates = {
          throughput: {
            periodStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            periodEnd: capturedAt,
            issuesClosed: 0,
            issuesOpened: 0,
            prsMerged: 0,
            prsCreated: 0,
            totalCommits: localGit.reduce((sum, r) => sum + r.recentCommits, 0),
          },
          cycleTime: null,
          ci: null,
          staleWork: {
            asOf: capturedAt,
            staleIssues: 0,
            stalePRs: 0,
            staleThresholdDays: 14,
            oldestItemDays: null,
          },
          sessionUsage: sessionUsageFromCollector,
          computedAt: capturedAt,
        }
      }

      const partialData = allErrors.length > 0
      const errorMetrics: ErrorMetric[] = allErrors.map((msg, i) => ({
        id: `err-${snapshotId}-${i}`,
        source: 'orchestrator',
        level: 'error' as const,
        message: msg,
        timestamp: capturedAt,
        stackTrace: null,
        metadata: {},
      }))

      const snapshot: MetricSnapshot = {
        id: snapshotId,
        capturedAt,
        issues,
        pullRequests,
        checkRuns,
        repositories: repositories.reduce<RepositoryIdentity[]>((acc, repo) => {
          const existing = acc.find(item => item.repoKey === repo.repoKey)
          if (!existing) {
            acc.push(repo)
            return acc
          }
          return acc.map(item => item.repoKey === repo.repoKey ? mergeIdentity(item, repo) : item)
        }, []),
        sessions,
        localGit,
        errors: errorMetrics,
        aggregates: {
          ...aggregates,
          computedAt: capturedAt,
        },
        metadata: {
          source: 'orchestrated',
          refreshDurationMs: Date.now() - startTime,
          partialData,
          errors: allErrors,
        },
      }

      try {
        await initDb()
        insertSnapshot(snapshot)

        const aggEntries: Array<{ type: AggregateType; data: unknown }> = [
          { type: 'throughput', data: aggregates.throughput },
          { type: 'cycleTime', data: aggregates.cycleTime },
          { type: 'ci', data: aggregates.ci },
          { type: 'staleWork', data: aggregates.staleWork },
        ]

        if (aggregates.sessionUsage) {
          aggEntries.push({ type: 'sessionUsage', data: aggregates.sessionUsage })
        }

        for (const { type, data } of aggEntries) {
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

        const dailyRows = computeDailyMetrics(snapshot)
        for (const row of dailyRows) {
          upsertDailyMetrics(row)
        }
      } catch (err) {
        allErrors.push(`Failed to persist snapshot: ${err instanceof Error ? err.message : String(err)}`)
      }

      return {
        snapshotId,
        capturedAt,
        sources,
        errors: allErrors,
        partialData,
        durationMs: Date.now() - startTime,
      }
    },
  }
}

export type Orchestrator = ReturnType<typeof createOrchestrator>
