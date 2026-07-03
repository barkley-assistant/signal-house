import type {
  ThroughputAggregate,
  CycleTimeAggregate,
  CIAggregate,
  StaleWorkAggregate,
  DashboardAggregates,
} from '../../../types/aggregates'
import type { IssueMetric, PullRequestMetric, WorkflowRunMetric } from '../../../types/metrics'

function isInPeriod(dateStr: string | null, periodStart: string, periodEnd: string): boolean {
  if (!dateStr) return false
  return dateStr >= periodStart && dateStr <= periodEnd
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.max(0, ms / 1000)
}

function deriveThroughput(
  issues: IssueMetric[],
  prs: PullRequestMetric[],
  periodStart: string,
  periodEnd: string,
): ThroughputAggregate {
  let issuesClosed = 0
  let issuesOpened = 0
  let prsMerged = 0
  let prsCreated = 0

  for (const issue of issues) {
    if (isInPeriod(issue.createdAt, periodStart, periodEnd)) {
      issuesOpened++
    }
    if (isInPeriod(issue.closedAt, periodStart, periodEnd)) {
      issuesClosed++
    }
  }

  for (const pr of prs) {
    if (isInPeriod(pr.createdAt, periodStart, periodEnd)) {
      prsCreated++
    }
    if (isInPeriod(pr.mergedAt, periodStart, periodEnd)) {
      prsMerged++
    }
  }

  return {
    periodStart,
    periodEnd,
    issuesClosed,
    issuesOpened,
    prsMerged,
    prsCreated,
    totalCommits: 0,
  }
}

function deriveCycleTime(
  prs: PullRequestMetric[],
  periodStart: string,
  periodEnd: string,
): CycleTimeAggregate | null {
  const mergedPrs = prs.filter(
    pr => pr.state === 'merged' && pr.mergedAt && isInPeriod(pr.mergedAt, periodStart, periodEnd),
  )

  if (mergedPrs.length === 0) return null

  const cycleSeconds = mergedPrs.map(pr => daysBetween(pr.createdAt, pr.mergedAt!)).sort((a, b) => a - b)

  const n = cycleSeconds.length
  const averageSeconds = cycleSeconds.reduce((s, d) => s + d, 0) / n
  const medianSeconds = n % 2 === 0
    ? (cycleSeconds[n / 2 - 1]! + cycleSeconds[n / 2]!) / 2
    : cycleSeconds[Math.floor(n / 2)]!
  const p95Index = Math.ceil(n * 0.95) - 1
  const p95Seconds = cycleSeconds[Math.min(p95Index, n - 1)]!

  return { periodStart, periodEnd, averageSeconds, medianSeconds, p95Seconds, sampleSize: n }
}

function deriveStaleWork(
  issues: IssueMetric[],
  prs: PullRequestMetric[],
  thresholdDays: number,
  asOf: string,
): StaleWorkAggregate {
  const cutoff = new Date(new Date(asOf).getTime() - thresholdDays * 24 * 60 * 60 * 1000).toISOString()

  const staleIssues = issues.filter(
    i => i.state === 'open' && i.updatedAt < cutoff,
  ).length

  const stalePRs = prs.filter(
    p => p.state === 'open' && p.updatedAt < cutoff,
  ).length

  const allOpen = [
    ...issues.filter(i => i.state === 'open').map(i => i.updatedAt),
    ...prs.filter(p => p.state === 'open').map(p => p.updatedAt),
  ]

  let oldestItemDays: number | null = null
  if (allOpen.length > 0) {
    const oldest = allOpen.reduce((a, b) => (a < b ? a : b))
    oldestItemDays = daysBetween(oldest, asOf)
  }

  return { asOf, staleIssues, stalePRs, staleThresholdDays: thresholdDays, oldestItemDays }
}

function deriveCI(
  workflowRuns: WorkflowRunMetric[],
  periodStart: string,
  periodEnd: string,
): CIAggregate {
  const runs = workflowRuns.filter(
    cr => cr.status === 'completed' && isInPeriod(cr.createdAt, periodStart, periodEnd),
  )
  const totalRuns = runs.length
  const passCount = runs.filter(r => r.conclusion === 'success').length
  const failCount = runs.filter(
    r => r.conclusion === 'failure' || r.conclusion === 'timed_out',
  ).length
  const passRate = totalRuns > 0 ? passCount / totalRuns : 0

  const durations: number[] = []
  for (const run of runs) {
    if (run.completedAt) {
      const d = daysBetween(run.createdAt, run.completedAt) * 1000
      durations.push(d)
    }
  }
  const averageDurationMs = durations.length > 0
    ? durations.reduce((s, d) => s + d, 0) / durations.length
    : null

  return { periodStart, periodEnd, totalRuns, passCount, failCount, passRate, averageDurationMs }
}

export function deriveMergeRate(
  prs: PullRequestMetric[],
  periodStart: string,
  periodEnd: string,
): { mergeRate: number; totalCreated: number; totalMerged: number } {
  const created = prs.filter(p => isInPeriod(p.createdAt, periodStart, periodEnd)).length
  const merged = prs.filter(p => p.mergedAt && isInPeriod(p.mergedAt, periodStart, periodEnd)).length
  return {
    mergeRate: created > 0 ? merged / created : 0,
    totalCreated: created,
    totalMerged: merged,
  }
}

export function deriveAll(
  issues: IssueMetric[],
  prs: PullRequestMetric[],
  workflowRuns: WorkflowRunMetric[],
  config: { staleThresholdDays: number; lookbackDays: number },
): DashboardAggregates {
  const now = new Date()
  const periodEnd = now.toISOString()
  const periodStart = new Date(now.getTime() - config.lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  const throughput = deriveThroughput(issues, prs, periodStart, periodEnd)
  const cycleTime = deriveCycleTime(prs, periodStart, periodEnd)
  const staleWork = deriveStaleWork(issues, prs, config.staleThresholdDays, now.toISOString())
  const ci = deriveCI(workflowRuns, periodStart, periodEnd)

  return {
    throughput,
    cycleTime,
    ci,
    staleWork,
    sessionUsage: null,
    computedAt: now.toISOString(),
  }
}
