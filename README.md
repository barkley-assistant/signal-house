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

Install and run:

```bash
pnpm install
pnpm dev --host 0.0.0.0
```

Expected local URL:

```text
http://localhost:3000
```

Expected LAN URL pattern:

```text
http://<host-lan-ip>:3000
```

The `--host 0.0.0.0` binding matters so the dashboard is reachable from another device on the same network.

## Local-network access plan

The dashboard should be easy to view from a laptop, phone, or tablet on the same LAN as the machine running Clawd.

Recommended setup for V1:

- bind the dev server to `0.0.0.0`
- keep the frontend and backend on the same origin
- avoid CORS complexity
- print the host LAN address in the README or app header once the app exists

Firewall note:

- if the OS firewall blocks port `3000`, allow local LAN access for that port

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
