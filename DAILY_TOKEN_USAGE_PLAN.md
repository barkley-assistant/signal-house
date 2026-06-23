# Daily Token Usage & Session Stats Storage — Investigation & Implementation Plan

## A. Current State Assessment

### 1. What Already Exists

There is a **partial, uncommitted** `daily-token-usage` infrastructure scattered across the codebase. None of these files or modifications have ever been committed to git — they exist only as local working-directory changes.

#### Files & Code (all uncommitted)

| File | Status | What it does |
|------|--------|--------------|
| `types/daily-token-usage.ts` | **Untracked** | Defines `DailyTokenUsageRow` and `DailyTokenUsageInsert` interfaces |
| `server/lib/daily-token-usage/collector.ts` | **Untracked** | `collectAndStoreDailyTokenUsage(targetDate?)` — runs `opencode stats --days 1 --models`, parses output, and calls `upsertDailyTokenUsage()` |
| `frontend/src/app/api/daily-token-usage/collect/route.ts` | **Untracked** | POST endpoint that invokes the collector |
| `frontend/src/app/api/daily-token-usage/history/route.ts` | **Untracked** | GET endpoint that queries `getDailyTokenUsageRange(from, to)` |
| `server/db/schema.ts` | **Modified** | Adds `createDailyTokenUsageTable`, `upsertDailyTokenUsage`, `getDailyTokenUsageRange`, `getLatestDailyTokenUsage` SQL constants; changes `dropTables` from `opencode_daily_usage` → `daily_token_usage` |
| `server/db/client.ts` | **Modified** | Adds `upsertDailyTokenUsage()` and `getDailyTokenUsageRange()` helpers; wires `createDailyTokenUsageTable` into `migrate()` |
| `types/index.ts` | **Modified** | Re-exports `DailyTokenUsageRow`, `DailyTokenUsageInsert` |
| `frontend/src/types/index.ts` | **Modified** | Re-exports `DailyTokenUsageRow`, `DailyTokenUsageInsert` |
| `types/opencode.ts` | **Modified** | Removes `TokenUsageInsert` type alias |
| `server/lib/opencode/collector.ts` | **Modified** | Exports `parseTokenUsage()` (was private) so the daily collector can reuse it |

#### Table Schema (from uncommitted `schema.ts`)

```sql
CREATE TABLE IF NOT EXISTS daily_token_usage (
  date             TEXT NOT NULL,
  total_sessions   INTEGER NOT NULL DEFAULT 0,
  total_messages   INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cost       REAL,
  model_usage      TEXT NOT NULL DEFAULT '[]',
  raw_json         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date)
);
```

#### How the Main Pipeline Currently Works

- `server/lib/opencode/collector.ts` — `collectTokenUsageSnapshot()` runs `opencode stats --days 28 --models` and produces a **28-day aggregate** `TokenUsageCollectorResult`.
- `server/lib/orchestrator/index.ts` — `collectTokenUsage()` wraps the above and stores the result as a `tokenUsage` aggregate inside the snapshot, persisted via `persistSnapshot()` → `insertAggregate()`.
- `server/lib/refresh/run-refresh.ts` — The refresh pipeline runs the orchestrator, which collects GitHub, local git, sessions, and token usage in parallel. It does **not** touch `daily_token_usage`.
- `server/lib/poller.ts` — The poller calls `runRefresh()` on a configurable interval (default 5 min). No daily-specific scheduling exists.

#### Daily Metrics Pattern (for reference)

- `server/lib/daily-metrics.ts` — Computes `daily_metrics` rows **from snapshot data** (issues, PRs, workflow runs, sessions, local git commits). It does not make external CLI calls.
- `server/lib/dashboard-state.ts` — Reads `daily_metrics` to build the dashboard window. It has no knowledge of `daily_token_usage`.

### 2. Git History Context

The codebase went through an earlier daily-token-usage phase that was **committed and later removed**:

1. **Commit `51aed1a`** — *"Add daily OpenCode usage snapshots (#115)"* added:
   - `server/lib/opencode-daily/collector.ts`
   - `types/opencode-daily.ts`
   - `opencode_daily_usage` table
2. **Commit `81ad439`** — *"Remove broken daily model usage parsing (#158)"* stripped model-usage parsing from the daily collector.
3. **Commit `6cba5b4`** — *"Refactor OpenCode stats into tokenUsage snapshots"* **deleted** the entire `opencode-daily` module and table, replacing it with the current 28-day `tokenUsage` aggregate stored in the `aggregates` table.

The current uncommitted `daily-token-usage` work appears to be a **post-removal attempt to re-introduce daily storage**, but it was never completed, committed, or wired into any pipeline.

### 3. Is It Usable As-Is?

**No — it needs cleanup and integration.**

- The collector logic is functional but **orphaned** (only reachable via the POST API endpoint).
- There are **zero tests**.
- The schema modifications are **uncommitted** and conflict with the committed `opencode_daily_usage` table that still exists in `schema.ts` on `HEAD`.
- `parseTokenUsage()` was made `export` in `opencode/collector.ts` as a drive-by change to support the daily collector — this is fine but should be verified for side effects.
- The `daily_token_usage` table is created in `migrate()`, but there is **no retention cleanup** for it.
- No frontend page or component consumes the history endpoint.

### 4. Lingering / Dead Code

- The `daily-token-usage` collector is **not wired into the main refresh pipeline**.
- The POST endpoint (`/api/daily-token-usage/collect`) is a standalone trigger with no scheduler calling it.
- The `dropTables` SQL in `schema.ts` (uncommitted version) drops `daily_token_usage`; the committed version drops `opencode_daily_usage`. This is consistent with the rename but confusing because the uncommitted table never existed in production.
- Binary-finding logic is duplicated across three files: `server/lib/opencode/collector.ts`, `server/lib/sessions/collector.ts`, and `server/lib/daily-token-usage/collector.ts`.

---

## B. Cleanup Proposals

### Option B1: Adopt & Clean Up the Uncommitted Work (Recommended)

Since the goal is to persist daily token usage historically, the uncommitted schema and collector are actually a reasonable starting point. The cleanup steps:

1. **Commit or reset the uncommitted changes** so we have a clean base.
2. **Remove the old `opencode_daily_usage` table** references from `schema.ts` (committed `HEAD` still has them). The uncommitted diff already does this, but we need to make it intentional.
3. **Keep the new `daily_token_usage` table** — it adds the `model_usage` JSON column that the old table lacked.
4. **Deduplicate binary discovery** — Extract a shared `findOpencodeBinary()` utility in `server/lib/opencode/collector.ts` (or a new `server/lib/opencode/binary.ts`) and consume it from both the 28-day collector and the daily collector.
5. **Add retention SQL** for `daily_token_usage` in `schema.ts` and wire it into `runRetention()` in `server/db/client.ts`.
6. **Write tests** for `server/lib/daily-token-usage/collector.ts` mirroring the existing `server/lib/opencode/__tests__/collector.test.ts`.
7. **Decide on the `parseTokenUsage` export** — It is reasonable to keep it exported so the daily collector can reuse parsing logic.

### Option B2: Remove Everything and Start Fresh

If we want a completely different schema (e.g., aligning with `daily_metrics_v3`'s per-repo pattern), we could:

1. `git restore` all uncommitted changes.
2. Drop `opencode_daily_usage` from committed `schema.ts` if it is truly unused.
3. Design a new table from scratch.

**Verdict:** Option B1 is better. The uncommitted schema is fine; we just need to integrate, test, and schedule it properly.

---

## C. Implementation Design

### C1. Goal

Store a persistent, day-by-day historical record of OpenCode token/session usage by running `opencode stats --days 1 --models` once per day and saving the result to `daily_token_usage`.

### C2. The `--days 1` Approach vs. Snapshot Data Daily

| Approach | Pros | Cons |
|----------|------|------|
| **`--days 1` daily** | True daily granularity from the source of truth (OpenCode CLI). Matches exactly what the user sees in `opencode stats`. | Requires scheduling. Missing a day = gap. Extra CLI call per day. |
| **Store 28-day snapshot daily** | Reuses existing data. No extra CLI call. | Only gives a rolling 28-day aggregate, not per-day history. |
| **Derive from `source_sessions`** | Uses data we already ingest. | Session records do not contain token counts or model breakdowns. |

**Decision:** Use `--days 1` daily. The 28-day aggregate is already stored in the snapshot; the new requirement is explicitly for per-day history, which only the CLI can provide.

### C3. Where to Integrate Collection

The refresh pipeline runs too frequently (every 5 min) to blindly call `opencode stats --days 1` on every tick. We need a **once-per-day guard**.

#### Recommended Integration Point: `runRefresh()`

After `persistSnapshot()` succeeds in `executeRefresh()` (`server/lib/refresh/run-refresh.ts`), add:

```ts
// After persistSnapshot(snapshot)
await maybeCollectDailyTokenUsage()
```

`maybeCollectDailyTokenUsage()` (lives in `server/lib/daily-token-usage/collector.ts`):

1. Compute `yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); date = yesterday.toISOString().slice(0, 10)`.
2. Query `daily_token_usage` for the latest row.
3. If latest row date < yesterday, run `collectAndStoreDailyTokenUsage(yesterday)`.
4. If the call fails, log a warning but **do not fail the refresh** (token usage is non-critical).

This gives us:
- **Automatic collection** without a separate scheduler.
- **Resilience** — if the server is down for a day, the next refresh will backfill yesterday.
- **No extra infrastructure** — no cron, no new poller.

#### Alternative: Separate Daily Poller

If we want stricter "midnight" semantics, we could add a lightweight daily timer inside `startMetricsPoller()` or a new `startDailyTasks()` function:

```ts
// Runs every hour
if (now.getHours() === 0 && !alreadyCollectedToday) {
  await collectAndStoreDailyTokenUsage()
}
```

**Verdict:** Start with the `runRefresh()` guard. It is simpler, needs no new scheduling code, and naturally backfills. We can add a stricter midnight poller later if needed.

### C4. Schema Decision

**Keep the existing `daily_token_usage` table** from the uncommitted work, with one small addition:

```sql
CREATE TABLE IF NOT EXISTS daily_token_usage (
  date             TEXT NOT NULL,
  total_sessions   INTEGER NOT NULL DEFAULT 0,
  total_messages   INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cost       REAL,
  model_usage      TEXT NOT NULL DEFAULT '[]',
  raw_json         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date)
);
```

Optionally add an index if we expect large date-range queries:
```sql
CREATE INDEX IF NOT EXISTS idx_daily_token_usage_date
  ON daily_token_usage(date DESC);
```

Rationale:
- `date` as single-column PK is correct for daily granularity.
- `model_usage` JSON is needed for per-model breakdowns.
- `raw_json` preserves the raw CLI output for debugging.
- We do not need `source`/`tool_name` columns because this table is exclusively for OpenCode daily stats.

### C5. Cleanup the Committed `opencode_daily_usage` Ghost

On `HEAD` (committed), `schema.ts` still references `opencode_daily_usage`. Since commit `6cba5b4` removed the code that used it but left the SQL behind, we should:

1. In `schema.ts`, replace `DROP TABLE IF EXISTS opencode_daily_usage;` with `DROP TABLE IF EXISTS daily_token_usage;` (the uncommitted diff already does this).
2. Remove `createTokenUsageTable`, `upsertTokenUsage`, `getTokenUsages`, `getLatestTokenUsage` from `schema.ts`.
3. Remove `TokenUsageInsert` from `types/opencode.ts` (the uncommitted diff already does this).
4. Remove `rowToTokenUsage` and any `TokenUsageInsert` references from `server/db/client.ts` (the uncommitted diff already does this).

**Note:** The uncommitted diff essentially performs this cleanup. We just need to verify it is complete and consistent.

---

## D. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Trigger: runRefresh() executes (every 5 min or manual)         │
│  → After persistSnapshot(), call maybeCollectDailyTokenUsage()  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  maybeCollectDailyTokenUsage()                                  │
│  1. Determine "yesterday" date                                  │
│  2. Check DB: do we already have a row for yesterday?           │
│  3. If missing → call collectAndStoreDailyTokenUsage(date)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  collectAndStoreDailyTokenUsage()                               │
│  1. findOpencodeBinary() (shared utility)                       │
│  2. execFileSync(binary, ['stats', '--days', '1', '--models'])  │
│  3. parseTokenUsage(stdout) (reused from opencode/collector)    │
│  4. Build DailyTokenUsageInsert row                             │
│  5. upsertDailyTokenUsage(row)                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Storage: SQLite daily_token_usage table                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Retrieval API                                                  │
│  GET /api/daily-token-usage/history?from=YYYY-MM-DD&to=...      │
│  → getDailyTokenUsageRange(from, to)                            │
│                                                                 │
│  Manual trigger API (optional, keep for debugging)              │
│  POST /api/daily-token-usage/collect                            │
│  → collectAndStoreDailyTokenUsage()                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard Integration (Phase 2)                                │
│  - Extend DashboardWindow with tokenUsageDays[]                 │
│  - Or add a new card: "Daily Token Usage"                       │
│  - Query daily_token_usage for the dashboard window range       │
│  - Merge into buildDashboardWindow() in dashboard-state.ts      │
└─────────────────────────────────────────────────────────────────┘
```

---

## E. Risks & Considerations

### E1. What Happens If `opencode stats` Isn't Available?

- The collector already handles `ENOENT` / `EACCES` gracefully (returns `success: false` with errors).
- In `runRefresh()`, the daily collection should be wrapped in a `try/catch` and treated as **best-effort** — it must never fail the main refresh.
- The dashboard should handle missing days (gaps) the same way it handles missing `daily_metrics` days.

### E2. Retention / Deletion Policy

- `daily_token_usage` rows should be cleaned up in `runRetention()`.
- Suggested default: **365 days** (much longer than `daily_metrics` 90 days, because token usage is harder to reconstruct historically).
- Add to `runtime-config.ts`:
  ```ts
  DEFAULT_RETENTION_DAILY_TOKEN_USAGE_DAYS = 365
  ```
- Add SQL to `schema.ts`:
  ```sql
  deleteDailyTokenUsageOlderThan: `
    DELETE FROM daily_token_usage
    WHERE date < @beforeDay;
  `
  ```
- Wire into `runRetention()` in `client.ts`.

### E3. Schema Migration Considerations

- The `daily_token_usage` table is created with `CREATE TABLE IF NOT EXISTS`, so existing deployments will get it automatically on next `initDb()` → `migrate()`.
- `migrate()` drops and recreates tables when `SCHEMA_VERSION` bumps. If we bump `SCHEMA_VERSION`, we must ensure `daily_token_usage` is re-created after `dropTables` (the uncommitted code already does this).
- There is no production data in `daily_token_usage` (it was never committed), so no data migration is needed.
- The old `opencode_daily_usage` table may exist in some developer databases. The `dropTables` SQL will drop it on the next schema version bump, which is safe.

### E4. Backfilling Gaps

- If the server is offline for multiple days, the `maybeCollectDailyTokenUsage()` guard only backfills **yesterday**.
- **OpenQuestion:** Can `opencode stats --days N` be used to backfill arbitrary past dates? If yes, we could add a backfill script/API. If no, gaps are permanent.
- Recommendation: Document that backfilling is not supported by the CLI, so ensuring the server runs daily is important.

### E5. Timezone / Midnight Semantics

- The current collector defaults to "yesterday" in local server time (`new Date()`). For consistent midnight boundaries, consider using UTC:
  ```ts
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const date = yesterday.toISOString().slice(0, 10) // YYYY-MM-DD in UTC
  ```
- The `runRefresh()` guard means collection happens on the first refresh after midnight (local or UTC), not exactly at 00:00:00.

### E6. Performance

- `opencode stats --days 1 --models` is a fast CLI call (typically < 1s).
- Running it once per day is negligible overhead.
- The guard prevents redundant calls on frequent refreshes.

---

## F. Actionable Task List for Implementer

1. **Consolidate uncommitted changes**
   - Decide whether to `git add` the untracked files or rewrite them fresh.
   - Ensure `schema.ts`, `client.ts`, `types/index.ts`, `frontend/src/types/index.ts`, `types/opencode.ts`, and `server/lib/opencode/collector.ts` changes are coherent.

2. **Extract shared binary finder**
   - Create `server/lib/opencode/binary.ts` with `findOpencodeBinary()`.
   - Update `server/lib/opencode/collector.ts`, `server/lib/sessions/collector.ts`, and `server/lib/daily-token-usage/collector.ts` to use it.

3. **Add retention policy**
   - Add `DEFAULT_RETENTION_DAILY_TOKEN_USAGE_DAYS = 365` to `runtime-config.ts`.
   - Add `deleteDailyTokenUsageOlderThan` SQL to `schema.ts`.
   - Wire deletion into `runRetention()` in `client.ts`.

4. **Wire into refresh pipeline**
   - Add `maybeCollectDailyTokenUsage()` to `server/lib/daily-token-usage/collector.ts`.
   - Call it from `executeRefresh()` in `server/lib/refresh/run-refresh.ts` after `persistSnapshot()`.
   - Ensure failures are logged, not thrown.

5. **Add tests**
   - `server/lib/daily-token-usage/__tests__/collector.test.ts` — test parsing, binary missing, DB upsert.
   - `server/db/__tests__/daily-token-usage.test.ts` — test `upsertDailyTokenUsage`, `getDailyTokenUsageRange`.

6. **Schema version bump**
   - Increment `SCHEMA_VERSION` in `schema.ts` if we want to force table recreation (optional, since `CREATE TABLE IF NOT EXISTS` handles new tables).

7. **Dashboard integration (Phase 2)**
   - Extend `DashboardWindow` in `types/snapshot.ts` with a `tokenUsageDays` field.
   - Update `server/lib/dashboard-state.ts` to query `daily_token_usage` and build summaries.
   - Build frontend UI to display daily token usage trends.
