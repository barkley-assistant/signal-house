import { getBooleanEnv, getEnv } from './env'
import type { MetricSnapshot, RefreshRunState, SourceDiagnostics } from '../../types/snapshot'

export function buildDiagnostics(state: RefreshRunState, snapshot: MetricSnapshot | null): SourceDiagnostics {
  const configuredProjectRoots = getEnv(process.env, 'SECRET_HOUSE_PROJECT_ROOTS', 'GIT_REPO_ROOTS')
    ?.split(',')
    .map(root => root.trim())
    .filter(Boolean) ?? []
  const pollIntervalSeconds = getEnv(process.env, 'SECRET_HOUSE_POLL_INTERVAL_SECONDS', 'METRICS_POLL_INTERVAL_SECONDS')
  const refreshAgeSeconds = snapshot ? Math.max(0, Math.floor((Date.now() - new Date(snapshot.capturedAt).getTime()) / 1000)) : null
  const discoveredRepos = snapshot?.localGit.map(repo => ({
    repoKey: repo.repoKey,
    name: repo.repoName,
    path: repo.path,
    remoteUrl: repo.remoteUrl,
    githubOwner: repo.githubOwner,
    githubRepo: repo.githubRepo,
    source: repo.source,
  })) ?? []
  const parsedGitHubRemotes = discoveredRepos
    .filter(repo => repo.remoteUrl || repo.githubOwner || repo.githubRepo)
    .map(repo => ({
      repoKey: repo.repoKey,
      remoteUrl: repo.remoteUrl,
      githubOwner: repo.githubOwner,
      githubRepo: repo.githubRepo,
    }))

  return {
    configuredProjectRoots,
    discoveredRepos,
    skippedPaths: state.runHistory.flatMap(record => (record.warnings ?? []).map(warning => ({
      path: 'refresh',
      message: warning,
    }))),
    parsedGitHubRemotes,
    collectionTargets: Object.keys(state.sourceHealth),
    cacheAgeSeconds: refreshAgeSeconds,
    pollerEnabled: getBooleanEnv(process.env, 'SECRET_HOUSE_POLLER_ENABLED', 'METRICS_POLLER_ENABLED'),
    pollerIntervalSeconds: pollIntervalSeconds ? Number.parseInt(pollIntervalSeconds, 10) : null,
    lastSuccessfulRefreshAt: state.lastSuccessAt,
    lastError: state.lastError,
    sourceHealth: state.sourceHealth,
  }
}
