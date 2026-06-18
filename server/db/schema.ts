export const SCHEMA_VERSION = 4

export const SQL = {

  createTables: `
    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      data        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aggregates (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end   TEXT NOT NULL,
      data         TEXT NOT NULL,
      snapshot_id  TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS latest_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
      ON snapshots(captured_at DESC);

    CREATE INDEX IF NOT EXISTS idx_aggregates_type
      ON aggregates(type);

    CREATE INDEX IF NOT EXISTS idx_aggregates_period
      ON aggregates(period_start, period_end);

    CREATE INDEX IF NOT EXISTS idx_latest_state_key
      ON latest_state(key);

  `,

  dropTables: `
    DROP TABLE IF EXISTS aggregates;
    DROP TABLE IF EXISTS snapshots;
    DROP TABLE IF EXISTS daily_metrics;
    DROP TABLE IF EXISTS latest_state;
  `,

  createStorageTables: `
    CREATE TABLE IF NOT EXISTS snapshots (
      id          TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      data        TEXT NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS aggregates (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end   TEXT NOT NULL,
      data         TEXT NOT NULL,
      snapshot_id  TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS latest_state (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at
      ON snapshots(captured_at DESC);

    CREATE INDEX IF NOT EXISTS idx_aggregates_type
      ON aggregates(type);

    CREATE INDEX IF NOT EXISTS idx_aggregates_period
      ON aggregates(period_start, period_end);

    CREATE INDEX IF NOT EXISTS idx_latest_state_key
      ON latest_state(key);
  `,

  createDailyMetricsV3: `
    CREATE TABLE IF NOT EXISTS daily_metrics_v3 (
      day                   TEXT NOT NULL,
      repo_key              TEXT NOT NULL DEFAULT 'all',
      captured_at           TEXT NOT NULL,
      source                TEXT NOT NULL DEFAULT 'orchestrated',
      version               INTEGER NOT NULL DEFAULT 1,
      reflects_complete_data INTEGER NOT NULL DEFAULT 0,
      issues_opened         INTEGER NOT NULL DEFAULT 0,
      issues_closed         INTEGER NOT NULL DEFAULT 0,
      prs_created           INTEGER NOT NULL DEFAULT 0,
      prs_merged            INTEGER NOT NULL DEFAULT 0,
      total_commits         INTEGER NOT NULL DEFAULT 0,
      avg_cycle_time_days   REAL,
      median_cycle_time_days REAL,
      p95_cycle_time_days   REAL,
      cycle_time_sample_size INTEGER NOT NULL DEFAULT 0,
      ci_total_runs         INTEGER NOT NULL DEFAULT 0,
      ci_pass_count         INTEGER NOT NULL DEFAULT 0,
      ci_fail_count         INTEGER NOT NULL DEFAULT 0,
      ci_pass_rate          REAL,
      ci_avg_duration_ms    REAL,
      total_sessions        INTEGER NOT NULL DEFAULT 0,
      session_error_count   INTEGER NOT NULL DEFAULT 0,
      stale_issues          INTEGER NOT NULL DEFAULT 0,
      stale_prs             INTEGER NOT NULL DEFAULT 0,
      warnings              TEXT NOT NULL DEFAULT '[]',
      created_at            TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (day, repo_key)
    );
  `,

  insertSnapshot: `
    INSERT INTO snapshots (id, captured_at, data, version)
    VALUES (@id, @capturedAt, @data, @version)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      version = excluded.version,
      captured_at = excluded.captured_at;
  `,

  getLatestSnapshot: `
    SELECT * FROM snapshots
    ORDER BY captured_at DESC
    LIMIT 1;
  `,

  listSnapshots: `
    SELECT * FROM snapshots
    ORDER BY captured_at DESC
    LIMIT @limit OFFSET @offset;
  `,

  insertAggregate: `
    INSERT INTO aggregates (id, type, period_start, period_end, data, snapshot_id)
    VALUES (@id, @type, @periodStart, @periodEnd, @data, @snapshotId)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data;
  `,

  getAggregatesByType: `
    SELECT * FROM aggregates
    WHERE type = @type
    ORDER BY period_start DESC
    LIMIT @limit;
  `,

  upsertLatestState: `
    INSERT INTO latest_state (key, value, updated_at)
    VALUES (@key, @value, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at;
  `,

  getLatestState: `
    SELECT value FROM latest_state
    WHERE key = @key;
  `,

  deleteSnapshotsOlderThan: `
    DELETE FROM snapshots
    WHERE captured_at < @before;
  `,

  deleteAggregatesOlderThan: `
    DELETE FROM aggregates
    WHERE period_end < @before;
  `,

  upsertDailyMetrics: `
    INSERT INTO daily_metrics (
      day, repo_key, captured_at, source, version, reflects_complete_data,
      issues_opened, issues_closed, prs_created, prs_merged, total_commits,
      avg_cycle_time_days, median_cycle_time_days, p95_cycle_time_days, cycle_time_sample_size,
      ci_total_runs, ci_pass_count, ci_fail_count, ci_pass_rate, ci_avg_duration_ms,
      total_sessions, session_error_count,
      stale_issues, stale_prs,
      warnings
    ) VALUES (
      @day, @repoKey, @capturedAt, @source, @version, @reflectsCompleteData,
      @issuesOpened, @issuesClosed, @prsCreated, @prsMerged, @totalCommits,
      @avgCycleTimeDays, @medianCycleTimeDays, @p95CycleTimeDays, @cycleTimeSampleSize,
      @ciTotalRuns, @ciPassCount, @ciFailCount, @ciPassRate, @ciAvgDurationMs,
      @totalSessions, @sessionErrorCount,
      @staleIssues, @stalePrs,
      @warnings
    )
    ON CONFLICT(day, repo_key) DO UPDATE SET
      captured_at = excluded.captured_at,
      source = excluded.source,
      version = excluded.version,
      reflects_complete_data = excluded.reflects_complete_data,
      issues_opened = excluded.issues_opened,
      issues_closed = excluded.issues_closed,
      prs_created = excluded.prs_created,
      prs_merged = excluded.prs_merged,
      total_commits = excluded.total_commits,
      avg_cycle_time_days = excluded.avg_cycle_time_days,
      median_cycle_time_days = excluded.median_cycle_time_days,
      p95_cycle_time_days = excluded.p95_cycle_time_days,
      cycle_time_sample_size = excluded.cycle_time_sample_size,
      ci_total_runs = excluded.ci_total_runs,
      ci_pass_count = excluded.ci_pass_count,
      ci_fail_count = excluded.ci_fail_count,
      ci_pass_rate = excluded.ci_pass_rate,
      ci_avg_duration_ms = excluded.ci_avg_duration_ms,
      total_sessions = excluded.total_sessions,
      session_error_count = excluded.session_error_count,
      stale_issues = excluded.stale_issues,
      stale_prs = excluded.stale_prs,
      warnings = excluded.warnings;
  `,

  getDailyMetricsRange: `
    SELECT * FROM daily_metrics
    WHERE day >= @fromDay AND day <= @toDay
      AND repo_key = COALESCE(@repoKey, repo_key)
    ORDER BY day DESC;
  `,

  getLatestDailyDay: `
    SELECT day FROM daily_metrics
    WHERE repo_key = COALESCE(@repoKey, repo_key)
    ORDER BY day DESC
    LIMIT 1;
  `,

}

export type QueryName = keyof typeof SQL
