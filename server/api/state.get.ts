import { defineEventHandler, getQuery, setHeader } from 'h3'
import { initDb, getLatestState, getDailyMetricsRange, getDailyMetricsRangeForRepo, getNormalizedSnapshotForRepo } from '../db/client'
import { buildDashboardWindow } from '../lib/dashboard-state'
import { ALL_REPOS_REPO_KEY } from '../../types/daily-metrics'

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

  const viewSnapshot = getNormalizedSnapshotForRepo(repoKey)
  const dashboardRows = repoKey === ALL_REPOS_REPO_KEY
    ? getDailyMetricsRange(fromDay.toISOString().slice(0, 10), today)
    : getDailyMetricsRangeForRepo(fromDay.toISOString().slice(0, 10), today, repoKey)

  const dashboardWindow = buildDashboardWindow(
    dashboardRows,
    new Date(),
    state.isStale,
    (viewSnapshot?.aggregates.sessionUsage ?? sessionUsage) as NonNullable<typeof sessionUsage> | null,
  )

  return {
    ...state,
    sourceHealth: state.refreshState?.sourceHealth ?? state.diagnostics?.sourceHealth ?? {},
    selectedRepoKey: repoKey,
    viewSnapshot,
    dashboardWindow,
  }
})
