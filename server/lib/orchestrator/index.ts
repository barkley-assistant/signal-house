import { randomUUID } from 'node:crypto'
import { initDb, persistSnapshot, markRepositoriesPresence } from '../../db/client'
import type { DashboardAggregates, SessionUsageAggregate, TokenUsageAggregate } from '../../../types/aggregates'
import type {
  ErrorMetric,
  IssueMetric,
  LocalGitRepoMetric,
  PullRequestMetric,
  RepositoryIdentity,
  RepositoryMetric,
  SessionMetric,
  WorkflowRunMetric,
} from '../../../types/metrics'
import type { MetricSnapshot } from '../../../types/snapshot'
import { createLocalGitCollector } from '../git/collector'
import type { LocalGitRepoInfo } from '../git/types'
import { deriveAll } from '../github/aggregates'
import { collectWithConcurrency, createCollector as createGitHubCollector } from '../github/collector'
import { collectTokenUsageSnapshot } from '../opencode/collector'
import { collectHermesTokenUsageSnapshot } from '../hermes/collector'
import { getRuntimeConfig } from '../runtime-config'
import { createSessionCollector } from '../sessions/collector'
import type { OrchestratorConfig, OrchestratorResult } from './types'

interface SourceTaskResult {
  source: string
  issues?: IssueMetric[]
  pullRequests?: PullRequestMetric[]
  workflowRuns?: WorkflowRunMetric[]
  repositories?: RepositoryIdentity[]
  sessions?: SessionMetric[]
  localGit?: LocalGitRepoMetric[]
  sessionUsage?: SessionUsageAggregate | null
  tokenUsage?: TokenUsageAggregate | null
  hermesTokenUsage?: TokenUsageAggregate | null
  errors: string[]
}

function mergeSource(
  a: RepositoryIdentity['source'],
  b: RepositoryIdentity['source'],
): RepositoryIdentity['source'] {
  if (a === b) return a
  return 'both'
}

function mergeIdentity(
  existing: RepositoryIdentity | undefined,
  next: RepositoryIdentity,
): RepositoryIdentity {
  if (!existing) return next

  return {
    repoKey: existing.repoKey,
    name: existing.name || next.name,
    localPath: existing.localPath ?? next.localPath,
    remoteUrl: existing.remoteUrl ?? next.remoteUrl,
    githubOwner: existing.githubOwner ?? next.githubOwner,
    githubRepo: existing.githubRepo ?? next.githubRepo,
    source: mergeSource(existing.source, next.source),
    isPrivate: existing.isPrivate ?? next.isPrivate,
  }
}

function dedupeRepositories(repositories: RepositoryIdentity[]): RepositoryIdentity[] {
  return repositories.reduce<RepositoryIdentity[]>((acc, repo) => {
    const existing = acc.find((item) => item.repoKey === repo.repoKey)
    if (!existing) {
      acc.push(repo)
      return acc
    }

    return acc.map((item) => item.repoKey === repo.repoKey ? mergeIdentity(item, repo) : item)
  }, [])
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
    name: info.repoName,
    localPath: info.path,
    remoteUrl: info.remoteUrl,
    githubOwner: info.githubOwner,
    githubRepo: info.githubRepo,
    source: info.source,
    isPrivate: false,
  }
}

function normalizeRepositoryMetric(repo: RepositoryIdentity | RepositoryMetric): RepositoryIdentity {
  return {
    repoKey: repo.repoKey,
    name: repo.name,
    localPath: repo.localPath,
    remoteUrl: repo.remoteUrl,
    githubOwner: repo.githubOwner,
    githubRepo: repo.githubRepo,
    source: repo.source,
    isPrivate: repo.isPrivate,
  }
}

function fallbackAggregates(
  capturedAt: string,
  localGit: LocalGitRepoMetric[],
  sessionUsage: SessionUsageAggregate | null,
  tokenUsage: TokenUsageAggregate | null,
  hermesTokenUsage: TokenUsageAggregate | null,
): DashboardAggregates {
  const runtimeConfig = getRuntimeConfig()
  const now = new Date()
  const periodStart = new Date(now.getTime() - runtimeConfig.orchestrator.githubLookbackDays * 24 * 60 * 60 * 1000).toISOString()

  return {
    throughput: {
      periodStart,
      periodEnd: capturedAt,
      issuesClosed: 0,
      issuesOpened: 0,
      prsMerged: 0,
      prsCreated: 0,
      totalCommits: localGit.reduce((sum, repo) => sum + repo.recentCommits, 0),
    },
    cycleTime: null,
    ci: null,
    staleWork: {
      asOf: capturedAt,
      staleIssues: 0,
      stalePRs: 0,
      staleThresholdDays: runtimeConfig.orchestrator.staleThresholdDays,
      oldestItemDays: null,
    },
    sessionUsage,
    tokenUsage,
    hermesTokenUsage,
    computedAt: capturedAt,
  }
}

async function collectGitHub(config: OrchestratorConfig): Promise<SourceTaskResult | null> {
  if (!config.github || config.github.length === 0) return null

  const runtimeConfig = getRuntimeConfig()
  const ghResults = await collectWithConcurrency(
    config.github,
    runtimeConfig.orchestrator.collectConcurrency,
    async (ghConfig) => {
      const ghCollector = createGitHubCollector(ghConfig)
      return await ghCollector.collect()
    },
  )

  const result: SourceTaskResult = {
    source: 'github',
    issues: [],
    pullRequests: [],
    workflowRuns: [],
    repositories: [],
    errors: [],
  }

  for (const ghResult of ghResults) {
    if (ghResult.snapshot) {
      result.issues?.push(...ghResult.snapshot.issues)
      result.pullRequests?.push(...ghResult.snapshot.pullRequests)
      result.workflowRuns?.push(...ghResult.snapshot.workflowRuns)
      result.repositories?.push(...ghResult.snapshot.repositories.map(normalizeRepositoryMetric))
    }
    result.errors.push(...ghResult.errors)
  }

  return result
}

async function collectLocalGit(config: OrchestratorConfig): Promise<SourceTaskResult | null> {
  if (!config.localGit) return null

  const gitCollector = createLocalGitCollector(config.localGit)
  const gitResult = await gitCollector.collect()

  return {
    source: 'localGit',
    repositories: gitResult.repos.map(toRepositoryMetric),
    localGit: gitResult.repos.map(toLocalGitRepoMetric),
    errors: gitResult.errors,
  }
}

async function collectSessions(config: OrchestratorConfig): Promise<SourceTaskResult | null> {
  if (!config.sessions) return null

  const sessionCollector = createSessionCollector(config.sessions)
  const sessionResult = await sessionCollector.collect()

  return {
    source: 'sessions',
    sessions: sessionResult.sessions,
    sessionUsage: sessionResult.sessionUsage,
    errors: sessionResult.errors,
  }
}

async function collectTokenUsage(): Promise<SourceTaskResult> {
  const tokenResult = collectTokenUsageSnapshot()

  return {
    source: 'tokenUsage',
    tokenUsage: tokenResult.errors.length > 0
      ? null
      : {
        periodStart: tokenResult.periodStart,
        periodEnd: tokenResult.periodEnd,
        source: tokenResult.source,
        toolName: tokenResult.toolName,
        totalSessions: tokenResult.totalSessions,
        totalMessages: tokenResult.totalMessages,
        totalTokens: tokenResult.totalTokens,
        totalCost: tokenResult.totalCost,
        modelUsage: tokenResult.modelUsage,
        rawJson: tokenResult.rawJson,
        collectedAt: tokenResult.collectedAt,
      },
    errors: tokenResult.errors,
  }
}

async function collectHermesTokenUsage(): Promise<SourceTaskResult> {
  const tokenResult = collectHermesTokenUsageSnapshot()

  return {
    source: 'hermesTokenUsage',
    hermesTokenUsage: tokenResult.errors.length > 0
      ? null
      : {
        periodStart: tokenResult.periodStart,
        periodEnd: tokenResult.periodEnd,
        source: tokenResult.source,
        toolName: tokenResult.toolName,
        totalSessions: tokenResult.totalSessions,
        totalMessages: tokenResult.totalMessages,
        totalTokens: tokenResult.totalTokens,
        totalCost: tokenResult.totalCost,
        modelUsage: tokenResult.modelUsage,
        rawJson: tokenResult.rawJson,
        collectedAt: tokenResult.collectedAt,
      },
    errors: tokenResult.errors,
  }
}

export function createOrchestrator(config: OrchestratorConfig) {
  return {
    async collect(): Promise<OrchestratorResult> {
      const startTime = Date.now()
      const capturedAt = new Date().toISOString()
      const snapshotId = randomUUID()
      const runtimeConfig = getRuntimeConfig()

      const taskResults = await Promise.allSettled([
        collectGitHub(config),
        collectLocalGit(config),
        collectSessions(config),
        collectTokenUsage(),
        collectHermesTokenUsage(),
      ])

      const allErrors: string[] = []
      const sources: string[] = []
      const issues: IssueMetric[] = []
      let pullRequests: PullRequestMetric[] = []
      let workflowRuns: WorkflowRunMetric[] = []
      const repositories: RepositoryIdentity[] = []
      let sessions: SessionMetric[] = []
      let localGit: LocalGitRepoMetric[] = []
      let sessionUsageFromCollector: SessionUsageAggregate | null = null
      let tokenUsageFromCollector: TokenUsageAggregate | null = null
      let hermesTokenUsageFromCollector: TokenUsageAggregate | null = null

      for (const settled of taskResults) {
        if (settled.status === 'rejected') {
          allErrors.push(`Collector failed: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`)
          continue
        }

        const result = settled.value
        if (!result) continue

        sources.push(result.source)
        issues.push(...(result.issues ?? []))
        pullRequests = pullRequests.concat(result.pullRequests ?? [])
        workflowRuns = workflowRuns.concat(result.workflowRuns ?? [])
        repositories.push(...(result.repositories ?? []))
        sessions = result.sessions ?? sessions
        localGit = result.localGit ?? localGit

        if (result.sessionUsage !== undefined) {
          sessionUsageFromCollector = result.sessionUsage
        }
        if (result.tokenUsage !== undefined) {
          tokenUsageFromCollector = result.tokenUsage
        }
        if (result.hermesTokenUsage !== undefined) {
          hermesTokenUsageFromCollector = result.hermesTokenUsage
        }

        allErrors.push(...result.errors)
      }

      let aggregates: DashboardAggregates | null = null
      if (config.github && config.github.length > 0) {
        const deriveConfig = {
          staleThresholdDays: runtimeConfig.orchestrator.staleThresholdDays,
          lookbackDays: runtimeConfig.orchestrator.githubLookbackDays,
        }
        aggregates = deriveAll(issues, pullRequests, workflowRuns, deriveConfig)
        aggregates.throughput.totalCommits = localGit.reduce((sum, repo) => sum + repo.recentCommits, 0)
        aggregates.sessionUsage = sessionUsageFromCollector
        aggregates.tokenUsage = tokenUsageFromCollector
        aggregates.hermesTokenUsage = hermesTokenUsageFromCollector
      }

      if (!aggregates) {
        aggregates = fallbackAggregates(
          capturedAt,
          localGit,
          sessionUsageFromCollector,
          tokenUsageFromCollector,
          hermesTokenUsageFromCollector,
        )
      }

      const partialData = allErrors.length > 0
      const errorMetrics: ErrorMetric[] = allErrors.map((message, index) => ({
        id: `err-${snapshotId}-${index}`,
        source: 'orchestrator',
        level: 'error',
        message,
        timestamp: capturedAt,
        stackTrace: null,
        metadata: {},
      }))

      const deduplicatedRepos = dedupeRepositories(repositories)
      const privacyMap: Record<string, boolean> = {}
      for (const repo of deduplicatedRepos) {
        privacyMap[repo.repoKey] = repo.isPrivate ?? false
      }

      const snapshot: MetricSnapshot = {
        id: snapshotId,
        capturedAt,
        issues,
        pullRequests,
        workflowRuns,
        repositories: deduplicatedRepos,
        sessions,
        localGit,
        errors: errorMetrics,
        aggregates: {
          ...aggregates,
          repositoryPrivacy: { privacyMap },
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
        persistSnapshot(snapshot)
        const currentRepoKeys = snapshot.localGit.map(r => r.repoKey)
        markRepositoriesPresence(currentRepoKeys, snapshot.capturedAt)
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
