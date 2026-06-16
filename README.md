![Signal House logo](https://raw.githubusercontent.com/barkley-clawd/signal-house/refs/heads/main/assets/signal-house-logo.png)

# Signal House

Signal House is a local operator dashboard for Clawd.

It answers one blunt question:

> Is Clawd actually healthy, or just looking busy?

It is not a generic analytics dashboard. It is not a full observability platform. It is a focused workstream health screen for the person running OpenClaw day to day.

Signal House should make it obvious whether work is moving, where it is getting stuck, whether PRs are progressing, whether CI is behaving, and whether the system is collecting useful signal instead of noise.

## What Signal House tracks

Signal House is built around practical operator questions:

* Is work flowing?
* Which issues or PRs are stale?
* Are PRs getting merged?
* Is CI passing or failing?
* Are checks taking longer than expected?
* Are local sessions and tools being used?
* Did the last refresh succeed?
* Is the displayed data fresh, stale, partial, or missing?

If the dashboard cannot answer those questions quickly, it is not doing its job.

## Product scope

Signal House should stay small, sharp, and honest.

It should provide:

* a top-level health summary
* recent throughput trends
* cycle time and stale-work indicators
* a compact blocked/stale work table
* recent CI and check outcomes
* recent OpenCode/OpenClaw session usage where available
* clear refresh status
* clear empty, loading, stale, partial, and error states

It should not become:

* a full observability platform
* a BI dashboard
* a forecasting tool
* a multi-team analytics suite
* a place where questionable metrics are dressed up as truth

If a metric is not available, Signal House should say that plainly. The right fix is to improve instrumentation, not fake confidence.

## Stack

Signal House uses:

* Nuxt 3
* Vue 3
* TypeScript
* ECharts
* SQLite

The stack is deliberately boring where it matters.

Nuxt keeps the server and UI in one place. Vue fits the dashboard UI well. TypeScript keeps the data model honest. SQLite is a simple local store for cached snapshots and refresh state. ECharts is enough for useful trend charts without turning charts into their own project.

## Architecture

Signal House runs as a local Node/Nuxt server.

```text
Nuxt server
├── serves the dashboard UI
├── exposes local API routes
├── collects metrics from configured sources
├── caches latest state in SQLite
├── persists daily metric rollups
├── tracks refresh and source health
└── optionally polls in the background
```

The frontend only reads from local API routes. It does not call GitHub or local tools directly.

The intended shape is:

* server routes collect and cache metrics
* SQLite stores latest snapshots, daily rollups, refresh history, and source health
* the UI reads cached/local state
* manual refresh remains available
* background polling can keep the dashboard warm
* failed refreshes do not wipe the last good data

This keeps the system inspectable and easy to run on the same machine that hosts Clawd.

## Data sources

Signal House uses data that already exists:

* GitHub issues
* GitHub pull requests
* GitHub Actions and check runs
* local git history from configured repos
* local OpenCode/OpenClaw session metadata where available
* local logs where ingestion is simple enough to justify

Data sources should fail gracefully. A missing optional source should produce a clear warning, not take the whole dashboard down.

## Local development

### Prerequisites

* Node.js 18+
* npm
* OpenCode CLI, optional, for session usage metrics

### Install

```bash
npm install
```

### Run the dev server

```bash
npm run dev
```

The dev server is configured to bind to `0.0.0.0`, so it can be reached from other devices on the same LAN.

Expected URLs:

| Location      | URL                         |
| ------------- | --------------------------- |
| Local machine | `http://localhost:3000`     |
| LAN device    | `http://<host-lan-ip>:3000` |

Find the host LAN IP:

```bash
# Linux
hostname -I | awk '{print $1}'

# macOS
ipconfig getifaddr en0
```

## Configuration

Create a `.env` file in the project root.

```bash
SECRET_HOUSE_GITHUB_TOKEN=ghp_your_token_here
SECRET_HOUSE_GITHUB_OWNER=your-org-or-user
SECRET_HOUSE_GITHUB_REPO=your-repo

SECRET_HOUSE_GIT_REPOS=/path/to/repo1,/path/to/repo2

SECRET_HOUSE_OPENCODE_BIN=
SECRET_HOUSE_OPENCODE_COMMAND=opencode
SECRET_HOUSE_SESSIONS_PERIOD_DAYS=30

SECRET_HOUSE_POLLER_ENABLED=true
SECRET_HOUSE_POLL_INTERVAL_SECONDS=300
SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS=5
SECRET_HOUSE_RUN_ON_STARTUP=true
```

### GitHub configuration

| Variable                    | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `SECRET_HOUSE_GITHUB_TOKEN` | GitHub token used for issues, PRs, Actions, and checks |
| `SECRET_HOUSE_GITHUB_OWNER` | GitHub owner or organisation                           |
| `SECRET_HOUSE_GITHUB_REPO`  | GitHub repository name                                 |

### Local git configuration

| Variable                 | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `SECRET_HOUSE_GIT_REPOS` | Comma-separated list of local repo paths to inspect |

### OpenCode session configuration

| Variable                            | Purpose                                       |
| ----------------------------------- | --------------------------------------------- |
| `SECRET_HOUSE_OPENCODE_BIN`         | Optional explicit path to the OpenCode binary |
| `SECRET_HOUSE_OPENCODE_COMMAND`     | Command fallback, usually `opencode`          |
| `SECRET_HOUSE_SESSIONS_PERIOD_DAYS` | Number of days to include in session metrics  |

The OpenCode collector runs:

```bash
opencode stats --days <period>
```

It parses the overview and tool usage output when available. If OpenCode is unavailable, Signal House should continue running and report the missing source clearly.

### Poller configuration

| Variable                                  | Purpose                                            | Default |
| ----------------------------------------- | -------------------------------------------------- | ------- |
| `SECRET_HOUSE_POLLER_ENABLED`             | Enables the background refresh loop                | `false` |
| `SECRET_HOUSE_POLL_INTERVAL_SECONDS`      | Poll interval in seconds (clamped 15–3600)         | `300`   |
| `SECRET_HOUSE_POLL_STARTUP_DELAY_SECONDS` | Delay before the first scheduled run               | `5`     |
| `SECRET_HOUSE_RUN_ON_STARTUP`             | Runs a refresh shortly after server startup        | `true`  |

The poller is intended for a single local server process. Do not run multiple poller-enabled instances against the same local state unless locking is explicitly designed for it.

### Database

| Variable  | Purpose                                                          | Default |
| --------- | ---------------------------------------------------------------- | ------- |
| `DB_DIR`  | Directory for the SQLite database file (no `SECRET_HOUSE_` prefix) | `.data` |

### Legacy env names

Each `SECRET_HOUSE_*` variable has a legacy fallback name for backward compatibility. The preferred name takes precedence when both are set. Legacy names:

`GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GIT_REPOS`, `OPENCODE_BIN`, `OPENCODE_COMMAND`, `SESSIONS_PERIOD_DAYS`, `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_SECONDS`, `METRICS_POLL_STARTUP_DELAY_SECONDS`, `METRICS_RUN_ON_STARTUP`

## Manual refresh

The dashboard includes a manual refresh action.

A manual refresh:

* triggers collection from configured sources
* runs in the background
* keeps showing cached data while collection is running
* rejects duplicate refreshes while another refresh is active
* preserves the last good data if collection fails

GitHub rate limits still apply. If GitHub is slow, unreachable, or rate-limited, Signal House should show the cached snapshot with a clear stale or partial-data warning.

## Background polling

When enabled, the Nuxt server starts a guarded background poller.

The poller:

* waits for the configured startup delay
* optionally runs once on startup
* refreshes at the configured interval
* uses the same refresh runner as manual refresh
* avoids overlapping runs
* records run status and source health
* does not crash the server when a collector fails

Manual refresh and scheduled refresh must not fork into separate logic. They should share the same runner and concurrency guard.

## API shape

The main dashboard endpoint is:

```text
GET /api/state
```

It returns the latest cached dashboard state, refresh metadata, and the rolling 28-day dashboard window.

A manual refresh is triggered via:

```text
POST /api/refresh
```

Returns HTTP 409 if a refresh is already in progress.

The response includes:

* latest snapshot data
* refresh status
* stale-data status
* source health
* dashboard cards
* 28-day chart window
* data coverage and warnings

The dashboard should be able to tell the difference between:

* fresh data
* stale data
* partial data
* no data yet
* refresh in progress
* last refresh failed but cached data exists

## Daily metrics

Signal House persists daily rollups in SQLite.

Each daily metric row is keyed by UTC day:

```text
YYYY-MM-DD
```

Daily rows are used for the rolling dashboard window and trend charts.

Behaviour:

* same-day refreshes overwrite the current day
* earlier days are preserved
* missing days remain explicit gaps
* the API returns chart days in ascending order
* gaps are not silently zero-filled

This matters because zero-filling missing days makes the dashboard lie.

## 28-day dashboard window

`GET /api/state` includes a rolling 28-day dashboard window.

The window contains:

* `startDay`
* `endDay`
* normalized `days`
* summary `cards`
* `coverage`
* warnings

Missing days are represented explicitly with:

```ts
{
  isGap: true,
  metrics: null
}
```

This lets charts and cards stay honest about incomplete data.

## Validation

Run the local verification commands before merging changes:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Use the repo’s actual scripts as the source of truth. If a script is missing or fails for environmental reasons, document that clearly.

## Running as a local service

Signal House is intended to run as a persistent local Node service on the machine that hosts Clawd.

A typical production run is:

```bash
npm ci
npm run build
node .output/server/index.mjs
```

Example systemd unit:

```ini
[Unit]
Description=Signal House
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/openclaw/projects/signal-house
EnvironmentFile=/home/openclaw/projects/signal-house/.env
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=on-failure
RestartSec=5
User=openclaw
Group=openclaw

[Install]
WantedBy=multi-user.target
```

Reload and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now signal-house
sudo systemctl status signal-house
```

View logs:

```bash
journalctl -u signal-house -f
```

## Firewall note

If the dashboard should be available on the LAN, allow port `3000`.

```bash
# firewalld
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

## Design principles

Signal House should be:

* fast to read
* honest about uncertainty
* compact without hiding important failures
* boring operationally
* useful before it is pretty
* specific to Clawd/OpenClaw, not generic

Avoid:

* vanity metrics
* fake precision
* decorative charts
* dashboards that require interpretation archaeology
* abstractions added before the local workflow proves they are needed

## Current boundaries

Signal House does not try to solve everything.

It does not currently provide:

* alerting
* multi-user access control
* deployment tracking
* forecasting
* deep drill-down pages
* complete cross-repo analytics
* perfect session instrumentation
* long-term data warehouse storage

Those can come later if they become useful. For now, Signal House should stay small, local, and operationally sharp.

## Development rule

When adding a metric, ask:

> What decision does this help the operator make?

If the answer is unclear, do not add the metric yet.

## License

Signal House is licensed under the MIT License.

