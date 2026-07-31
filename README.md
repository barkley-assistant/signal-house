# Signal House V2 — Bun-Native Rewrite

Signal House is a local operator dashboard for AI coding agents. It answers one practical question: is work actually healthy, or just looking busy?

It is not a generic analytics platform. It is a small local dashboard for workstream health, stale work, PR progress, CI status, refresh health, and local session usage where available.

![Signal House logo](assets/signal-house-logo.png)

## What's New in V2

- **Bun-native** — single process serves the dashboard, REST API, collectors, poller, and SQLite via `Bun.serve` + `bun:sqlite`. No Node.js, no Next.js, no npm.
- **Fresh schema** — V2 uses its own database at `~/.local/share/signal-house-v2/`; it will never open a V1 database (the guard throws, file untouched).
- **Privacy fail-closed** — `RepositoryPrivacy = true | false | null`; null/missing treated as private on operator surfaces. Only GitHub API supplies real visibility; all others default to private.
- **No WebSockets** — periodic refresh (poller, disabled by default).
- **Explicit collector registry** — adding a source = one line in `src/collectors/index.ts`.

## Quick Start

```bash
# Dev (port 3000, LAN, hot reload)
bun run dev

# Production build
bun run build

# Production run (port 8999)
bun run start
```

## Architecture

```
src/
├── server.ts          # Entry point (Bun.serve + graceful shutdown)
├── app.ts             # createApp() factory (testable, thin entry)
├── config/            # Env parsing, clamping, redaction
├── shared/            # Types, dates, math, format, logger, http
├── db/                # Schema, init, client, snapshots, daily-metrics, retention
├── collectors/        # Explicit registry: github, git, hermes, opencode, sessions
├── orchestrator/      # Refresh runner, aggregates, in-process lock
├── poller/            # Optional background refresh loop
├── privacy/           # Fail-closed tri-state resolution
├── metrics/           # Daily metrics derivation
├── auth/              # Constant-time Basic auth
├── diagnostics/       # Lazy /api/diagnostics
├── api/               # Build-state, handlers, daily/spend trend
└── web/               # React SPA (ECharts, zustand, framer-motion)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Full dashboard payload (privacy-filtered) |
| GET | `/api/daily/spend` | Per-day cost+tokens trend |
| GET | `/api/diagnostics` | Collector health (lazy, privacy-applied) |
| GET | `/api/health` | Lightweight liveness check |
| POST | `/api/refresh` | Manual refresh (concurrency-guarded, 409 if busy) |
| POST | `/api/refresh/reset-lock` | Reset stuck refresh lock |

All endpoints require HTTP Basic auth when `SECRET_HOUSE_ACCESS_PASSWORD` is set.

## Configuration

See `.env.example` for the full list. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_HOUSE_GITHUB_TOKEN` | — | GitHub personal access token |
| `SECRET_HOUSE_HERMES_DB_PATH` | `~/.hermes/state.db` | Hermes Agent state DB |
| `SECRET_HOUSE_ACCESS_PASSWORD` | `""` | Set to enable Basic auth |
| `SECRET_HOUSE_POLLER_ENABLED` | `false` | Background refresh loop |
| `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` | `false` | Show private repo items in attention queue |

## Testing

```bash
# Unit + integration + API contract (bun:test)
bun test

# Playwright e2e (desktop + mobile)
bunx playwright test

# Typecheck
bunx tsc --noEmit

# Lint
bunx eslint .
```

74 unit/integration tests, 12 Playwright e2e tests, TSC clean, ESLint 0 errors.

## Deployment

See `packaging/systemd/signal-house.service` for a systemd user unit.

## License

MIT
