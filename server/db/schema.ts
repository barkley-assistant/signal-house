export const SCHEMA_VERSION = 5

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

  createSourceDataTables: `
    CREATE TABLE IF NOT EXISTS source_issues (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      title            TEXT NOT NULL,
      state            TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      closed_at        TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      labels           TEXT NOT NULL DEFAULT '[]',
      assignee         TEXT,
      milestone        TEXT,
      url              TEXT NOT NULL,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_pull_requests (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      title            TEXT NOT NULL,
      state            TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      head_sha         TEXT,
      merged_at        TEXT,
      closed_at        TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      author           TEXT NOT NULL,
      labels           TEXT NOT NULL DEFAULT '[]',
      additions        INTEGER,
      deletions        INTEGER,
      changed_files    INTEGER,
      url              TEXT NOT NULL,
      ci_status        TEXT,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_workflow_runs (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      name             TEXT NOT NULL,
      status           TEXT NOT NULL,
      conclusion       TEXT,
      created_at       TEXT NOT NULL,
      completed_at     TEXT,
      head_sha         TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      branch           TEXT NOT NULL,
      workflow_name    TEXT NOT NULL,
      url              TEXT,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_sessions (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      tool_name        TEXT NOT NULL,
      action           TEXT NOT NULL,
      timestamp        TEXT NOT NULL,
      duration_ms      INTEGER,
      success          INTEGER NOT NULL DEFAULT 1,
      metadata         TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_repositories (
      repo_key       TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      name           TEXT NOT NULL,
      local_path     TEXT,
      remote_url     TEXT,
      github_owner   TEXT,
      github_repo    TEXT,
      source         TEXT NOT NULL DEFAULT 'github',
      PRIMARY KEY (repo_key)
    );

    CREATE TABLE IF NOT EXISTS source_local_git (
      repo_key         TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'local',
      path             TEXT NOT NULL,
      repo_name        TEXT NOT NULL,
      remote_url       TEXT,
      github_owner     TEXT,
      github_repo      TEXT,
      default_branch   TEXT,
      is_git_repo      INTEGER NOT NULL DEFAULT 1,
      recent_commits   INTEGER NOT NULL DEFAULT 0,
      authors          TEXT NOT NULL DEFAULT '[]',
      latest_commit_at TEXT,
      error            TEXT,
      PRIMARY KEY (repo_key)
    );

    CREATE INDEX IF NOT EXISTS idx_source_issues_repo_key
      ON source_issues(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_issues_state
      ON source_issues(state);
    CREATE INDEX IF NOT EXISTS idx_source_pull_requests_repo_key
      ON source_pull_requests(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_pull_requests_state
      ON source_pull_requests(state);
    CREATE INDEX IF NOT EXISTS idx_source_workflow_runs_repo_key
      ON source_workflow_runs(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_workflow_runs_conclusion
      ON source_workflow_runs(conclusion);
    CREATE INDEX IF NOT EXISTS idx_source_sessions_timestamp
      ON source_sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_source_sessions_tool_name
      ON source_sessions(tool_name);
    CREATE INDEX IF NOT EXISTS idx_source_local_git_source
      ON source_local_git(source);
  `,

  dropTables: `
    DROP TABLE IF EXISTS source_local_git;
    DROP TABLE IF EXISTS source_repositories;
    DROP TABLE IF EXISTS source_sessions;
    DROP TABLE IF EXISTS source_workflow_runs;
    DROP TABLE IF EXISTS source_pull_requests;
    DROP TABLE IF EXISTS source_issues;
    DROP TABLE IF EXISTS daily_metrics;
    DROP TABLE IF EXISTS aggregates;
    DROP TABLE IF EXISTS snapshots;
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

    CREATE TABLE IF NOT EXISTS source_issues (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      title            TEXT NOT NULL,
      state            TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      closed_at        TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      labels           TEXT NOT NULL DEFAULT '[]',
      assignee         TEXT,
      milestone        TEXT,
      url              TEXT NOT NULL,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_pull_requests (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      title            TEXT NOT NULL,
      state            TEXT NOT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      head_sha         TEXT,
      merged_at        TEXT,
      closed_at        TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      author           TEXT NOT NULL,
      labels           TEXT NOT NULL DEFAULT '[]',
      additions        INTEGER,
      deletions        INTEGER,
      changed_files    INTEGER,
      url              TEXT NOT NULL,
      ci_status        TEXT,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_workflow_runs (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      name             TEXT NOT NULL,
      status           TEXT NOT NULL,
      conclusion       TEXT,
      created_at       TEXT NOT NULL,
      completed_at     TEXT,
      head_sha         TEXT,
      repo             TEXT NOT NULL,
      repo_key         TEXT NOT NULL,
      branch           TEXT NOT NULL,
      workflow_name    TEXT NOT NULL,
      url              TEXT,
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_sessions (
      id               TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      tool_name        TEXT NOT NULL,
      action           TEXT NOT NULL,
      timestamp        TEXT NOT NULL,
      duration_ms      INTEGER,
      success          INTEGER NOT NULL DEFAULT 1,
      metadata         TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (id)
    );

    CREATE TABLE IF NOT EXISTS source_repositories (
      repo_key         TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      name             TEXT NOT NULL,
      local_path       TEXT,
      remote_url       TEXT,
      github_owner     TEXT,
      github_repo      TEXT,
      source           TEXT NOT NULL DEFAULT 'github',
      PRIMARY KEY (repo_key)
    );

    CREATE TABLE IF NOT EXISTS source_local_git (
      repo_key         TEXT NOT NULL,
      last_snapshot_id TEXT NOT NULL,
      source           TEXT NOT NULL DEFAULT 'local',
      path             TEXT NOT NULL,
      repo_name        TEXT NOT NULL,
      remote_url       TEXT,
      github_owner     TEXT,
      github_repo      TEXT,
      default_branch   TEXT,
      is_git_repo      INTEGER NOT NULL DEFAULT 1,
      recent_commits   INTEGER NOT NULL DEFAULT 0,
      authors          TEXT NOT NULL DEFAULT '[]',
      latest_commit_at TEXT,
      error            TEXT,
      PRIMARY KEY (repo_key)
    );

    CREATE INDEX IF NOT EXISTS idx_source_issues_repo_key
      ON source_issues(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_issues_state
      ON source_issues(state);
    CREATE INDEX IF NOT EXISTS idx_source_pull_requests_repo_key
      ON source_pull_requests(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_pull_requests_state
      ON source_pull_requests(state);
    CREATE INDEX IF NOT EXISTS idx_source_workflow_runs_repo_key
      ON source_workflow_runs(repo_key);
    CREATE INDEX IF NOT EXISTS idx_source_workflow_runs_conclusion
      ON source_workflow_runs(conclusion);
    CREATE INDEX IF NOT EXISTS idx_source_sessions_timestamp
      ON source_sessions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_source_sessions_tool_name
      ON source_sessions(tool_name);
    CREATE INDEX IF NOT EXISTS idx_source_local_git_source
      ON source_local_git(source);
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

  deleteDailyMetricsOlderThan: `
    DELETE FROM daily_metrics
    WHERE day < @beforeDay;
  `,

  deleteSessionsOlderThan: `
    DELETE FROM source_sessions
    WHERE timestamp < @before;
  `,

  deleteWorkflowRunsOlderThan: `
    DELETE FROM source_workflow_runs
    WHERE created_at < @before;
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

  upsertIssue: `
    INSERT INTO source_issues (id, last_snapshot_id, title, state, created_at, updated_at, closed_at, repo, repo_key, labels, assignee, milestone, url)
    VALUES (@id, @snapshotId, @title, @state, @createdAt, @updatedAt, @closedAt, @repo, @repoKey, @labels, @assignee, @milestone, @url)
    ON CONFLICT(id) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      title = excluded.title,
      state = excluded.state,
      updated_at = excluded.updated_at,
      closed_at = excluded.closed_at,
      labels = excluded.labels,
      assignee = excluded.assignee,
      milestone = excluded.milestone;
  `,

  upsertPullRequest: `
    INSERT INTO source_pull_requests (id, last_snapshot_id, title, state, created_at, updated_at, head_sha, merged_at, closed_at, repo, repo_key, author, labels, additions, deletions, changed_files, url, ci_status)
    VALUES (@id, @snapshotId, @title, @state, @createdAt, @updatedAt, @headSha, @mergedAt, @closedAt, @repo, @repoKey, @author, @labels, @additions, @deletions, @changedFiles, @url, @ciStatus)
    ON CONFLICT(id) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      title = excluded.title,
      state = excluded.state,
      updated_at = excluded.updated_at,
      head_sha = excluded.head_sha,
      merged_at = excluded.merged_at,
      closed_at = excluded.closed_at,
      author = excluded.author,
      labels = excluded.labels,
      additions = excluded.additions,
      deletions = excluded.deletions,
      changed_files = excluded.changed_files,
      ci_status = excluded.ci_status;
  `,

  upsertWorkflowRun: `
    INSERT INTO source_workflow_runs (id, last_snapshot_id, name, status, conclusion, created_at, completed_at, head_sha, repo, repo_key, branch, workflow_name, url)
    VALUES (@id, @snapshotId, @name, @status, @conclusion, @createdAt, @completedAt, @headSha, @repo, @repoKey, @branch, @workflowName, @url)
    ON CONFLICT(id) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      name = excluded.name,
      status = excluded.status,
      conclusion = excluded.conclusion,
      completed_at = excluded.completed_at,
      branch = excluded.branch,
      url = excluded.url;
  `,

  upsertSession: `
    INSERT INTO source_sessions (id, last_snapshot_id, tool_name, action, timestamp, duration_ms, success, metadata)
    VALUES (@id, @snapshotId, @toolName, @action, @timestamp, @durationMs, @success, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      tool_name = excluded.tool_name,
      action = excluded.action,
      timestamp = excluded.timestamp,
      duration_ms = excluded.duration_ms,
      success = excluded.success,
      metadata = excluded.metadata;
  `,

  upsertRepository: `
    INSERT INTO source_repositories (repo_key, last_snapshot_id, name, local_path, remote_url, github_owner, github_repo, source)
    VALUES (@repoKey, @snapshotId, @name, @localPath, @remoteUrl, @githubOwner, @githubRepo, @source)
    ON CONFLICT(repo_key) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      name = excluded.name,
      local_path = excluded.local_path,
      remote_url = excluded.remote_url,
      github_owner = excluded.github_owner,
      github_repo = excluded.github_repo,
      source = excluded.source;
  `,

  upsertLocalGitRepo: `
    INSERT INTO source_local_git (repo_key, last_snapshot_id, source, path, repo_name, remote_url, github_owner, github_repo, default_branch, is_git_repo, recent_commits, authors, latest_commit_at, error)
    VALUES (@repoKey, @snapshotId, @source, @path, @repoName, @remoteUrl, @githubOwner, @githubRepo, @defaultBranch, @isGitRepo, @recentCommits, @authors, @latestCommitAt, @error)
    ON CONFLICT(repo_key) DO UPDATE SET
      last_snapshot_id = excluded.last_snapshot_id,
      source = excluded.source,
      path = excluded.path,
      repo_name = excluded.repo_name,
      remote_url = excluded.remote_url,
      github_owner = excluded.github_owner,
      github_repo = excluded.github_repo,
      default_branch = excluded.default_branch,
      is_git_repo = excluded.is_git_repo,
      recent_commits = excluded.recent_commits,
      authors = excluded.authors,
      latest_commit_at = excluded.latest_commit_at,
      error = excluded.error;
  `,

  getAllSourceIssues: `
    SELECT * FROM source_issues ORDER BY created_at DESC;
  `,

  getAllSourcePullRequests: `
    SELECT * FROM source_pull_requests ORDER BY created_at DESC;
  `,

  getAllSourceWorkflowRuns: `
    SELECT * FROM source_workflow_runs ORDER BY created_at DESC;
  `,

  getAllSourceSessions: `
    SELECT * FROM source_sessions ORDER BY timestamp DESC;
  `,

  getAllSourceRepositories: `
    SELECT * FROM source_repositories ORDER BY repo_key;
  `,

  getAllSourceLocalGit: `
    SELECT * FROM source_local_git ORDER BY repo_key;
  `,

  getLatestSnapshotId: `
    SELECT id, captured_at FROM snapshots ORDER BY captured_at DESC LIMIT 1;
  `,

  countNormalizedRowsForSnapshot: `
    SELECT
      (SELECT COUNT(*) FROM source_issues WHERE last_snapshot_id = @snapshotId) as issues,
      (SELECT COUNT(*) FROM source_pull_requests WHERE last_snapshot_id = @snapshotId) as pull_requests,
      (SELECT COUNT(*) FROM source_workflow_runs WHERE last_snapshot_id = @snapshotId) as workflow_runs,
      (SELECT COUNT(*) FROM source_repositories WHERE last_snapshot_id = @snapshotId) as repositories,
      (SELECT COUNT(*) FROM source_local_git WHERE last_snapshot_id = @snapshotId) as local_git;
  `,

}

export type QueryName = keyof typeof SQL
