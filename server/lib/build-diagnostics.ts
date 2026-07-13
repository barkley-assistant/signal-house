import { getBooleanEnv, getEnv } from './env'
import type { MetricSnapshot, RefreshRunState, SourceDiagnostics } from '../../types/snapshot'

export function buildDiagnostics(
  state: RefreshRunState,
  snapshot: MetricSnapshot | null,
  showPrivateRepoItems: boolean,
): SourceDiagnostics {
  const configuredProjectRoots = getEnv(process.env, 'SECRET_HOUSE_PROJECT_ROOTS', 'GIT_REPO_ROOTS')
    ?.split(',')
    .map(root => root.trim())
    .filter(Boolean) ?? []
  const pollIntervalSeconds = getEnv(process.env, 'SECRET_HOUSE_POLL_INTERVAL_SECONDS', 'METRICS_POLL_INTERVAL_SECONDS')
  const refreshAgeSeconds = snapshot ? Math.max(0, Math.floor((Date.now() - new Date(snapshot.capturedAt).getTime()) / 1000)) : null
  const privacyMap = snapshot?.aggregates?.repositoryPrivacy?.privacyMap ?? {}
  const privateByGithubKey = new Map<string, boolean>(
    (snapshot?.repositories ?? [])
      .filter(repo => repo.githubOwner && repo.githubRepo)
      .map(repo => [`${repo.githubOwner}/${repo.githubRepo}`, privacyMap[repo.repoKey] === true]),
  )
  const allLocalGit = (snapshot?.localGit ?? [])
    .map(repo => {
      const githubKey = repo.githubOwner && repo.githubRepo
        ? `${repo.githubOwner}/${repo.githubRepo}`
        : null
      return {
        repoKey: repo.repoKey,
        name: repo.repoName,
        path: repo.path,
        remoteUrl: repo.remoteUrl,
        githubOwner: repo.githubOwner,
        githubRepo: repo.githubRepo,
        source: repo.source,
        isPrivate: githubKey ? (privateByGithubKey.get(githubKey) ?? false) : false,
        present: repo.present,
        lastSeenAt: repo.lastSeenAt ?? null,
      }
    })
    .filter(repo => showPrivateRepoItems || !repo.isPrivate)

  const discoveredRepos = allLocalGit
    .filter(repo => repo.present !== false)

  const historicalRepos = allLocalGit
    .filter(repo => repo.present === false)
    .map(repo => ({
      repoKey: repo.repoKey,
      name: repo.name,
      path: repo.path,
      remoteUrl: repo.remoteUrl,
      githubOwner: repo.githubOwner,
      githubRepo: repo.githubRepo,
      source: repo.source,
      isPrivate: repo.isPrivate,
      lastSeenAt: repo.lastSeenAt,
    }))
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
    historicalRepos,
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
