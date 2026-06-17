import { defineEventHandler, getQuery, setHeader } from 'h3'
import { initDb, getLatestState, getDailyMetricsRange } from '../db/client'
import { computeDailyMetrics } from '../lib/daily-metrics'
import { deriveCI, deriveCycleTime, deriveStaleWork } from '../lib/github/aggregates'
import { buildDashboardWindow } from '../lib/dashboard-state'
import { ALL_REPOS_REPO_KEY } from '../../types/daily-metrics'
import type { MetricSnapshot } from '../../types/snapshot'

function filterSnapshotForRepo(snapshot: MetricSnapshot, repoKey: string): MetricSnapshot {
  if (repoKey === ALL_REPOS_REPO_KEY) return snapshot

  const issues = snapshot.issues.filter(item => item.repoKey === repoKey)
  const pullRequests = snapshot.pullRequests.filter(item => item.repoKey === repoKey)
  const workflowRuns = snapshot.workflowRuns.filter(item => item.repoKey === repoKey)
  const repositories = snapshot.repositories.filter(item => item.repoKey === repoKey)
  const localGit = snapshot.localGit.filter(item => item.repoKey === repoKey)
  const periodStart = snapshot.aggregates.throughput.periodStart
  const periodEnd = snapshot.aggregates.throughput.periodEnd

  return {
    ...snapshot,
    issues,
    pullRequests,
    workflowRuns,
    repositories,
    localGit,
    aggregates: {
      ...snapshot.aggregates,
      cycleTime: deriveCycleTime(pullRequests, periodStart, periodEnd),
      ci: deriveCI(workflowRuns, periodStart, periodEnd),
      staleWork: deriveStaleWork(issues, pullRequests, snapshot.aggregates.staleWork.staleThresholdDays, snapshot.capturedAt),
    },
  }
}

export default defineEventHandler(async (event) => {
  await initDb()
  setHeader(event, 'Cache-Control', 'no-cache')

  const query = getQuery(event)
  const repoKey = typeof query.repoKey === 'string' && query.repoKey.length > 0
    ? query.repoKey
    : ALL_REPOS_REPO_KEY

  const state = getLatestState()
  const sessionUsage = state.snapshot?.aggregates.sessionUsage ?? null
  const today = new Date().toISOString().slice(0, 10)
  const fromDay = new Date(`${today}T00:00:00Z`)
  fromDay.setUTCDate(fromDay.getUTCDate() - 27)

  const viewSnapshot = state.snapshot ? filterSnapshotForRepo(state.snapshot, repoKey) : null
  const dashboardRows = repoKey === ALL_REPOS_REPO_KEY
    ? getDailyMetricsRange(fromDay.toISOString().slice(0, 10), today)
    : viewSnapshot
      ? computeDailyMetrics(viewSnapshot).map(row => ({
          ...row,
          version: 1,
          createdAt: viewSnapshot.capturedAt,
        }))
      : []

  const dashboardWindow = buildDashboardWindow(
    dashboardRows,
    new Date(),
    state.isStale,
    viewSnapshot?.aggregates.sessionUsage ?? sessionUsage,
  )

  return {
    ...state,
    selectedRepoKey: repoKey,
    viewSnapshot,
    dashboardWindow,
  }
})
