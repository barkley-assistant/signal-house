import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { SQL, SCHEMA_VERSION } from './schema'
import { getBooleanEnv, getEnv } from '../lib/env'
import { getRefreshHistoryLimit, getStaleThresholdMs, getRetentionConfig } from '../lib/runtime-config'
import type { MetricSnapshot, SnapshotRow, LatestState, RefreshRunRecord, RefreshRunState, RefreshSourceHealth, RefreshRunStatus, SourceDiagnostics } from '../../types/snapshot'
import type { AggregateType, DashboardAggregates, ThroughputAggregate, CycleTimeAggregate, CIAggregate, StaleWorkAggregate, SessionUsageAggregate } from '../../types/aggregates'
import type { DailyMetricsInsert, DailyMetricsRow } from '../../types/daily-metrics'
import type { IssueMetric, PullRequestMetric, WorkflowRunMetric, RepositoryIdentity, SessionMetric, LocalGitRepoMetric } from '../../types/metrics'
import { computeDailyMetrics } from '../lib/daily-metrics'

export type Db = Database.Database

let _db: Db | null = null

function getDbDir(): string {
  return process.env['DB_DIR'] || join(process.cwd(), '.data')
}

function getDbPath(): string {
  return join(getDbDir(), 'metrics.db')
}

const REFRESH_STATE_KEY = 'refresh_state'

function emptyRefreshState(): RefreshRunState {
  return {
    status: 'idle',
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    nextRunAt: null,
    lastError: null,
    durationMs: null,
    sourceHealth: {},
    runHistory: [],
  }
}

function parseRefreshState(value: string | null): RefreshRunState {
  if (!value) return emptyRefreshState()
  try {
    const parsed = JSON.parse(value) as Partial<RefreshRunState>
    return {
      ...emptyRefreshState(),
      ...parsed,
      sourceHealth: parsed.sourceHealth ?? {},
      runHistory: Array.isArray(parsed.runHistory) ? parsed.runHistory.slice(0, getRefreshHistoryLimit()) as RefreshRunRecord[] : [],
    }
  } catch {
    return emptyRefreshState()
  }
}

function saveRefreshState(state: RefreshRunState): void {
  const db = getDb()
  db.prepare(SQL.upsertLatestState).run({
    key: REFRESH_STATE_KEY,
    value: JSON.stringify({
      ...state,
      runHistory: state.runHistory.slice(0, getRefreshHistoryLimit()),
    }),
  })
  save()
}

function buildSourceHealth(
  sources: string[],
  status: RefreshRunStatus,
  errorSummary: string | null,
  discoveryWarnings: string[] = [],
): Record<string, RefreshSourceHealth> {
  const health: Record<string, RefreshSourceHealth> = {}
  const warningSummary = discoveryWarnings.length > 0
    ? `Discovery warnings: ${discoveryWarnings.join(' | ')}`
    : null
  for (const source of sources) {
    const message = errorSummary ?? (source === 'localGit' ? warningSummary : null)
    health[source] = {
      status: status === 'success'
        ? (source === 'localGit' && warningSummary ? 'degraded' : 'healthy')
        : status === 'skipped'
          ? 'unknown'
          : 'degraded',
      message,
    }
  }
  return health
}

function buildDiagnostics(state: RefreshRunState, snapshot: MetricSnapshot | null): SourceDiagnostics {
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

function openDatabase(): Db {
  const dbDir = getDbDir()
  const dbPath = getDbPath()
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export async function initDb(): Promise<Db> {
  if (_db) return _db
  _db = openDatabase()
  migrate(_db)
  return _db
}

function migrate(db: Db): void {
  const runMigrations = db.transaction(() => {
    db.exec(SQL.createTables)
    db.exec(SQL.createSourceDataTables)
    const row = db.prepare(`SELECT value FROM latest_state WHERE key = 'schema_version'`).get() as { value?: unknown } | undefined
    const current = row ? Number(row.value) : 0
    if (current >= SCHEMA_VERSION) return

    db.exec(SQL.dropTables)
    db.exec(SQL.createTables)
    db.exec(SQL.createSourceDataTables)
    db.exec(SQL.createDailyMetricsV3)
    db.exec(`
      ALTER TABLE daily_metrics_v3 RENAME TO daily_metrics;
      CREATE INDEX IF NOT EXISTS idx_daily_metrics_repo_key
        ON daily_metrics(repo_key, day DESC);
    `)
    db.prepare(SQL.upsertLatestState).run({
      key: 'schema_version',
      value: String(SCHEMA_VERSION),
    })
  })

  runMigrations()
}

export function save(): void {
  // better-sqlite3 writes directly to disk; no export step needed.
  return
}

export function close(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

function runWrite(sql: string, params: Record<string, unknown>): void {
  const db = getDb()
  const stmt = db.prepare(sql)
  stmt.run(params)
}

export function insertSnapshot(snapshot: MetricSnapshot): void {
  const db = getDb()
  const transaction = db.transaction(() => {
    db.prepare(SQL.insertSnapshot).run({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      data: JSON.stringify(snapshot),
      version: SCHEMA_VERSION,
    })
    db.prepare(SQL.upsertLatestState).run({
      key: 'last_successful_refresh',
      value: snapshot.capturedAt,
    })
  })
  transaction()
}

export function getLatestSnapshot(): MetricSnapshot | null {
  const db = getDb()
  const stmt = db.prepare(SQL.getLatestSnapshot)
  const row = stmt.get() as { data?: string } | undefined
  if (!row?.data) return null
  return JSON.parse(row.data) as MetricSnapshot
}

export function listSnapshots(limit = 10, offset = 0): SnapshotRow[] {
  const db = getDb()
  const stmt = db.prepare(SQL.listSnapshots)
  const rows = stmt.all({ limit: limit, offset: offset }) as SnapshotRow[]
  return rows
}

export function insertAggregate(
  id: string,
  type: AggregateType,
  periodStart: string,
  periodEnd: string,
  data: unknown,
  snapshotId: string,
): void {
  const db = getDb()
  db.prepare(SQL.insertAggregate).run({
    id: id,
    type: type,
    periodStart: periodStart,
    periodEnd: periodEnd,
    data: JSON.stringify(data),
    snapshotId: snapshotId,
  })
}

export function getAggregatesByType(type: AggregateType, limit = 10): unknown[] {
  const db = getDb()
  const stmt = db.prepare(SQL.getAggregatesByType)
  const results = stmt.all({ type: type, limit: limit }) as Array<{ data: string }>
  return results.map(row => JSON.parse(row.data))
}

export function setRefreshInProgress(inProgress: boolean): void {
  const db = getDb()
  db.prepare(SQL.upsertLatestState).run({
    key: 'refresh_in_progress',
    value: inProgress ? 'true' : 'false',
  })
}

export function getRefreshInProgress(): boolean {
  const db = getDb()
  const row = db.prepare(SQL.getLatestState).get({ key: 'refresh_in_progress' }) as { value?: unknown } | undefined
  const result = row ? String(row.value) : 'false'
  return result === 'true'
}

export function getLatestState(): LatestState {
  const normalizedSnapshot = getNormalizedSnapshot()
  const blobSnapshot = getLatestSnapshot()
  const snapshot = normalizedSnapshot ?? blobSnapshot
  const db = getDb()

  const lastRefreshRow = db.prepare(SQL.getLatestState).get({ key: 'last_successful_refresh' }) as { value?: unknown } | undefined
  const lastRefresh = lastRefreshRow ? String(lastRefreshRow.value) : null
  const refreshInProgress = getRefreshInProgress()
  const refreshStateRow = db.prepare(SQL.getLatestState).get({ key: REFRESH_STATE_KEY }) as { value?: string } | undefined
  const refreshState = parseRefreshState(refreshStateRow?.value ?? null)

  const STALE_THRESHOLD_MS = getStaleThresholdMs()
  let isStale = true
  let staleReason: string | null = 'no successful refresh has completed yet'
  if (lastRefresh) {
    const elapsed = Date.now() - new Date(lastRefresh).getTime()
    isStale = elapsed > STALE_THRESHOLD_MS
    staleReason = isStale ? 'last successful refresh is older than the stale threshold' : null
  }

  return {
    snapshot,
    viewSnapshot: snapshot,
    selectedRepoKey: 'all',
    lastRefreshAt: lastRefresh,
    lastSuccessfulRefreshAt: lastRefresh,
    refreshInProgress,
    isStale,
    staleReason,
    pollerEnabled: getBooleanEnv(process.env, 'SECRET_HOUSE_POLLER_ENABLED', 'METRICS_POLLER_ENABLED'),
    refreshStatus: refreshState.status,
    lastFailureAt: refreshState.lastFailureAt,
    lastSuccessAt: refreshState.lastSuccessAt,
    nextRunAt: refreshState.nextRunAt,
    dashboardWindow: null,
    refreshState,
    diagnostics: buildDiagnostics(refreshState, snapshot),
  }
}

export function setRefreshRunState(record: RefreshRunRecord): void {
  const previous = getRefreshRunState()
  const nextState: RefreshRunState = {
    ...previous,
    status: record.skipped ? 'skipped' : record.success ? 'success' : 'failed',
    lastRunStartedAt: record.startedAt,
    lastRunFinishedAt: record.finishedAt,
    lastSuccessAt: record.success ? record.finishedAt : previous.lastSuccessAt,
    lastFailureAt: record.success ? previous.lastFailureAt : record.finishedAt,
    nextRunAt: null,
    lastError: record.errorSummary,
    durationMs: record.durationMs,
    sourceHealth: buildSourceHealth(
      record.sources,
      record.skipped ? 'skipped' : record.success ? 'success' : 'failed',
      record.errorSummary,
      record.warnings ?? [],
    ),
    runHistory: [record, ...previous.runHistory].slice(0, getRefreshHistoryLimit()),
  }

  saveRefreshState(nextState)
}

export function setRefreshRunStatus(status: RefreshRunStatus, nextRunAt: string | null = null): void {
  const previous = getRefreshRunState()
  saveRefreshState({
    ...previous,
    status,
    nextRunAt,
  })
}

export function getRefreshRunState(): RefreshRunState {
  const db = getDb()
  const row = db.prepare(SQL.getLatestState).get({ key: REFRESH_STATE_KEY }) as { value?: string } | undefined
  return parseRefreshState(row?.value ?? null)
}

export function upsertDailyMetrics(row: DailyMetricsInsert): void {
  const db = getDb()
  db.prepare(SQL.upsertDailyMetrics).run({
    day: row.day,
    repoKey: row.repoKey,
    capturedAt: row.capturedAt,
    source: row.source,
    version: SCHEMA_VERSION,
    reflectsCompleteData: row.reflectsCompleteData ? 1 : 0,
    issuesOpened: row.issuesOpened,
    issuesClosed: row.issuesClosed,
    prsCreated: row.prsCreated,
    prsMerged: row.prsMerged,
    totalCommits: row.totalCommits,
    avgCycleTimeDays: row.avgCycleTimeDays,
    medianCycleTimeDays: row.medianCycleTimeDays,
    p95CycleTimeDays: row.p95CycleTimeDays,
    cycleTimeSampleSize: row.cycleTimeSampleSize,
    ciTotalRuns: row.ciTotalRuns,
    ciPassCount: row.ciPassCount,
    ciFailCount: row.ciFailCount,
    ciPassRate: row.ciPassRate,
    ciAvgDurationMs: row.ciAvgDurationMs,
    totalSessions: row.totalSessions,
    sessionErrorCount: row.sessionErrorCount,
    staleIssues: row.staleIssues,
    stalePrs: row.stalePrs,
    warnings: JSON.stringify(row.warnings),
  })
}

function rowToDailyMetrics(row: Record<string, unknown>): DailyMetricsRow {
  return {
    day: String(row.day),
    repoKey: String(row.repo_key),
    capturedAt: String(row.captured_at),
    source: String(row.source),
    version: Number(row.version),
    reflectsCompleteData: Number(row.reflects_complete_data) === 1,
    issuesOpened: Number(row.issues_opened),
    issuesClosed: Number(row.issues_closed),
    prsCreated: Number(row.prs_created),
    prsMerged: Number(row.prs_merged),
    totalCommits: Number(row.total_commits),
    avgCycleTimeDays: row.avg_cycle_time_days != null ? Number(row.avg_cycle_time_days) : null,
    medianCycleTimeDays: row.median_cycle_time_days != null ? Number(row.median_cycle_time_days) : null,
    p95CycleTimeDays: row.p95_cycle_time_days != null ? Number(row.p95_cycle_time_days) : null,
    cycleTimeSampleSize: Number(row.cycle_time_sample_size),
    ciTotalRuns: Number(row.ci_total_runs),
    ciPassCount: Number(row.ci_pass_count),
    ciFailCount: Number(row.ci_fail_count),
    ciPassRate: row.ci_pass_rate != null ? Number(row.ci_pass_rate) : null,
    ciAvgDurationMs: row.ci_avg_duration_ms != null ? Number(row.ci_avg_duration_ms) : null,
    totalSessions: Number(row.total_sessions),
    sessionErrorCount: Number(row.session_error_count),
    staleIssues: Number(row.stale_issues),
    stalePrs: Number(row.stale_prs),
    warnings: JSON.parse(String(row.warnings)),
    createdAt: String(row.created_at),
  }
}

export function getDailyMetricsRange(fromDay: string, toDay: string): DailyMetricsRow[] {
  return getDailyMetricsRangeForRepo(fromDay, toDay, 'all')
}

export function getDailyMetricsRangeForRepo(fromDay: string, toDay: string, repoKey: string): DailyMetricsRow[] {
  const db = getDb()
  const stmt = db.prepare(SQL.getDailyMetricsRange)
  const rows = stmt.all({ fromDay, toDay, repoKey }) as Record<string, unknown>[]
  return rows.map(rowToDailyMetrics)
}

export function getLatestDailyDay(): string | null {
  const db = getDb()
  const row = db.prepare(`SELECT day FROM daily_metrics ORDER BY day DESC LIMIT 1;`).get() as { day?: unknown } | undefined
  return row ? String(row.day) : null
}

export function getLatestDailyDayForRepo(repoKey: string): string | null {
  const db = getDb()
  const row = db.prepare(`SELECT day FROM daily_metrics WHERE repo_key = ? ORDER BY day DESC LIMIT 1;`).get(repoKey) as { day?: unknown } | undefined
  return row ? String(row.day) : null
}

// ── Normalized source data write helpers ──────────────────────────

function upsertIssuesFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.issues.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertIssue)
  for (const issue of snapshot.issues) {
    stmt.run({
      id: issue.id,
      snapshotId: snapshot.id,
      title: issue.title,
      state: issue.state,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      closedAt: issue.closedAt,
      repo: issue.repo,
      repoKey: issue.repoKey,
      labels: JSON.stringify(issue.labels),
      assignee: issue.assignee,
      milestone: issue.milestone,
      url: issue.url,
    })
  }
}

function upsertPullRequestsFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.pullRequests.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertPullRequest)
  for (const pr of snapshot.pullRequests) {
    stmt.run({
      id: pr.id,
      snapshotId: snapshot.id,
      title: pr.title,
      state: pr.state,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      headSha: pr.headSha,
      mergedAt: pr.mergedAt,
      closedAt: pr.closedAt,
      repo: pr.repo,
      repoKey: pr.repoKey,
      author: pr.author,
      labels: JSON.stringify(pr.labels),
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
      url: pr.url,
      ciStatus: pr.ciStatus,
    })
  }
}

function upsertWorkflowRunsFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.workflowRuns.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertWorkflowRun)
  for (const run of snapshot.workflowRuns) {
    stmt.run({
      id: run.id,
      snapshotId: snapshot.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      headSha: run.headSha,
      repo: run.repo,
      repoKey: run.repoKey,
      branch: run.branch,
      workflowName: run.workflowName,
      url: run.url,
    })
  }
}

function upsertSessionsFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.sessions.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertSession)
  for (const session of snapshot.sessions) {
    stmt.run({
      id: session.id,
      snapshotId: snapshot.id,
      toolName: session.toolName,
      action: session.action,
      timestamp: session.timestamp,
      durationMs: session.durationMs,
      success: session.success ? 1 : 0,
      metadata: JSON.stringify(session.metadata),
    })
  }
}

function upsertRepositoriesFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.repositories.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertRepository)
  for (const repo of snapshot.repositories) {
    stmt.run({
      repoKey: repo.repoKey,
      snapshotId: snapshot.id,
      name: repo.name,
      localPath: repo.localPath,
      remoteUrl: repo.remoteUrl,
      githubOwner: repo.githubOwner,
      githubRepo: repo.githubRepo,
      source: repo.source,
    })
  }
}

function upsertLocalGitReposFromSnapshot(snapshot: MetricSnapshot): void {
  if (snapshot.localGit.length === 0) return
  const db = getDb()
  const stmt = db.prepare(SQL.upsertLocalGitRepo)
  for (const repo of snapshot.localGit) {
    stmt.run({
      repoKey: repo.repoKey,
      snapshotId: snapshot.id,
      source: repo.source,
      path: repo.path,
      repoName: repo.repoName,
      remoteUrl: repo.remoteUrl,
      githubOwner: repo.githubOwner,
      githubRepo: repo.githubRepo,
      defaultBranch: repo.defaultBranch,
      isGitRepo: repo.isGitRepo ? 1 : 0,
      recentCommits: repo.recentCommits,
      authors: JSON.stringify(repo.authors),
      latestCommitAt: repo.latestCommitAt,
      error: repo.error,
    })
  }
}

function upsertAggregatesFromSnapshot(snapshot: MetricSnapshot): void {
  const aggEntries: Array<{ type: AggregateType; data: unknown }> = [
    { type: 'throughput', data: snapshot.aggregates.throughput },
    { type: 'cycleTime', data: snapshot.aggregates.cycleTime },
    { type: 'ci', data: snapshot.aggregates.ci },
    { type: 'staleWork', data: snapshot.aggregates.staleWork },
  ]
  if (snapshot.aggregates.sessionUsage) {
    aggEntries.push({ type: 'sessionUsage', data: snapshot.aggregates.sessionUsage })
  }
  for (const { type, data } of aggEntries) {
    if (data !== null) {
      insertAggregate(
        `${type}-${snapshot.capturedAt}`,
        type,
        snapshot.aggregates.throughput.periodStart,
        snapshot.aggregates.throughput.periodEnd,
        data,
        snapshot.id,
      )
    }
  }
}

function upsertDailyMetricsFromSnapshot(snapshot: MetricSnapshot): void {
  const dailyRows = computeDailyMetrics(snapshot)
  for (const row of dailyRows) {
    upsertDailyMetrics(row)
  }
}

// ── Transactional persistence ──────────────────────────────────────

/**
 * Persist a snapshot and all derived data in a single transaction.
 * If any step fails, the entire transaction rolls back, preserving
 * the previous good dashboard state.
 *
 * Writes the blob snapshot (existing cache/read path), normalized
 * source data rows, aggregates, and daily metrics.
 */
export function persistSnapshot(snapshot: MetricSnapshot): void {
  const db = getDb()
  const transaction = db.transaction(() => {
    // 1. Write blob snapshot (existing cache/read path)
    db.prepare(SQL.insertSnapshot).run({
      id: snapshot.id,
      capturedAt: snapshot.capturedAt,
      data: JSON.stringify(snapshot),
      version: SCHEMA_VERSION,
    })
    db.prepare(SQL.upsertLatestState).run({
      key: 'last_successful_refresh',
      value: snapshot.capturedAt,
    })

    // 2. Write aggregates
    upsertAggregatesFromSnapshot(snapshot)

    // 3. Write normalized source data rows
    upsertIssuesFromSnapshot(snapshot)
    upsertPullRequestsFromSnapshot(snapshot)
    upsertWorkflowRunsFromSnapshot(snapshot)
    upsertSessionsFromSnapshot(snapshot)
    upsertRepositoriesFromSnapshot(snapshot)
    upsertLocalGitReposFromSnapshot(snapshot)

    // 4. Write daily metrics
    upsertDailyMetricsFromSnapshot(snapshot)
  })
  transaction()
}

// ── Normalized source data read helpers ────────────────────────────

function rowToIssueMetric(row: Record<string, unknown>): IssueMetric {
  return {
    id: String(row.id),
    title: String(row.title),
    state: String(row.state) as IssueMetric['state'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    repo: String(row.repo),
    repoKey: String(row.repo_key),
    labels: JSON.parse(String(row.labels)),
    assignee: row.assignee ? String(row.assignee) : null,
    milestone: row.milestone ? String(row.milestone) : null,
    url: String(row.url),
  }
}

function rowToPullRequestMetric(row: Record<string, unknown>): PullRequestMetric {
  return {
    id: String(row.id),
    title: String(row.title),
    state: String(row.state) as PullRequestMetric['state'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    headSha: row.head_sha ? String(row.head_sha) : null,
    mergedAt: row.merged_at ? String(row.merged_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    repo: String(row.repo),
    repoKey: String(row.repo_key),
    author: String(row.author),
    labels: JSON.parse(String(row.labels)),
    additions: row.additions != null ? Number(row.additions) : null,
    deletions: row.deletions != null ? Number(row.deletions) : null,
    changedFiles: row.changed_files != null ? Number(row.changed_files) : null,
    url: String(row.url),
    ciStatus: row.ci_status ? String(row.ci_status) as PullRequestMetric['ciStatus'] : null,
  }
}

function rowToWorkflowRunMetric(row: Record<string, unknown>): WorkflowRunMetric {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as WorkflowRunMetric['status'],
    conclusion: row.conclusion ? String(row.conclusion) as WorkflowRunMetric['conclusion'] : null,
    createdAt: String(row.created_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    headSha: row.head_sha ? String(row.head_sha) : null,
    repo: String(row.repo),
    repoKey: String(row.repo_key),
    branch: String(row.branch),
    workflowName: String(row.workflow_name),
    url: row.url ? String(row.url) : null,
  }
}

function rowToSessionMetric(row: Record<string, unknown>): SessionMetric {
  return {
    id: String(row.id),
    toolName: String(row.tool_name),
    action: String(row.action),
    timestamp: String(row.timestamp),
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    metadata: JSON.parse(String(row.metadata)),
    success: Number(row.success) === 1,
  }
}

function rowToRepositoryIdentity(row: Record<string, unknown>): RepositoryIdentity {
  return {
    repoKey: String(row.repo_key),
    name: String(row.name),
    localPath: row.local_path ? String(row.local_path) : null,
    remoteUrl: row.remote_url ? String(row.remote_url) : null,
    githubOwner: row.github_owner ? String(row.github_owner) : null,
    githubRepo: row.github_repo ? String(row.github_repo) : null,
    source: String(row.source) as RepositoryIdentity['source'],
  }
}

function rowToLocalGitRepoMetric(row: Record<string, unknown>): LocalGitRepoMetric {
  return {
    repoKey: String(row.repo_key),
    source: String(row.source) as LocalGitRepoMetric['source'],
    path: String(row.path),
    repoName: String(row.repo_name),
    remoteUrl: row.remote_url ? String(row.remote_url) : null,
    githubOwner: row.github_owner ? String(row.github_owner) : null,
    githubRepo: row.github_repo ? String(row.github_repo) : null,
    defaultBranch: row.default_branch ? String(row.default_branch) : null,
    isGitRepo: Number(row.is_git_repo) === 1,
    recentCommits: Number(row.recent_commits),
    commitsByDay: {},
    authors: JSON.parse(String(row.authors)),
    latestCommitAt: row.latest_commit_at ? String(row.latest_commit_at) : null,
    error: row.error ? String(row.error) : null,
  }
}

function readAllSourceIssues(): IssueMetric[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourceIssues).all() as Record<string, unknown>[]
  return rows.map(rowToIssueMetric)
}

function readAllSourcePullRequests(): PullRequestMetric[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourcePullRequests).all() as Record<string, unknown>[]
  return rows.map(rowToPullRequestMetric)
}

function readAllSourceWorkflowRuns(): WorkflowRunMetric[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourceWorkflowRuns).all() as Record<string, unknown>[]
  return rows.map(rowToWorkflowRunMetric)
}

function readAllSourceSessions(): SessionMetric[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourceSessions).all() as Record<string, unknown>[]
  return rows.map(rowToSessionMetric)
}

function readAllSourceRepositories(): RepositoryIdentity[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourceRepositories).all() as Record<string, unknown>[]
  return rows.map(rowToRepositoryIdentity)
}

function readAllSourceLocalGit(): LocalGitRepoMetric[] {
  const db = getDb()
  const rows = db.prepare(SQL.getAllSourceLocalGit).all() as Record<string, unknown>[]
  return rows.map(rowToLocalGitRepoMetric)
}

function readAggregatesForSnapshot(snapshotId: string): DashboardAggregates | null {
  const db = getDb()
  const rows = db.prepare(`SELECT type, data, period_start, period_end FROM aggregates WHERE snapshot_id = ?`).all(snapshotId) as Array<{ type: string; data: string; period_start: string; period_end: string }>
  if (rows.length === 0) return null

  let throughput: ThroughputAggregate | null = null
  let cycleTime: CycleTimeAggregate | null = null
  let ci: CIAggregate | null = null
  let staleWork: StaleWorkAggregate | null = null
  let sessionUsage: SessionUsageAggregate | null = null

  for (const row of rows) {
    const data = JSON.parse(row.data)
    switch (row.type) {
      case 'throughput': throughput = data as ThroughputAggregate; break
      case 'cycleTime': cycleTime = data as CycleTimeAggregate; break
      case 'ci': ci = data as CIAggregate; break
      case 'staleWork': staleWork = data as StaleWorkAggregate; break
      case 'sessionUsage': sessionUsage = data as SessionUsageAggregate; break
    }
  }

  if (!throughput || !staleWork) return null

  return {
    throughput,
    cycleTime,
    ci,
    staleWork,
    sessionUsage,
    computedAt: staleWork.asOf,
  }
}

export function hasNormalizedData(snapshotId: string): boolean {
  const db = getDb()
  const row = db.prepare(SQL.countNormalizedRowsForSnapshot).get({ snapshotId }) as Record<string, unknown> | undefined
  if (!row) return false
  const sourceTotal = Number(row.issues) + Number(row.pull_requests) + Number(row.workflow_runs) + Number(row.repositories) + Number(row.local_git)
  if (sourceTotal > 0) return true
  const aggRow = db.prepare(`SELECT COUNT(*) as count FROM aggregates WHERE snapshot_id = ?`).get(snapshotId) as { count: number }
  return aggRow.count > 0
}

export function getNormalizedSnapshot(): MetricSnapshot | null {
  return getNormalizedSnapshotForRepo('all')
}

function filterByRepoKey<T extends { repoKey: string }>(rows: T[], repoKey: string): T[] {
  if (repoKey === 'all') return rows
  return rows.filter(row => row.repoKey === repoKey)
}

export function getNormalizedSnapshotForRepo(repoKey: string): MetricSnapshot | null {
  const db = getDb()
  const snapRow = db.prepare(SQL.getLatestSnapshotId).get() as { id?: string; captured_at?: string } | undefined
  if (!snapRow?.id) return null

  const snapshotId = snapRow.id
  const capturedAt = snapRow.captured_at!

  if (!hasNormalizedData(snapshotId)) return null

  const aggregates = readAggregatesForSnapshot(snapshotId)
  if (!aggregates) return null

  const issues = filterByRepoKey(readAllSourceIssues(), repoKey)
  const pullRequests = filterByRepoKey(readAllSourcePullRequests(), repoKey)
  const workflowRuns = filterByRepoKey(readAllSourceWorkflowRuns(), repoKey)
  const sessions = readAllSourceSessions()
  const repositories = filterByRepoKey(readAllSourceRepositories(), repoKey)
  const localGit = filterByRepoKey(readAllSourceLocalGit(), repoKey)

  const metadata = {
    source: 'orchestrated' as const,
    refreshDurationMs: 0,
    partialData: false,
    errors: [] as string[],
  }

  return {
    id: snapshotId,
    capturedAt,
    issues,
    pullRequests,
    workflowRuns,
    repositories,
    sessions,
    localGit,
    errors: [],
    aggregates,
    metadata,
  }
}

// ── Retention / cleanup ────────────────────────────────────────────

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

function daysAgoDay(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export interface RetentionResult {
  snapshotsDeleted: number
  aggregatesDeleted: number
  dailyMetricsDeleted: number
  sessionsDeleted: number
  workflowRunsDeleted: number
}

export function runRetention(env: NodeJS.ProcessEnv = process.env): RetentionResult {
  const db = getDb()
  const retention = getRetentionConfig(env)

  const latestSnap = db.prepare(SQL.getLatestSnapshotId).get() as { id?: string } | undefined
  const latestSnapshotId = latestSnap?.id ?? null

  const snapshotsBefore = daysAgoIso(retention.snapshotsDays)
  const aggregatesBefore = daysAgoIso(retention.snapshotsDays)
  const dailyMetricsBeforeDay = daysAgoDay(retention.dailyMetricsDays)
  const sessionsBefore = daysAgoIso(retention.sessionsDays)
  const workflowRunsBefore = daysAgoIso(retention.workflowRunsDays)

  const transaction = db.transaction(() => {
    let aggregatesDeleted = 0
    let snapshotsDeleted = 0

    if (latestSnapshotId) {
      const aggResult = db.prepare(`
        DELETE FROM aggregates
        WHERE period_end < ? AND snapshot_id != ?
      `).run(aggregatesBefore, latestSnapshotId)
      aggregatesDeleted = aggResult.changes

      const snapResult = db.prepare(`
        DELETE FROM snapshots
        WHERE captured_at < ? AND id != ?
      `).run(snapshotsBefore, latestSnapshotId)
      snapshotsDeleted = snapResult.changes
    } else {
      const aggResult = db.prepare(SQL.deleteAggregatesOlderThan).run({ before: aggregatesBefore })
      aggregatesDeleted = aggResult.changes

      const snapResult = db.prepare(SQL.deleteSnapshotsOlderThan).run({ before: snapshotsBefore })
      snapshotsDeleted = snapResult.changes
    }

    const dailyResult = db.prepare(SQL.deleteDailyMetricsOlderThan).run({ beforeDay: dailyMetricsBeforeDay })
    const sessionsResult = db.prepare(SQL.deleteSessionsOlderThan).run({ before: sessionsBefore })
    const workflowRunsResult = db.prepare(SQL.deleteWorkflowRunsOlderThan).run({ before: workflowRunsBefore })

    return {
      snapshotsDeleted,
      aggregatesDeleted,
      dailyMetricsDeleted: dailyResult.changes,
      sessionsDeleted: sessionsResult.changes,
      workflowRunsDeleted: workflowRunsResult.changes,
    }
  })

  return transaction()
}

function getDb(): Db {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.')
  return _db
}
