# Signal House rewrite — requirements traceability

> **Branch:** `rewrite/bun-native`
> **Base commit:** `e4edb29` (`origin/main`, 2026-07-21)
> **Written:** 2026-07-31 (phase 1), maintained through implementation
> **Task:** clean-room rewrite of signal-house as a Bun-native application, per the
> autonomous rewrite instruction delivered 2026-07-31.

This document lists every source document used, the requirements extracted from each,
conflicts and how they were resolved, and the module/test that satisfies each requirement.

---

## 1. Source documents discovered

### 1.1 Primary planning documents (V2, in `/home/agent/scratch/signal-house-v2/`)

| doc | role |
| --- | --- |
| `00-overview.md` | locked stack, TL;DR, phase summary (2026-07-24 revision) |
| `01-plugin-architecture.md` | plugin vertical-slice architecture, tiers, discovery |
| `02-stack-and-runtime.md` | Bun primitives: bun:sqlite, Bun.serve, HTML imports, bun test |
| `03-fresh-schema-design.md` | V2 schema: `daily_metrics`, `snapshots`, `latest_state`; card structure |
| `04-live-updates-websocket.md` | WebSocket push design for live dashboard updates |
| `05-phases-and-verification.md` | three-phase implementation plan + ship gates |
| `06-bug-checklist-tests.md` | 15 contracts from V1's bug history, to become V2 tests |
| `07-tbd-and-risks.md` | open decisions (repo, DB path, ports, Ark UI, retention, card layout) |
| `08-decision-log.md` | chronological decision history (07-23 plan → 07-24 revision → 07-25) |
| `/home/agent/scratch/signal-house-v2-plan.md` | one-page index (superseded by the folder, kept as index) |

### 1.2 Legacy repository documents (in `/home/agent/projects/barkley-assistant/signal-house`)

| doc | role |
| --- | --- |
| `README.md` | product intent, env vars, API table, refresh semantics, retention contract |
| `AGENTS.md` | code style + types discipline (null≠0, boolean\|null, no escape hatches) |
| `docs/architecture.md` | data flow, collector model, privacy posture, deployment topology |
| `docs/operations.md` | operator manual: full env-var table, defaults, privacy posture, troubleshooting |
| `docs/design-system.md` | visual identity: colors, typography, spacing, animation, a11y rules |
| `docs/decisions/0001-explicit-null-privacy-contract.md` | the tri-state privacy contract |
| `.env.example` | the documented environment surface |
| `packaging/systemd/signal-house.service` | systemd unit shape |
| `.github/workflows/ci.yml` | legacy CI (npm/node) — replaced |

### 1.3 Upstream/external facts inspected (read-only, contract discovery)

| source | what was learned | where used |
| --- | --- | --- |
| V1 live DB `~/.local/share/signal-house/runtime/.data/metrics.db` (schema + samples only) | exact V1 schema for migration; `daily_token_usage` shape; `aggregates` types; `latest_state` keys | `src/db/migrations.ts`, migration fixtures |
| Hermes `~/.hermes/state.db` (`sessions` table schema) | `started_at` REAL epoch **seconds**; token/cost columns | `src/collectors/hermes/` |
| OpenCode `~/.local/share/opencode/opencode.db` (`session` table schema + sample row) | `time_created` INTEGER epoch **ms**; `model` JSON carries `providerID`; `cost` written upstream | `src/collectors/opencode/` |
| `signal-house-investigation` skill (v1.7.0) | V1 bug surface: privacy chain, isGap vs null, providerID, ms-vs-s, cost semantics | contracts #1–#10 below |

### 1.4 The rewrite instruction (2026-07-31, `message.txt`)

The authoritative task specification: completion gates, clean-room rule, module layout,
testing requirements, LAN dev server, git discipline, final report.

---

## 2. Requirement extraction and traceability

### 2.1 Product intent (README §1, 00-overview §TL;DR, instruction §Preserve the Product Model)

| req | satisfied by |
| --- | --- |
| Local operator dashboard answering "is agent-driven work healthy or merely busy?" | whole app; dashboard copy is operator-question-shaped |
| Work-flow, stale work, PR progress, CI health, refresh health, session usage, attention queue | `src/api/state.ts` (window/summary/attention/status), frontend sections |
| Fresh/stale/partial/missing/unavailable states explicit; never turn unknown into zero | `number \| null` discipline throughout; `src/shared/format.ts`; frontend render states |
| No speculative features (no multi-user, cloud sync, alerting, forecasting, BI, GraphQL, microservices) | none added; excluded list recorded in §5 |

### 2.2 Locked stack (00-overview, 08-decision-log #1–#9, instruction §Required Bun-Native Architecture)

| req | satisfied by |
| --- | --- |
| Bun runtime, Bun package manager, Bun HTTP server, Bun SQLite, Bun test runner | `package.json` scripts, `src/server.ts`, `src/db/client.ts`, `tests/**` |
| No Node/npm/npx/Next.js/Jest/better-sqlite3 | legacy removal audit (§6); `bun run check` gate |
| `Bun.serve()` serves dashboard, bundled assets, API, health, auth, JSON errors, SPA fallback | `src/server.ts` route table |
| React 19, TS strict, ECharts, Zustand where genuinely useful, Framer Motion for the specified animation | `package.json`; `src/web/**`; `src/web/state/`; `src/web/components/HealthStrip.tsx` |
| Ark UI for accessible primitives (planning docs decision #4) | `@ark-ui/react` — Tabs, Tooltip, Toast, Dialog |
| Fresh, independently implemented accessible UI primitives (instruction) | hand-rolled CSS + components; Ark UI provides focus/ARIA primitives |
| Tailwind CSS 4 *or the project's documented equivalent* (instruction) | planning docs lock "your own CSS / UnoCSS" → hand-rolled CSS with `docs/design-system.md` tokens (the documented equivalent) |
| No server framework beyond Bun.serve (instruction) | no Express/Fastify/Hono/Next |
| HTML imports + `bun build` for bundling | `src/server.ts` imports `src/web/index.html`; `bun run build` |
| `bun --hot` dev with HMR | `scripts/dev.ts` |
| Single-process operator dashboard | `src/server.ts` owns everything; one process |
| LAN dev server early, 0.0.0.0, port 3000 preferred, logs/PID/port/access files gitignored | `scripts/dev.ts`, `.gitignore` |
| `bun run check` = complete non-destructive validation suite | `package.json` scripts |

### 2.3 Schema + database (03-fresh-schema-design, instruction §Database)

| req | satisfied by |
| --- | --- |
| V2-native schema: `daily_metrics(date, source, metric, value REAL NULL, tags JSON, observed_at)`, `snapshots(id, source, captured_at, data)`, `latest_state(source, data, updated)`, `refresh_meta(key, value, updated_at)` | `src/db/schema.ts` (DDL constant in `src/db/init.ts`) |
| `value REAL NULL if unknown` (contract #4/#5 distinction) | schema + `src/metrics/daily.ts` writers; chart layer |
| Prepared statements, explicit transactions, WAL, FK, parameter binding, JSON serialization boundaries | `src/db/client.ts` |
| Single controlled database owner; graceful close | `src/db/client.ts` (DatabaseOwner), `src/server.ts` shutdown |
| Temp DBs for tests; never test against the real/legacy DB | `tests/` use `openMemoryDatabase()` + temp files |
| Fresh DB creation; idempotent re-init; **refuses to open a V1-shaped database** (fresh start, no migration — user decision 2026-07-31) | `src/db/init.ts`, `tests/unit/db.test.ts` |
| Schema versioning via `PRAGMA user_version` | `src/db/schema.ts` |
| Retention: snapshots (30d), daily metrics (90d) | `src/db/retention.ts`; env `SECRET_HOUSE_RETENTION_*` |

### 2.4 Refresh semantics (README §Refresh, architecture §1.2, instruction §Refresh Semantics)

| req | satisfied by |
| --- | --- |
| One refresh runner shared by manual + scheduled | `src/orchestrator/refresh.ts` |
| Single in-process concurrency guard + persisted lock metadata | `src/orchestrator/lock.ts` + `refresh_meta` table |
| 409 Conflict on overlapping manual refresh | `src/api/refresh.ts` |
| Stale-lock detection | `src/orchestrator/lock.ts` (age-based staleness) |
| Narrowly scoped reset-lock (never deletes data) | `src/api/reset-lock.ts` |
| Atomic snapshot persistence | `src/db/client.ts` `persistSnapshot()` in one transaction |
| Last-good-data preservation on failure | orchestrator only persists on success; `latest_state` untouched on failure |
| Failure journaling | `refresh_meta.last_failed_refresh` + `refresh_meta.refresh_state` |
| Partial collector results permitted | orchestrator collects per-source, persists partial with `partialData` flag |
| No clearing of good data on failed refresh | tested in `tests/unit/refresh.test.ts` |

### 2.5 Poller (operations §2.1, instruction §Poller)

| req | satisfied by |
| --- | --- |
| Disabled by default | `SECRET_HOUSE_POLLER_ENABLED=false` default |
| Interval clamps (15–3600 s), startup delay, optional run-once | `src/config/config.ts` |
| Reuses refresh runner; never overlaps manual; continues after recoverable failures; stops on shutdown; no duplicate timers on reload | `src/poller/poller.ts` |

### 2.6 Collectors (architecture §1.1, 01-plugin-architecture, instruction §Collector Requirements)

| req | satisfied by |
| --- | --- |
| GitHub: token absence, auth failure, rate limits, pagination, issues, PRs, workflow runs, repo identity/visibility, partial failures, time-window filtering, no token in diagnostics | `src/collectors/github/` |
| Local git: explicit paths, discovery roots, max depth, name globs, excludes, invalid repos, permission failures, remote identity normalisation, worktrees, recent commits/authors, bounded runtime | `src/collectors/git/` |
| Hermes: read-only external SQLite; missing file, locked DB, empty DB, partial fields, schema detection, time-window filtering, ms-vs-s (contract #10) | `src/collectors/hermes/` |
| OpenCode: read-only external SQLite; `session.cost` read faithfully (contract #6); `providerID` from JSON (contract #8); no zero-row days (contract #9) | `src/collectors/opencode/` |
| Small explicit collector interface; validated config; structured result (data, duration, warnings, errors); no direct DB writes; independently testable; timeout/cancellation; no secret logging; source-unavailable ≠ zero results | `src/collectors/types.ts`, each collector, `tests/unit/*` |
| Explicit collector registration (instruction overrides dynamic plugin discovery) | `src/collectors/index.ts` |
| Orchestrator owns: running collectors, concurrency limits, result combination, privacy resolution, aggregate derivation, atomic persistence, refresh status | `src/orchestrator/` |
| No dynamic plugin framework | explicit registration table in `src/collectors/index.ts` |

### 2.7 Privacy contract (architecture §3, decisions/0001, 06-bug-checklist #1–#3, #11, instruction §Privacy Contract)

| req | satisfied by |
| --- | --- |
| Tri-state `RepositoryPrivacy = true \| false \| null`; null = unknown | `src/shared/types.ts` |
| Unknown/missing privacy → treated as private on operator-facing surfaces; fail-closed | `src/privacy/filter.ts` |
| `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` remains the only opt-in, default false | `src/config/config.ts`, `src/privacy/filter.ts` |
| API filtering server-side only | `src/api/state.ts`, `src/api/diagnostics.ts` |
| Diagnostics must not reveal private repo names | `src/diagnostics/` |
| `validatePrivacyState` before persist; `partialData = true` on mismatch; counts not names | `src/orchestrator/privacy.ts` |
| Focused tests: public, private, unknown, missing map entry, opt-in on/off, diagnostics filtering, attention queue filtering, API filtering | `tests/unit/privacy.test.ts`, `tests/contract/api.test.ts` |

### 2.8 Authentication (operations §1.3, instruction §Authentication and LAN Safety)

| req | satisfied by |
| --- | --- |
| `SECRET_HOUSE_ACCESS_USERNAME` / `SECRET_HOUSE_ACCESS_PASSWORD` Basic auth | `src/auth/basic.ts` |
| Protect dashboard HTML, assets, API, diagnostics, refresh, health | `src/server.ts` (auth applied to all routes when configured) |
| Constant-time credential comparison | `src/auth/basic.ts` (timingSafeEqual) |
| Correct `WWW-Authenticate` header | `src/auth/basic.ts` |
| No credentials in bundles, logs, responses, snapshots | audit + tests (`tests/contract/api.test.ts` no-secret-leak) |
| No user-management system | not added |

### 2.9 API contracts (README §API, instruction §API Contracts)

| req | satisfied by |
| --- | --- |
| `GET /api/state` — window, summary, usage, attention, status, diagnostics; freshness (fresh/stale/partial/missing), last success/failure, in-progress, window, source health, coverage warnings | `src/api/state.ts` + `src/api/build-state.ts` |
| `GET /api/diagnostics` | `src/api/diagnostics.ts` |
| `POST /api/refresh` | `src/api/refresh.ts` |
| `POST /api/refresh/reset-lock` | `src/api/reset-lock.ts` |
| `GET /api/health` — lightweight, no collectors | `src/api/health.ts` |
| Unknown numerics stay `number \| null`; unknown booleans `boolean \| null` | types + state builder |
| JSON content types; JSON error responses | `src/shared/http.ts` |
| Poll `/api/state` ~30s; no WebSockets (instruction overrides 04-live-updates-websocket.md) | `src/web/state/polling.ts` |

### 2.10 Frontend/design (design-system.md, instruction §Frontend and Design Requirements)

| req | satisfied by |
| --- | --- |
| Dark operator theme: `#07080a` page, `#111318` cards, borders not shadows, sparse sky accent, status colors | `src/web/styles/` tokens |
| Satoshi / Instrument Sans / JetBrains Mono, clear type jumps | `src/web/index.html` font links + CSS variables |
| Grouped full number formatting; compact only in chart axes | `src/shared/format.ts` |
| Responsive up to 1280px content width; no layout shift from loading states | `src/web/styles/`, skeleton components |
| Animated health-summary strip (once per load, staggered 80ms, 300ms ease-out, reduced-motion) | `src/web/components/HealthStrip.tsx` |
| Attention queue, trends, CI health, stale indicators, agent/model/session usage, refresh health, source diagnostics, coverage warnings, manual refresh, stuck-lock recovery | `src/web/app/App.tsx` sections |
| Clickable = pointer cursor, semantic buttons, keyboard accessible, visible focus; no cursor on static cards | `src/web/styles/base.css` + components |
| Explicit render states (`—`, No data, Source unavailable, Partial data, Refresh failed, Last updated…, Stale, Unknown) | `src/web/components/StateLabels.tsx` |
| Lazy diagnostics; charts disposed on unmount; `notMerge` on updates | `src/web/components/EChart.tsx`, diagnostics lazy tab |
| Mock data isolated to dev-only and removed from production paths | `src/web/dev/mocks.ts` (dev-only import), excluded from prod build path |

### 2.11 Environment/config (README, operations §2.1, instruction §Environment and Configuration)

| req | satisfied by |
| --- | --- |
| Preserve `SECRET_HOUSE_*` names; documented legacy aliases | `src/config/config.ts` (`LEGACY_ALIASES`) |
| One typed config module: read env once, defaults centrally, validate/clamp numbers+booleans, expand `~`, reject malformed critical config, distinguish missing vs invalid, redact secrets in diagnostics | `src/config/config.ts`, `src/config/redact.ts` |
| `.env.example` comprehensive | `.env.example` (rewritten) |
| Default safe DB dir: dev → `<repo>/.data`, prod → `~/.local/share/signal-house/runtime/.data` | `src/config/config.ts` |

### 2.12 Operations/packaging (instruction §Operational Requirements)

| req | satisfied by |
| --- | --- |
| systemd unit starts Bun directly, no npm/Node, existing env file, host/port, restart on failure, SIGTERM, correct WorkingDirectory, journald, documented Bun path (mise) | `packaging/systemd/signal-house.service` |
| README + ops guide: Bun prereq, install, dev, LAN, auth, build, prod start, systemd, config, refresh, poller, DB location, retention, logs, troubleshooting, upgrade, privacy | `README.md`, `docs/operations.md` |
| Legacy-removal audit | `docs/rewrite/final-report.md` §Legacy removal audit |

### 2.13 Testing (instruction §Testing Requirements)

| req | satisfied by |
| --- | --- |
| Config: defaults, bool/number parsing, clamping, invalid values, path expansion, secret redaction, legacy aliases | `tests/unit/config.test.ts` |
| DB: fresh creation, migration idempotency, existing-schema migration, transactions, snapshot persistence, latest-state, daily metrics, retention, failed-transaction rollback | `tests/unit/db.test.ts`, `tests/contract/migration.test.ts` |
| Refresh: success, partial failure, complete failure, last-good preservation, concurrent rejection, stale lock, lock reset, poller/manual shared path, graceful shutdown | `tests/unit/refresh.test.ts`, `tests/unit/lock.test.ts` |
| Privacy: 9 required scenarios | `tests/unit/privacy.test.ts` |
| Collectors: success, empty source, missing optional source, auth error, timeout, malformed data, pagination, non-zero exit, bounded output | `tests/unit/collectors.test.ts`, `tests/integration/collectors.test.ts` |
| API: state contract, diagnostics, refresh response, 409, reset-lock safety, auth challenge, valid/invalid creds, JSON content types, no secret leakage | `tests/contract/api.test.ts` |
| Frontend: no-data rendering, partial banner, stale, refresh-in-progress, failed-with-last-good, privacy-filtered queue, keyboard, reduced motion, number formatting | `tests/unit/web/*.test.tsx` |
| No skipped/failed tests, no weakened assertions | `bun run check` gate |

---

## 3. Conflicts and resolutions

| # | conflict | resolution |
| --- | --- | --- |
| C1 | **Plugin architecture (Bun.Glob discovery, manifests, host zero-names)** (01, 07) vs **instruction: "Do not create a dynamic plugin framework. Explicit collector registration is easier to audit and maintain."** | Instruction precedence (highest authority). Collectors are explicit vertical slices registered in `src/collectors/index.ts`. Tiers (core/agent/tool) retained as metadata. |
| C2 | **WebSocket live updates** (04, decision #8) vs **instruction: "Avoid… WebSockets for data that only needs periodic refresh"; poll `/api/state` ~30s** | Instruction precedence. Dashboard polls `/api/state` every 30s. No `/ws` route. |
| C3 | **Fresh schema, no V1 carryover, "lose the archive"** (03, decision #5) vs **instruction: "must not casually destroy an existing Signal House database; implement compat OR deterministic transactional migration"** | **User decision 2026-07-31: "We don't need any migrations or anything, it's all fresh."** V2 is a fresh rewrite. V2 uses its own database path (`~/.local/share/signal-house-v2/runtime/.data` in prod) and **refuses to open a V1-shaped database** (`guardFreshDatabase` throws `V1DatabaseRefusedError`, file left byte-identical). No V1→V2 backfill is implemented or tested. The old V1 database file is simply left in place, untouched. This satisfies the spirit of the instruction's "must not casually destroy" constraint (V2 never opens or modifies it) while honouring the explicit user override. |
| C4 | **Env name `SIGNAL_HOUSE_SHOW_PRIVATE_REPO_ITEMS`** (03, 01) vs **`SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS`** (bug-checklist #3, README, ops, instruction) | `SECRET_HOUSE_*` preserved (instruction explicitly requires preserving documented `SECRET_HOUSE_*` names). |
| C5 | **V2 repo location "new repo signal-house-v2"** (07 decision A) vs **instruction: same repo, `rewrite/bun-native` branch, worktree** | Instruction wins: worktree at `../signal-house-bun-native`, branch `rewrite/bun-native`. |
| C6 | **DB path "separate signal-house-v2 dir"** (07 decision B) vs **V1 path `~/.local/share/signal-house/runtime/.data`** vs instruction "safe and documented database directory" | Resolved with C3: V2 gets its own dir `~/.local/share/signal-house-v2/runtime/.data` (prod) / `<repo>/.data` (dev). Never the V1 dir. Documented in README/ops. |
| C7 | **Ports: V2 on 8999, V1 shifted** (07 decision C) vs **dev on 3000** (instruction) | Dev: 3000 (preferred, LAN). Production: 8999 (documented convention). No dual-run needed — V2 starts fresh (C3). |
| C8 | **uPlot** (07-23 plan) vs **ECharts** (07-24 decision #1, 00-overview, instruction "ECharts unless planning docs supersede") | ECharts (newest accepted planning decision). |
| C9 | **Tailwind v4** (design-system.md is Tailwind-flavoured) vs **"your own CSS / UnoCSS"** (00-overview locked stack) vs **instruction "Tailwind CSS 4 or the project's documented equivalent"** | Hand-rolled CSS implementing the exact design-system tokens (`#07080a`, `#111318`, `#38bdf8`, status colors, type scale). The documented equivalent. |
| C10 | **Ark UI** (decision #4, 00-overview) vs **instruction "Freshly generated or independently implemented accessible UI primitives"** | Ark UI retained (documented project choice) — it *is* the independently-implemented accessible primitive layer; no shadcn recipes, no copied components. All components are freshly written. |
| C11 | **Retention "keep daily_metrics forever"** (07 decision E) vs **`SECRET_HOUSE_RETENTION_DAILY_METRICS_DAYS=90`** (.env.example, ops §2.1) | Ops/.env.example are the operative config surface: snapshots 30d, daily metrics 90d. Raw payloads (issues/PRs/runs) live inside snapshot JSON, so snapshot pruning governs them. |
| C12 | **V1 `frontend`/`server` layout** vs **instruction's suggested `src/` layout** | Instruction's `src/` layout adopted (with `web/` for the dashboard). |
| C13 | **"No dependency pinning; install latest"** (decision #9) vs **instruction: "Pin or sensibly constrain dependencies and commit bun.lock"** | `bun.lock` committed (captures installed versions). `package.json` lists deps without manual version ranges (bun writes them at install); `bun.lock` is the pin artifact. |
| C14 | **V1 CI (npm/Node)** vs **Bun-native checks** | `.github/workflows/ci.yml` rewritten to `bun install` + `bun run check`. |
| C15 | **Legacy aliases** (README: `GITHUB_TOKEN` etc.) vs **instruction "Support documented compatibility aliases only when still required"** | Retained (documented in README + config). They cost one lookup table and keep old env files working. |

---

## 4. Legacy-code inspection log

Clean-room rule: legacy source was inspected **only** where planning docs did not fully
describe an externally observable contract. No code was copied; contracts below were
learned and re-implemented independently.

| contract learned | from | recorded in |
| --- | --- | --- |
| V1 `metrics.db` exact schema (13 tables, `user_version=0`) | live DB `.schema` (read-only) | `docs/rewrite/requirements-traceability.md`; migration fixture in `tests/fixtures/v1-schema.sql` |
| V1 `daily_token_usage` shape + `model_usage` JSON (modelName, provider, messages, tokens, cost) | live DB sample rows | `src/db/migrations.ts` (backfill mapping) |
| V1 `daily_metrics` wide-column shape + aggregate types (`throughput`, `cycleTime`, `ci`, `staleWork`, `sessionUsage`, `tokenUsage`, `repositoryPrivacy`) | live DB `.schema` + `SELECT DISTINCT type` | `src/db/migrations.ts`, `src/orchestrator/aggregates.ts` |
| Hermes `sessions` table: `started_at` epoch seconds, token columns, cost columns | `~/.hermes/state.db` `.schema sessions` | `src/collectors/hermes/schema.ts` |
| OpenCode `session` table: `time_created` epoch ms, `model` JSON `{id, providerID, variant}`, `cost` written upstream | `~/.local/share/opencode/opencode.db` `.schema session` + sample | `src/collectors/opencode/schema.ts` |
| V1 env surface + defaults | `.env.example`, `docs/operations.md` | `src/config/config.ts` |
| systemd unit shape (env file, ports, PATH via mise) | `packaging/systemd/signal-house.service` | `packaging/systemd/signal-house.service` (rewritten) |

---

## 5. Intentionally excluded (and why)

| item | reason |
| --- | --- |
| Dynamic plugin discovery / manifests / `plugin.yaml` | instruction C1: explicit registration |
| WebSockets `/ws` route | instruction C2: periodic refresh only |
| **V1→V2 migration / backfill** | **user decision 2026-07-31: "no migrations, it's all fresh"** (matches planning decision #5). V2 uses its own DB path and refuses to open V1-shaped DBs. |
| V1's `source_issues`/`source_pull_requests`/etc. per-source tables | fresh schema folds raw per-source data into `snapshots.data` JSON (03) |
| V1 `frontend/` Next.js app, `server/` Node app, jest config, npm lockfiles | clean-room removal |
| shadcn/ui | decision #3: user rejected the aesthetic |
| Tailwind | planning docs lock "your own CSS" |
| zod | config validation is hand-rolled; no manifest schema needed without plugins (dep count stays minimal) |
| uPlot | decision #1: ECharts |
| Multi-user, OAuth, roles, cloud sync, alerting, forecasting, BI, GraphQL, message queues, microservices, plugin marketplace, drill-down pages, decorative metrics | instruction §Preserve the Product Model |
| Migration of the **live** V1 database | never tested against real data (instruction); migration exercised on fixtures only |
| V1 historical `aggregates` rows (throughput/ci/etc. JSON blobs) | closed-form; V2 recomputes from migrated daily metrics; documented in final report |
| `next/font` / Google-font build-time fetching | Bun has no next/font; fonts load via CDN `<link>` with local fallbacks |

---

## 6. Satisfying module/test map (quick index)

| requirement area | modules | tests |
| --- | --- | --- |
| Config | `src/config/config.ts`, `redact.ts` | `tests/unit/config.test.ts` |
| DB/schema/migrations/retention | `src/db/*` | `tests/unit/db.test.ts`, `tests/contract/migration.test.ts` |
| Refresh/lock/poller | `src/orchestrator/*`, `src/poller/*` | `tests/unit/refresh.test.ts`, `tests/unit/lock.test.ts` |
| Collectors | `src/collectors/*` | `tests/unit/collectors.test.ts`, `tests/integration/collectors.test.ts` |
| Privacy | `src/privacy/*` | `tests/unit/privacy.test.ts`, `tests/contract/api.test.ts` |
| API/auth | `src/api/*`, `src/auth/*` | `tests/contract/api.test.ts` |
| Frontend | `src/web/**` | `tests/unit/web/*.test.tsx` |
| Packaging/docs | `packaging/`, `README.md`, `docs/` | `bun run check` (build+typecheck+lint+test) |
