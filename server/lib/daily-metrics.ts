import type { MetricSnapshot } from '../../types/snapshot'
import type { DailyMetricsInsert } from '../../types/daily-metrics'
import type { CycleTimeAggregate, CIAggregate } from '../../types/aggregates'

function toDayKey(isoString: string): string {
  return isoString.slice(0, 10)
}

function extractDaysFromRange(startIso: string, endIso: string): string[] {
  const days: string[] = []
  const start = new Date(startIso.slice(0, 10) + 'T00:00:00Z')
  const end = new Date(endIso.slice(0, 10) + 'T00:00:00Z')
  const current = new Date(start)
  while (current <= end) {
    days.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}

function countByDay<T>(
  items: T[],
  getTimestamp: (item: T) => string | null,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const ts = getTimestamp(item)
    if (!ts) continue
    const day = toDayKey(ts)
    counts.set(day, (counts.get(day) || 0) + 1)
  }
  return counts
}

export function computeDailyMetrics(snapshot: MetricSnapshot): DailyMetricsInsert[] {
  const capturedAt = snapshot.capturedAt
  const capturedDay = toDayKey(capturedAt)
  const source = snapshot.metadata.source
  const warnings: string[] = snapshot.metadata.errors.length > 0
    ? ['Partial data: ' + snapshot.metadata.errors.join('; ')]
    : []

  const issuesOpenedByDay = countByDay(snapshot.issues, (i) => i.createdAt)
  const issuesClosedByDay = countByDay(snapshot.issues, (i) => i.closedAt)
  const prsCreatedByDay = countByDay(snapshot.pullRequests, (pr) => pr.createdAt)
  const prsMergedByDay = countByDay(snapshot.pullRequests, (pr) => pr.mergedAt)
  const ciCompletedByDay = countByDay(snapshot.checkRuns, (cr) => cr.completedAt)

  const ciPassByDay = countByDay(
    snapshot.checkRuns.filter((cr) => cr.conclusion === 'success'),
    (cr) => cr.completedAt,
  )
  const ciFailByDay = countByDay(
    snapshot.checkRuns.filter((cr) => cr.conclusion === 'failure' || cr.conclusion === 'timed_out' || cr.conclusion === 'startup_failure'),
    (cr) => cr.completedAt,
  )

  const sessionsByDay = countByDay(snapshot.sessions, (s) => s.timestamp)
  const sessionErrorsByDay = countByDay(
    snapshot.sessions.filter((s) => !s.success),
    (s) => s.timestamp,
  )
  const sessionUsageAggregate = snapshot.aggregates.sessionUsage
  const useAggregateSessionFallback = snapshot.sessions.length === 0 && sessionUsageAggregate != null

  const totalCommits = snapshot.localGit.reduce((sum, r) => sum + r.recentCommits, 0)
  const commitsByDay = new Map<string, number>()
  for (const repo of snapshot.localGit) {
    if (repo.commitsByDay) {
      for (const [day, count] of Object.entries(repo.commitsByDay)) {
        commitsByDay.set(day, (commitsByDay.get(day) || 0) + count)
      }
    }
  }

  const allDays = new Set<string>()
  for (const day of issuesOpenedByDay.keys()) allDays.add(day)
  for (const day of issuesClosedByDay.keys()) allDays.add(day)
  for (const day of prsCreatedByDay.keys()) allDays.add(day)
  for (const day of prsMergedByDay.keys()) allDays.add(day)
  for (const day of ciCompletedByDay.keys()) allDays.add(day)
  for (const day of sessionsByDay.keys()) allDays.add(day)
  for (const day of commitsByDay.keys()) allDays.add(day)

  if (snapshot.aggregates) {
    const aggDays = extractDaysFromRange(
      snapshot.aggregates.throughput.periodStart,
      snapshot.aggregates.throughput.periodEnd,
    )
    for (const day of aggDays) allDays.add(day)
  }

  allDays.add(toDayKey(capturedAt))

  const cycleTime = snapshot.aggregates.cycleTime as CycleTimeAggregate | null
  const ci = snapshot.aggregates.ci as CIAggregate | null
  const staleWork = snapshot.aggregates.staleWork

  const inserts: DailyMetricsInsert[] = []

  const sortedDays = Array.from(allDays).sort().reverse()

  for (const day of sortedDays) {
    let ciTotal = ciCompletedByDay.get(day) || 0
    let ciPass = ciPassByDay.get(day) || 0
    let ciFail = ciFailByDay.get(day) || 0

    if (ci && ciTotal === 0 && ci.averageDurationMs != null) {
      const ciDayStart = ci.periodStart.slice(0, 10)
      const ciDayEnd = ci.periodEnd.slice(0, 10)
      if (day >= ciDayStart && day <= ciDayEnd) {
        ciTotal = ci.totalRuns
        ciPass = ci.passCount
        ciFail = ci.failCount
      }
    }

    inserts.push({
      day,
      capturedAt,
      source,
      reflectsCompleteData: warnings.length === 0,
      issuesOpened: issuesOpenedByDay.get(day) || 0,
      issuesClosed: issuesClosedByDay.get(day) || 0,
      prsCreated: prsCreatedByDay.get(day) || 0,
      prsMerged: prsMergedByDay.get(day) || 0,
      totalCommits: commitsByDay.size > 0 ? (commitsByDay.get(day) || 0) : totalCommits,
      avgCycleTimeDays: cycleTime?.averageDays ?? null,
      medianCycleTimeDays: cycleTime?.medianDays ?? null,
      p95CycleTimeDays: cycleTime?.p95Days ?? null,
      cycleTimeSampleSize: cycleTime?.sampleSize ?? 0,
      ciTotalRuns: ciTotal,
      ciPassCount: ciPass,
      ciFailCount: ciFail,
      ciPassRate: ciTotal > 0 ? ciPass / ciTotal : null,
      ciAvgDurationMs: ci?.averageDurationMs ?? null,
      totalSessions: sessionsByDay.get(day) || (useAggregateSessionFallback && day === capturedDay ? sessionUsageAggregate.totalSessions : 0),
      sessionErrorCount: sessionErrorsByDay.get(day) || (useAggregateSessionFallback && day === capturedDay ? sessionUsageAggregate.errorCount : 0),
      staleIssues: staleWork.staleIssues,
      stalePrs: staleWork.stalePRs,
      warnings,
    })
  }

  return inserts
}
