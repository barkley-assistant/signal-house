# Signal House — Architecture (V2)

The operator manual lives in [`docs/operations.md`](operations.md).
The visual language lives in [`docs/design-system.md`](design-system.md).
This file is for the audience that wants to *extend* Signal House:
add a collector, follow the data flow, or reason about the privacy
posture. If you're here to fix a live problem, start with operations.md
instead — it's the file that answers "why is the dashboard lying to me".

## Runtime model

**One Bun process. That's the whole model.** `Bun.serve` serves the React
SPA *and* the REST API; the collectors, the optional poller, and SQLite
all live in the same process. There is no separate frontend server, no
WebSocket layer, no external database, no microservices, no serverless
functions. You could run this on a potato and it would shrug.

```
src/server.ts        entry point: config → createApp() → signal handling
src/app.ts           createApp() factory — the testable core
src/config/          env parsing, clamping, redaction, compat aliases
src/shared/          types, dates, math, format, logger, http
src/db/              schema, init (fresh V2 only), client, snapshots,
                     latest-state, refresh-meta, daily-metrics, retention
src/collectors/      explicit registry: github, git, hermes, opencode
src/orchestrator/    refresh runner, aggregates, persisted lock
src/poller/          optional background refresh loop
src/privacy/         fail-closed tri-state resolution
src/metrics/         daily metrics derivation from collector output
src/auth/            constant-time Basic auth
src/api/             build-state, handlers, daily/spend trend
src/diagnostics/     lazy collector health
src/web/             React SPA (React 19, ECharts 6, zustand 5, framer-motion 12)
```

## Data flow

```
Collectors (explicit registry — four sources)
   │  collect(source) → CollectorResult<SourceData>
   ▼
Refresh runner (src/orchestrator/refresh.ts)
   │  concurrency-guarded by a persisted lock (crash-safe)
   │  per-source: upsert latest_state → derive daily metrics → snapshot
   │  history (github excluded — ~850KB/pass, no readers; t_2c7b3493)
   ▼
SQLite (V2 schema, user_version=1)
   │  snapshots / latest_state / daily_metrics / refresh_meta
   ▼
/api/state        → aggregates + attention (privacy-filtered)
/api/daily/spend  → per-day cost/tokens trend
/api/diagnostics  → lazy collector health (privacy-applied)
```

- **Snapshots** are immutable per-source history; **latest_state** is the
  current view the API reads. A failed source keeps its last-good
  `latest_state` — the dashboard shows a partial-data banner instead of
  fabricating numbers.
- **Daily metrics** are derived from collector output (issues opened, PRs
  merged, sessions, cost) and written as `value REAL NULL` rows. A missing
  row means "no activity that day"; a `NULL` cell means "unknown for a day
  that has data". Never synthesized zeros — the dashboard's whole
  personality is "unknown stays unknown".
- **Discovery-driven GitHub:** the git collector runs first and feeds every
  discovered GitHub remote into the GitHub collector, so issues/PRs/CI get
  fetched for all repos under the configured project roots (plus anything
  explicit). Remote URLs are sanitized of credentials before persistence —
  a token-bearing `https://x-access-token:…` remote never reaches the DB.

## Privacy — the fail-closed contract

`RepositoryPrivacy = true | false | null`. Only the GitHub API supplies
real visibility; every other source yields `null`, and `null`/missing is
treated as **private** on every operator surface (attention queue,
diagnostics). The single opt-in is `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS`.

Why: an operator dashboard that leaks private repo names by default is not
a dashboard, it's a data breach with a nice theme. Unknown → private is the
only posture that can't leak. If you add a new classification flag anywhere
in this codebase, the type is `boolean | null`, unknown resolves to the
safe side, and the filter computes the *inverse set* (explicit public only).

## Database

- **Fresh V2 schema only.** The guard refuses to open a database from the
  previous version and leaves the file byte-identical — V2 will not
  migrate, adopt, or casually destroy existing data. This is deliberate;
  V2 is a fresh start.
- Production path: `~/.local/share/signal-house-v2/runtime/.data/metrics.db`
  — a dedicated directory that nothing else writes to.
- WAL mode, foreign keys on, `busy_timeout` set, `user_version = 1`.
- All writes that must be atomic (refresh persistence, schema init) go
  through native `bun:sqlite` transactions.

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/state` | full dashboard payload |
| GET | `/api/daily/spend` | trend for the Agent Spend chart |
| GET | `/api/diagnostics` | lazy; fetched on demand by the UI |
| GET | `/api/health` | liveness only, never triggers collectors |
| POST | `/api/refresh` | manual refresh; 409 when locked |
| POST | `/api/refresh/reset-lock` | clears a stuck lock |

All routes pass through constant-time Basic auth when
`SECRET_HOUSE_ACCESS_PASSWORD` is set. The SPA is served as static files
from `dist/public/` through the same auth'd handler — Bun's HTML-import
bundle objects can't apply per-request auth, so the web bundle is built to
disk instead (that's a documented trade-off, not an accident).

## Time-unit contract

- Hermes `started_at` = epoch **seconds**.
- OpenCode `time_created` = epoch **milliseconds**.

These are never mixed. Each collector converts to UTC date strings at its
own boundary. If you see a chart that's suddenly empty for one source,
suspect a 1000× factor error before anything clever.

## Extending

- **New source:** implement `Collector` in `src/collectors/<name>/`, then
  register it in `src/collectors/index.ts` — one line, no plugin framework,
  no manifests, no dependency injection framework. Adding a source should
  feel like adding a row, not adding a religion.
- **New metric:** add a derivation in `src/metrics/daily.ts`.
- **New API:** add a handler in `src/api/handlers.ts` and a route in
  `src/app.ts`.

## Testing

- `bun test tests/` — 103 unit, integration, and API-contract tests. The
  contract tests boot a real `createApp()` against a temp DB on a random
  port — the exact production code path, zero mocks for the app itself.
- `bunx playwright test` — 18 e2e tests in `e2e/` across desktop Chromium,
  Pixel 7 (Chromium), and iPhone 13 (WebKit).
- Gates before every commit: `bunx tsc --noEmit`, `bunx eslint .`,
  `bun test tests/`, `bunx playwright test`, `bun run build`. All green,
  every time. This is not a suggestion; it's the definition of done.
