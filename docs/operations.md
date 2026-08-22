# Signal House — Operator Manual (V2)

This is the file you open when Signal House is broken, when you're
configuring it, or when you're trying to remember how a piece of it works.
The architecture deep-dive lives in [`docs/architecture.md`](architecture.md).
The visual rules live in [`docs/design-system.md`](design-system.md).

If you only remember three things:

1. **It's one Bun process.** `bun run dev` starts everything on port 3000
   (or the next free port) and prints the LAN URL. Production runs the
   same code on port 8999 behind a systemd user service.
2. **The env file lives at `~/.config/signal-house/.env`** in production;
   `.env` in the repo root for dev. `.env.example` is the source of truth
   for every key.
3. **The database is fresh V2** at
   `~/.local/share/signal-house-v2/runtime/.data/`. If the guard refuses
   to open a database, it's one created by an older version — that's
   deliberate. V2 will never migrate it; pointing `DB_DIR` at a fresh
   location is the fix.

## Quick start

```bash
bun install
bun run dev        # dev server, LAN-bound, hot reload (web + server)
bun run check      # typecheck + lint + tests + build — the full gate set
bun run start      # production bundle (build first)
```

## Configuration

All keys are `SECRET_HOUSE_*`; a small set of backward-compatible aliases
(`GITHUB_TOKEN`, `GIT_REPOS`, …) also resolves, so either spelling works.
`.env.example` documents every key with defaults. The important ones:

| Key | Default | Meaning |
|---|---|---|
| `SECRET_HOUSE_ACCESS_PASSWORD` | empty | set → Basic auth enabled on everything |
| `SECRET_HOUSE_GITHUB_TOKEN` | — | GitHub API token (issues/PRs/CI/visibility) |
| `SECRET_HOUSE_GIT_REPOS` / `SECRET_HOUSE_PROJECT_ROOTS` | — | local git inputs |
| `SECRET_HOUSE_HERMES_DB_PATH` | `~/.hermes/state.db` | Hermes usage |
| `SECRET_HOUSE_OPENCODE_DB_PATH` | `~/.local/share/opencode/opencode.db` | OpenCode usage |
| `SECRET_HOUSE_POLLER_ENABLED` | `false` | background refresh loop |
| `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` | `false` | privacy opt-in |
| `SIGNAL_HOUSE_ESTIMATE_COSTS` | `true` | cost estimator — see [Cost estimation](#cost-estimation) |

Missing sources degrade gracefully: the collector reports `unavailable`
with a warning, the refresh still succeeds, and the dashboard shows the
warning. A missing source is never a crash.

## Ports

- Dev: 3000 (the wrapper picks the next free port if taken; read the
  actual port from `.signal-house-dev/port`).
- Production: 8999 (the systemd unit sets it).
- LAN: the dev wrapper binds `0.0.0.0` and prints the detected LAN URL at
  startup. The user reviews the dashboard on that URL — same process,
  same data.

## Deployment

```bash
bash scripts/deploy.sh
```

Pins `main`, pulls, `bun install --frozen-lockfile`, builds,
restarts `signal-house.service`, and health-waits until `:8999/api/health`
answers. If it ever fails to become healthy, the script dumps the last 15
lines of the journal so you can see why.

## Common fixes

**Dashboard says "web bundle not built".**
Run `bun run build:web` (or `bun run build`). If it still fails, the
startup log now tells you exactly why — the server logs a warning with the
build error instead of swallowing it.

**Refresh lock is stuck** (every refresh returns 409).
The lock persists across restarts by design (crash-safe). Fix:
`curl -X POST localhost:PORT/api/refresh/reset-lock`, or delete the
`refresh_lock` row from `refresh_meta` in the SQLite database.

**Database from an older version refused.**
Expected behavior, not a bug. Point `DB_DIR` at a fresh directory or let
the default path be created. Signal House will not touch existing data.

**WebKit e2e fails to launch.**
System deps missing: `sudo bunx playwright install-deps webkit`
(needs root once per host).

**A chart shows a gap for one source.**
Check the time-unit contract: Hermes stores epoch seconds, OpenCode stores
epoch milliseconds. If a whole source reads empty for a day that had
activity, suspect a unit mismatch — see `docs/architecture.md` §Time-unit
contract.

## Cost estimation

By default (`SIGNAL_HOUSE_ESTIMATE_COSTS=true`), every cost number on
the dashboard is computed at read time from `(tokens × model rate) / 1M`,
where the rate comes from a priority chain:

1. **Litellm cache** — `~/.local/share/signal-house-v2/runtime/.data/model-pricing.json`,
   refreshed hourly on the hour from
   [`BerriAI/litellm`](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
   (all providers, provider-native listings preferred on machine-key
   collisions). Atomic write — a crash mid-write preserves the
   previous-good cache.
2. **Operator's local rates** — `~/.config/opencode/opencode.jsonc`'s
   `cost.input` / `cost.cache_read` per model. Used when litellm
   doesn't have the model. Output rate falls back to `input × 4`.
3. **Empty** — model not in litellm and not in `opencode.jsonc`.
   Renders as `$0.00` with a coverage footnote on the Agent Spend panel.

The estimator is purely a read-time computation. Estimates never land
in `metrics.db`, `latest_state`, or any persisted table — flipping
`SIGNAL_HOUSE_ESTIMATE_COSTS=false` takes effect on the very next
refresh, with no migration or recompute.

When to disable:

- You trust upstream-reported cost more than third-party pricing
  (set the var to `false`; behavior reverts to today's pass-through).
- A litellm rate change is causing incorrect estimates and you need
  a few hours to investigate (set to `false`; the fetcher keeps
  running, just its output is ignored).

Diagnostics: `/api/diagnostics` exposes `pricingCache.lastFetchedAt`,
`lastFetchStatus` (`ok` / `failed` / `stale` / `empty`), `modelCount`,
and the source URL. If `modelCount === 0`, the fetcher never loaded
litellm — check the network and the source URL.

## Troubleshooting loop

1. Check the service log: `journalctl --user -u signal-house -e`.
2. Check the dev log: `.signal-house-dev/log` — server output and web
   bundle rebuilds are teed there live.
3. Hit `/api/health` — liveness without triggering collectors.
4. Hit `/api/state` — the full payload; missing data shows as explicit
   `null`/empty, never fabricated zeros. If a number looks wrong, the
   first question is always "what does the database actually say?"
   (`sqlite3 ~/.local/share/signal-house-v2/runtime/.data/metrics.db`)
