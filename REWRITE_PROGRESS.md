# Signal House v2 — Bun-native rewrite

> **Status:** complete (clean-room rewrite on `rewrite/bun-native` — see `docs/rewrite/final-report.md`)
> **Source docs:** `/home/agent/scratch/signal-house-v2/` + legacy repo docs (see requirements traceability)
> **Branch:** `rewrite/bun-native`

---

## TL;DR

Full clean-room rewrite of signal-house in **bun** — runtime, data layer, UI, all of it.
One process, one binary, one tsconfig. Explicit collector registration (no dynamic plugin
framework). Fresh V2 schema — **no migrations, it's all fresh** (user decision 2026-07-31):
V2 uses its own database path and refuses to open V1-shaped databases. 30s polling of
`/api/state` (no WebSockets — data only needs periodic refresh).

1. **Runtime swap** — Next.js + Nitro/h3 + better-sqlite3 + jest → bun + `Bun.serve()` + `bun:sqlite` + `bun test`.
2. **Explicit collector model** — github, local-git, hermes, opencode, sessions are
   registered statically in `src/collectors/index.ts`. No dynamic discovery, no manifests.
3. **Fresh schema** — V2 schema (`daily_metrics`, `snapshots`, `latest_state`, `refresh_meta`).
   V1 database is never opened, never migrated, never touched.

---

## Locked stack

| layer            | choice                                                      |
| ---------------- | ----------------------------------------------------------- |
| Runtime          | bun (latest stable)                                         |
| HTTP             | `Bun.serve()` (routes, no framework)                        |
| Database         | `bun:sqlite`, fresh V2 schema only                          |
| Schema           | fresh V2; refuses V1-shaped DBs                             |
| UI framework     | React 19                                                    |
| Charts           | ECharts                                                     |
| UI primitives    | Ark UI (`@ark-ui/react`)                                    |
| Styling          | hand-rolled CSS, tokens from `docs/design-system.md`        |
| Bundler          | bun HTML imports + `bun build`                              |
| Dev server       | `bun --hot`, LAN-accessible on 0.0.0.0:3000                 |
| Tests            | `bun test` + happy-dom + Testing Library                    |
| Package manager  | `bun install`                                               |
| Deploy           | `bun build` / `bun build --compile`, systemd user service   |
| tsconfig         | one, root, strict                                           |

---

## Repository layout

```
/
├── src/
│   ├── server.ts            # Bun.serve entry, route table, lifecycle
│   ├── web/                 # React dashboard (HTML import entry)
│   ├── api/                 # /api/state, /api/diagnostics, /api/refresh, /api/health
│   ├── auth/                # HTTP Basic auth (constant-time)
│   ├── collectors/          # github/, git/, hermes/, opencode/, sessions/
│   ├── config/              # typed runtime config, single env read point
│   ├── db/                  # bun:sqlite client, schema init
│   ├── diagnostics/         # collector/source health summaries
│   ├── metrics/             # daily_metrics writers, aggregates
│   ├── orchestrator/        # refresh runner, lock, persistence
│   ├── poller/              # optional background refresh loop
│   ├── privacy/             # tri-state privacy resolution + filtering
│   └── shared/              # types, date utils, formatting, logging
├── tests/                   # unit/ integration/ contract/ fixtures/
├── docs/                    # rewrite/ + updated architecture, operations, design
├── packaging/               # systemd unit for Bun
├── assets/                  # signal-house-logo.png (retained)
├── package.json
├── bun.lock
├── bunfig.toml
└── tsconfig.json
```

---

## Progress

- [x] Phase 1 — inventory, worktree, requirements traceability
- [x] Phase 2 — legacy runtime removed, Bun scaffold, config module, DB foundation
- [ ] Phase 3 — collectors + orchestrator + lock + poller
- [ ] Phase 4 — API + auth + privacy
- [ ] Phase 5 — React dashboard
- [ ] Phase 6 — packaging + docs
- [ ] Phase 7 — final verification, audit, push, final report

## Next actions

1. Collectors (github, git, hermes, opencode, sessions) + orchestrator + refresh lock.
2. API routes + auth + privacy filtering.
3. Full React dashboard.
4. systemd packaging + README/ops docs, `bun run check` green, push, final report.
