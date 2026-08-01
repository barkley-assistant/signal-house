# Signal House — architecture (V2)

Operator manual lives in [`docs/operations.md`](operations.md).
Visual rules live in [`docs/design-system.md`](design-system.md).
This file is for the audience that wants to *extend* signal-house:
add a collector, understand the data flow, or reason about the
privacy posture.

## Runtime model

**One Bun process.** `Bun.serve` serves the React SPA and the REST
API; the collectors, the optional poller, and SQLite all live in the
same process. There is no separate frontend server, no WebSocket
layer, and no external database.

```
src/server.ts        entry point: config → createApp() → signals
src/app.ts           createApp() factory — the testable core
src/config/          env parsing, clamping, redaction, legacy aliases
src/shared/          types, dates, math, format, logger, http
src/db/              schema, init (fresh V2 only), client, snapshots,
                     latest-state, refresh-meta, daily-metrics, retention
src/collectors/      explicit registry: github, git, hermes, opencode,
                     sessions (one line per source)
src/orchestrator/    refresh runner, aggregates, persisted lock
src/poller/          optional background refresh loop
src/privacy/         fail-closed tri-state resolution
src/metrics/         daily metrics derivation from collector output
src/auth/            constant-time Basic auth
src/api/             build-state, handlers, daily/spend trend
src/diagnostics/     lazy collector health
src/web/             React SPA (React 19, ECharts, zustand, framer-motion)
```

## Data flow

```
Collectors (explicit registry)
   │  collect(source) → CollectorResult<SourceData>
   ▼
Refresh runner (src/orchestrator/refresh.ts)
   │  concurrency-guarded by persisted lock
   │  per-source: write snapshot → upsert latest_state → derive daily metrics
   ▼
SQLite (V2 schema, user_version=1)
   │  snapshots / latest_state / daily_metrics / refresh_meta
   ▼
/api/state        → aggregates + attention (privacy-filtered)
/api/daily/spend  → per-day cost/tokens trend
/api/diagnostics  → lazy collector health (privacy-applied)
```

- **Snapshots** are immutable per-source history; **latest_state** is
  the current view used by the API.
- **Daily metrics** are derived from collector output (issues opened,
  PRs merged, sessions, cost) and written as `value REAL NULL` rows —
  a missing row means no activity, a `NULL` cell means unknown. Never
  synthesized zeros.
- **Refresh semantics:** a failed source keeps its last-good
  `latest_state`; the dashboard shows partial-data banners instead of
  fabricating numbers.

## Privacy

`RepositoryPrivacy = true | false | null`. Only the GitHub API
supplies real visibility; every other source yields `null`, and
`null`/missing is treated as **private** on operator surfaces
(attention queue, diagnostics). Opt-in via
`SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS`.

## Database

- Fresh V2 schema only. The guard refuses to open a V1-shaped
  database (the file is left untouched).
- Production path: `~/.local/share/signal-house-v2/metrics.db`
  (never the V1 `signal-house/runtime` path).
- WAL mode, foreign keys on, `user_version = 1`.

## API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/state` | full dashboard payload |
| GET | `/api/daily/spend` | trend for the Agent Spend chart |
| GET | `/api/diagnostics` | lazy; fetched on demand by the UI |
| GET | `/api/health` | liveness only, never triggers collectors |
| POST | `/api/refresh` | manual refresh; 409 when locked |
| POST | `/api/refresh/reset-lock` | clears a stuck lock |

All routes pass through constant-time Basic auth when
`SECRET_HOUSE_ACCESS_PASSWORD` is set. The SPA is served as static
files from `dist/public/` through the same auth'd handler (Bun's
HTML-import bundles cannot apply per-request auth).

## Time-unit contract

- Hermes `started_at` = epoch **seconds**.
- OpenCode `time_created` = epoch **milliseconds**.
These are never mixed; each collector converts to UTC date strings at
its boundary.

## Extending

- **New source:** implement `Collector` in `src/collectors/<name>/`,
  register it in `src/collectors/index.ts` (one line). No plugin
  framework, no manifests.
- **New metric:** add a derivation in `src/metrics/daily.ts`.
- **New API:** add a handler in `src/api/handlers.ts` and a route in
  `src/app.ts`.

## Testing

- `bun test tests/` — unit, integration, and API contract (boots a
  real `createApp()` against a temp DB on a random port).
- `bunx playwright test` — e2e in `e2e/` across Chromium (desktop +
  Pixel 7) and WebKit (iPhone 13).
