# Engineering Metrics Dashboard

Live operator dashboard for Clawd engineering health.

## What this is

This project is a small internal dashboard that shows whether engineering work is flowing, where it is getting stuck, and whether the toolchain is behaving itself.

It is for the person running Clawd day to day, not for end users.

## What problem it solves

The goal is to replace guesswork with a fast at-a-glance view of:

- task throughput
- open vs completed work
- PR creation and merge flow
- cycle time and stale work
- CI / check failures
- repository activity
- tool and session usage
- recent errors or warnings

The dashboard should answer one blunt question: is Clawd healthy and improving, or is work quietly piling up?

## Proposed V1 scope

V1 should be a single dashboard with:

- a top-level health summary
- a few clear trend charts
- a compact table of blocked or stale work
- recent CI / check outcomes
- recent tool or session usage
- empty, loading, and error states that are obvious and honest

V1 should not try to be a full observability platform.

## Stack choice

Recommended stack:

- **Nuxt 3**
- **Vue 3**
- **TypeScript**
- **Nuxt UI**
- **Pinia**
- **ECharts** or another lightweight chart library
- **SQLite** for local cached metric snapshots

### Why this stack

Nuxt gives us a clean full-stack structure, good dev ergonomics, and an easy path from local-only app to a simple deployed service later.

Vue fits a dashboard UI well and keeps the component model straightforward.

Nuxt UI is a good trade here because it gives a polished operator-style interface quickly without needing to assemble every card, table, dialog, and state treatment by hand.

That is the main reason to use a framework here: not because it is trendy, but because it shortens the path to a good-looking, usable dashboard.

## UI framework choice

Use **Nuxt UI** for V1.

Why:

- it is fast to ship with
- it already suits dense admin / dashboard layouts
- it reduces design drift
- it should get us to a serious operator look faster than plain Tailwind-only assembly

If the dashboard later needs highly custom visualization work, the data layer should already be isolated enough that the UI can evolve without reworking the whole app.

## Likely data sources

V1 should use data we can realistically get without inventing a new telemetry platform first:

- GitHub issues
- GitHub pull requests
- GitHub Actions / check runs
- local git history from the repos on disk
- local OpenCode / OpenClaw session metadata if available
- local logs if they are easy to access

If a metric is not available yet, the work should create an instrumentation issue rather than pretending the data exists.

## Proposed architecture

Suggested shape:

- Nuxt server routes collect and cache metrics
- a small local SQLite store keeps snapshots and latest aggregates
- the frontend reads from local API routes only
- refresh logic is explicit and predictable
- data collection can be triggered on demand and later scheduled

This keeps the dashboard simple, inspectable, and easy to run on the machine that hosts Clawd.

## Local development

### Prerequisites

- **Node.js 18+** and **npm** (or **pnpm** if preferred)
- **OpenCode CLI** (for session usage metrics — optional, falls back gracefully)

### Install and run

```bash
# Install dependencies
npm install

# Start the dev server (bound to 0.0.0.0 for LAN access)
npm run dev
```

The `--host 0.0.0.0` flag is set in `package.json` so the dev server is reachable from other devices on the same network.

### Expected URLs

| Location | URL |
|----------|-----|
| Local machine | `http://localhost:3000` |
| LAN (other device) | `http://<host-lan-ip>:3000` |

Find the host LAN IP with:

```bash
# Linux
hostname -I | awk '{print $1}'

# macOS
ipconfig getifaddr en0
```

### Configuring data sources

Set these environment variables before starting the dev server:

```bash
# Required for GitHub data collection
export GITHUB_TOKEN=ghp_your_token_here
export GITHUB_OWNER=your-org-or-user
export GITHUB_REPO=your-repo

# Optional: Local git repos (comma-separated paths)
export GIT_REPOS=/path/to/repo1,/path/to/repo2

# Optional: Session / OpenCode CLI metrics
# Resolved in order: config.opencodeBin > OPENCODE_BIN > $PATH 'opencode' > $HOME/.opencode/bin/opencode > fallback path > config.opencodeCommand > OPENCODE_COMMAND
# OPENCODE_COMMAND and config.opencodeCommand are compatibility-only fallbacks.
# The collector runs `opencode stats --days <period>` and parses the overview + tool usage tables.
export OPENCODE_BIN=
export OPENCODE_COMMAND=opencode
export SESSIONS_PERIOD_DAYS=30
```

Create a `.env` file in the project root to persist these:

```bash
GITHUB_TOKEN=ghp_your_token_here
GITHUB_OWNER=your-org-or-user
GITHUB_REPO=your-repo
GIT_REPOS=/path/to/repo1,/path/to/repo2
OPENCODE_BIN=
OPENCODE_COMMAND=opencode # compatibility fallback only
SESSIONS_PERIOD_DAYS=30
```

### Manual data refresh

Once the dashboard is running, click the **Refresh** button in the top-right corner to trigger data collection from all configured sources. The dashboard continues showing cached data while the refresh runs in the background. If a refresh is already in progress, subsequent requests are rejected until it completes.

GitHub rate limits apply. Cached data is kept and displayed even when GitHub is slow or unreachable, with a "stale data" indicator when the cache is older than 15 minutes.

### Firewall note

If the OS firewall blocks port `3000`, allow LAN access for that port:

```bash
# Linux (iptables)
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT

# Linux (firewalld)
sudo firewall-cmd --add-port=3000/tcp
```

### Local verification

Run the same commands the CI workflow uses:

```bash
# Install dependencies from the lockfile
npm ci

# Generate Nuxt build and tsconfig artifacts
npm exec nuxi prepare

# Run the test suite
npm test

# TypeScript type check
npm run typecheck

# Production build
npm run build
```

## Daily metrics persistence

When a refresh completes, the orchestrator computes per-day metric rollups from the raw source data and persists them into the `daily_metrics` table.

### Schema

Each row is keyed by a single calendar day (`YYYY-MM-DD` UTC) and stores aggregate-level numeric rollups:

| Column | Type | Description |
|--------|------|-------------|
| `day` | TEXT PK | Calendar day in `YYYY-MM-DD` UTC |
| `captured_at` | TEXT | ISO 8601 timestamp of the refresh that produced this row |
| `source` | TEXT | Data source identifier (e.g. `orchestrated`) |
| `version` | INTEGER | Schema version for future migrations |
| `reflects_complete_data` | INTEGER | `1` if no collector errors occurred |
| `issues_opened` / `issues_closed` | INTEGER | Per-day issue throughput |
| `prs_created` / `prs_merged` | INTEGER | Per-day PR throughput |
| `total_commits` | INTEGER | Sum of recent commits across all local git repos |
| `avg_cycle_time_days` / `median_cycle_time_days` / `p95_cycle_time_days` | REAL | Cycle time statistics |
| `cycle_time_sample_size` | INTEGER | Sample size for cycle time stats |
| `ci_total_runs` / `ci_pass_count` / `ci_fail_count` | INTEGER | Per-day CI outcome counts |
| `ci_pass_rate` | REAL | `pass / total` |
| `ci_avg_duration_ms` | REAL | Average CI run duration |
| `total_sessions` / `session_error_count` | INTEGER | Per-day session counts |
| `stale_issues` / `stale_prs` | INTEGER | Stale work snapshot |
| `warnings` | TEXT | JSON array of warning strings |

### Behaviour

- **Same-day overwrite**: Inserting a row for an existing day replaces the previous record (upsert-by-day).
- **Historical preservation**: Days from earlier calendar dates are never modified by a new refresh.
- **Missing days**: Days with no data are omitted from results — no zero-filled rows are returned.
- **Range query**: `getDailyMetricsRange(fromDay, toDay)` returns rows in descending day order.

### Local verification

```bash
# Run the full test suite (includes daily metrics tests)
npm test

# TypeScript type check
npm run typecheck

# Production build
npm run build
```


### `/api/state` 28-day contract

`GET /api/state` keeps the existing snapshot and refresh metadata, and now adds `dashboardWindow` for the rolling 28-day dashboard view.

- `dashboardWindow.startDay` and `dashboardWindow.endDay` are UTC `YYYY-MM-DD` keys.
- `dashboardWindow.days` is normalized for chart consumption in ascending day order.
- Missing days stay explicit with `isGap: true` and `metrics: null`.
- `dashboardWindow.cards` contains the 28-day card-ready summaries for throughput, cycle time, CI, stale work, and session usage.
- `dashboardWindow.coverage` exposes gap and warning status so the UI can stay honest about partial data.
- `dashboardWindow.warnings` merges source warnings with a concise missing-day warning when gaps exist.

### 28-day regression coverage expectations

The 28-day dashboard work should keep these regressions covered as the data model, API, and UI evolve:

- daily window responses must keep their 28-day shape stable
- missing days must stay explicit instead of being silently filled in
- same-day refresh reruns must upsert today's data without rewriting earlier days
- refresh-in-progress and refresh failure states must still clear cleanly
- charts and summary cards must keep reading the 28-day period honestly on wider and narrower screens

## Data sync and ingestion

For V1, keep ingestion local and simple:

- refresh from GitHub on demand
- optionally add a timer later for periodic refresh
- cache responses locally so the UI still works when GitHub is slow or rate-limited
- keep the latest fetched snapshot available even if a refresh fails

No Docker Compose is needed for V1 unless a local SQLite helper or sidecar becomes necessary later. That would add complexity without enough payoff right now.

## Known limitations

V1 will not be a complete engineering analytics platform.

It will not yet do:

- alerting
- multi-team access control
- forecasting
- deployment tracking
- deep drill-down pages
- perfect cross-repo instrumentation

Some useful metrics will stay approximate until the underlying tooling emits better events.

## Suggested first implementation issue

Start with the project scaffold and metric model:

- Nuxt app skeleton
- basic layout and shell
- shared metric types
- local cached data shape
- placeholder data sources
- README-backed run instructions

That gives us a stable base before wiring in GitHub ingestion.
