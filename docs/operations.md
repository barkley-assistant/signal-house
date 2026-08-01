# Signal House — operator manual (V2)

This is the file you open when signal-house is broken, when you're
configuring it, or when you're trying to remember how a piece of it
works. Architecture deep-dive lives in
[`docs/architecture.md`](architecture.md). Visual rules live in
[`docs/design-system.md`](design-system.md).

If you only remember three things:

1. **It's one Bun process.** `bun run dev` starts everything on port
   3000 (or the next free port). `bun run start` runs the built
   bundle (default port 8999).
2. **The env file lives at `~/.config/signal-house/.env`** in
   production; `.env` in the repo root for dev. `.env.example` is the
   source of truth for every key.
3. **The database is fresh V2** at `~/.local/share/signal-house-v2/`.
   If the guard refuses to open a database, it's a V1 database —
   that's deliberate. It will never migrate it.

## Quick start

```bash
bun install
bun run dev        # dev server, LAN-bound, hot reload (web + server)
bun run check      # typecheck + lint + tests + build
bun run start      # production bundle (build first)
```

## Configuration

All keys are `SECRET_HOUSE_*`; a small set of legacy aliases
(`GITHUB_TOKEN`, `GIT_REPOS`, …) still resolves. `.env.example`
documents every key. The important ones:

| Key | Default | Meaning |
|-----|---------|---------|
| `SECRET_HOUSE_ACCESS_PASSWORD` | empty | set → Basic auth enabled |
| `SECRET_HOUSE_GITHUB_TOKEN` | — | GitHub API token (issues/PRs/CI) |
| `SECRET_HOUSE_GIT_REPOS` / `SECRET_HOUSE_PROJECT_ROOTS` | — | local git inputs |
| `SECRET_HOUSE_HERMES_DB_PATH` | `~/.hermes/state.db` | Hermes usage |
| `SECRET_HOUSE_OPENCODE_DB_PATH` | `~/.local/share/opencode/opencode.db` | OpenCode usage |
| `SECRET_HOUSE_SESSIONS_DIR` | — | optional sessions source |
| `SECRET_HOUSE_POLLER_ENABLED` | `false` | background refresh loop |
| `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` | `false` | privacy opt-in |

Missing sources degrade gracefully: the collector reports
`unavailable` with a warning, the refresh still succeeds, and the
dashboard shows the warning.

## Ports

- Dev: 3000 (wrapper picks the next free port if taken; see
  `.signal-house-dev/port`).
- Production convention: 8999 (systemd unit sets it).
- LAN: the dev wrapper binds `0.0.0.0` and prints the detected LAN
  URL at startup.

## Common fixes

**Dashboard says "web bundle not built".**
Run `bun run build:web` (or `bun run build`).

**Refresh lock is stuck** (every refresh returns 409).
The lock persists across restarts by design (crash-safe). Fix:
`curl -X POST localhost:PORT/api/refresh/reset-lock`, or delete the
`refresh_lock` row from `refresh_meta` in the SQLite database.

**V1 database refused.**
Expected. Point `DB_DIR` at a fresh directory or let the default
V2 path be created.

**WebKit e2e fails to launch.**
System deps missing: `sudo bunx playwright install-deps webkit`
(needs root once per host).

## Troubleshooting loop

1. Check the service log: `journalctl --user -u signal-house -e`.
2. Check the dev log: `.signal-house-dev/log` (server + bundle
   rebuilds are teed there).
3. Hit `/api/health` — liveness without triggering collectors.
4. Hit `/api/state` — full payload; missing data shows as explicit
   `null`/empty, never fabricated zeros.
