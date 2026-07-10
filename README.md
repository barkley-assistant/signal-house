# Signal House

Signal House is a local operator dashboard for AI coding agents. It answers one practical question: is work actually healthy, or just looking busy?

It is not a generic analytics platform. It is a small local dashboard for workstream health, stale work, PR progress, CI status, refresh health, and local session usage where available.

![Signal House logo](https://raw.githubusercontent.com/barkley-assistant/signal-house/refs/heads/main/assets/signal-house-logo.png)

## What It Tracks

Signal House is built around operator questions:

* Is work flowing?
* Are issues or PRs stale?
* Are PRs getting merged?
* Is CI passing or failing?
* Are local AI coding sessions being used?
* Did the last refresh succeed?
* Is displayed data fresh, stale, partial, or missing?

If a metric is unavailable, Signal House should say that plainly. The right fix is better instrumentation, not fake confidence.

## Stack

| Layer | Technology | Directory |
| --- | --- | --- |
| Dashboard UI | Next.js 16, React 19, TypeScript | `frontend/` |
| Styling | Tailwind CSS 4, shadcn/ui | `frontend/` |
| State | Zustand | `frontend/` |
| Charts | ECharts | `frontend/` |
| Animation | Framer Motion | `frontend/` |
| Backend / DB | Node.js, TypeScript, better-sqlite3 | `server/` |
| Data collectors | GitHub API, git, OpenCode CLI, Hermes Agent | `server/lib/` |
| Database | SQLite | `.data/metrics.db` |

Backend modules in `server/db` and `server/lib` are imported by Next.js API routes. Everything runs in one local Node process.

## Architecture

```text
Signal House daemon
├── serves the Next.js dashboard UI
├── exposes local API routes
├── owns the local SQLite database
├── starts server plugins from frontend/src/instrumentation.ts
├── runs an optional guarded background poller
├── shares one refresh runner between manual and scheduled refresh
└── rejects overlapping refreshes with a single in-process/DB lock
```

The frontend reads local API routes only. It does not call GitHub, git, OpenCode, or local tools directly.

### Data Flow

```text
GitHub API ───────► collectors ──┐
local git ────────► collectors ──┼──► server/db/client.ts (SQLite)
OpenCode CLI ─────► collectors ──┐
Hermes Agent ─────► collectors ──┘
                                  │
                                  ▼
API routes (Next.js) ───────────► Dashboard UI
```

### Startup Plugins

Server startup hooks live in `server/plugins/`.

* `server/plugins/db.ts` initializes the DB and runs retention cleanup.
* `server/plugins/poller.ts` starts the guarded metrics poller when enabled.
* `server/plugins/index.ts` is the idempotent plugin entrypoint used by `frontend/src/instrumentation.ts`.

The poller and manual refresh use the same refresh runner and concurrency guard.

## Local Development

### Prerequisites

* Node.js 18+
* npm
* OpenCode CLI, optional, for session usage metrics

### Install

```bash
npm install
cd frontend && npm install && cd ..
```

### Run Dev Server

```bash
cd frontend && npm run dev
```

The dev server runs on port `3000` by default. Production examples use port `8999`.

### Build

```bash
npm run build
```

## Configuration

The service reads from `~/.config/signal-house/.env`. Local dev can use a root `.env` file. Start from `.env.example` for the current variable list and safe placeholders.

Runtime defaults are centralized in `server/lib/runtime-config.ts`.

### Common Variables

| Variable | Purpose |
| --- | --- |
| `SECRET_HOUSE_GITHUB_TOKEN` | GitHub token for issues, PRs, Actions, and checks |
| `SECRET_HOUSE_GITHUB_OWNER` | Optional explicit GitHub owner |
| `SECRET_HOUSE_GITHUB_REPO` | Optional explicit GitHub repo |
| `SECRET_HOUSE_GIT_REPOS` | Comma-separated local repo paths |
| `SECRET_HOUSE_PROJECT_ROOTS` | Comma-separated roots for git repo discovery |
| `SECRET_HOUSE_GIT_REPO_GLOBS` | Comma-separated filters for discovered repo names |
| `SECRET_HOUSE_GIT_DISCOVERY_MAX_DEPTH` | Discovery depth, default `3`; `0` means no recursion |
| `SECRET_HOUSE_GIT_EXCLUDE` | Comma-separated directory names to skip |
| `SECRET_HOUSE_SESSIONS_PERIOD_DAYS` | Number of days for session metrics |
| `SECRET_HOUSE_HERMES_DB_PATH` | Path to Hermes Agent state.db, default `~/.hermes/state.db` |
| `DB_DIR` | SQLite database directory, default `.data` |

### Poller Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `SECRET_HOUSE_POLLER_ENABLED` | Enables background refresh loop | `false` |
| `SECRET_HOUSE_POLL_INTERVAL_SECONDS` | Poll interval, clamped 15-3600 seconds | `300` |
| `SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS` | Delay before first scheduled run | `5` |
| `SECRET_HOUSE_RUN_ON_STARTUP` | Runs refresh shortly after startup | `true` |

Run exactly one poller-enabled Signal House daemon per machine.

### Attention Queue

| Variable | Purpose | Default |
| --- | --- | --- |
| `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` | Include issues and PRs from private GitHub repos in the Attention Queue. When `false`, private-repo items are hidden from the queue only; all dashboard stats remain unchanged. | `false` |

### Access Protection

If binding to LAN, enable lightweight HTTP Basic auth:

```bash
SECRET_HOUSE_ACCESS_USERNAME=signal-house
SECRET_HOUSE_ACCESS_PASSWORD=choose-a-long-random-password
```

This protects dashboard pages, API routes, and built-in server assets. It does not provide users, sessions, roles, OAuth, TLS, firewalling, or host protection.

### Legacy Env Names

Preferred `SECRET_HOUSE_*` names take precedence. Legacy fallback names still supported include:

`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GIT_REPOS`, `GIT_REPO_ROOTS`, `GIT_REPO_GLOBS`, `GIT_REPO_MAX_DEPTH`, `GIT_REPO_EXCLUDES`, `SESSIONS_PERIOD_DAYS`, `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_SECONDS`, `METRICS_POLL_STARTUP_DELAY_SECONDS`, `METRICS_RUN_ON_STARTUP`.

## Refresh

Manual and scheduled refresh use the same runner.

* Manual refresh uses `POST /api/refresh`.
* Overlapping refreshes return `409 Conflict`.
* Failed refreshes do not wipe last good dashboard data.
* Stale lock recovery uses `POST /api/refresh/reset-lock`.

The reset-lock endpoint clears only refresh lock state. It does not delete snapshots, daily metrics, source rows, or cached dashboard data.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/state` | Dashboard state, refresh metadata, rolling window |
| `GET` | `/api/diagnostics` | Collector status and discovered repositories |
| `POST` | `/api/refresh` | Start manual refresh |
| `POST` | `/api/refresh/reset-lock` | Clear a stuck refresh lock |

`GET /api/state` includes latest cached snapshot data, refresh status, stale/partial state, source health, dashboard window, summary cards, trends, usage summaries, and data coverage warnings.

## Data Retention

Signal House stores local runtime state in SQLite. Daily metrics are keyed by UTC day (`YYYY-MM-DD`) and are used by rolling dashboard windows and trend charts.

Same-day refreshes overwrite the current day. Earlier days are preserved. Missing days remain explicit gaps instead of being silently zero-filled.

Retention defaults are configured in `server/lib/runtime-config.ts` and exposed in `.env.example`.

## Validation

Run these before merging changes:

```bash
npm test
cd frontend && npm run lint
cd .. && npm run typecheck
npm run build
```

## Production Run

```bash
cd frontend
npm ci
npm run build
npm run start -- --hostname 0.0.0.0 --port 8999
```

If exposing the dashboard on LAN, set `SECRET_HOUSE_ACCESS_PASSWORD` and configure host firewall rules for port `8999`.

## Repo Layout

```text
/
├── server/        Backend modules: DB, collectors, refresh runner, plugins
├── frontend/      Next.js dashboard app
├── types/         Shared TypeScript types
├── utils/         Shared utilities
├── docs/          Project docs
├── skills/        Local agent guidance
├── assets/        Static project assets
└── .data/         Local SQLite runtime data, gitignored
```

## Boundaries

Signal House intentionally does not provide alerting, multi-user access control, deployment tracking, forecasting, deep drill-down pages, complete cross-repo analytics, or long-term warehouse storage.

When adding a metric, ask: what decision does this help the operator make? If the answer is unclear, do not add it yet.
