# Signal House V2 Rewrite — Final Report

**Date:** 2026-07-31
**Branch:** `rewrite/bun-native` (base: `origin/main` at `e4edb29`)

## Summary

Complete clean-room rewrite of Signal House as a Bun-native single-process application. Every line is new; no V1 code was carried over. The rewrite is production-ready with full test coverage, Playwright e2e, and a polished dark operator dashboard.

## Stack

| Layer | V1 | V2 |
|-------|----|----|
| Runtime | Node.js + Next.js | Bun 1.3.x |
| Package manager | npm | bun |
| Server | Next.js dev server | `Bun.serve()` |
| Database | better-sqlite3 | `bun:sqlite` |
| Tests | Jest | `bun:test` + Playwright |
| Frontend | Next.js SSR | React SPA (ECharts, zustand, framer-motion) |
| WebSockets | Yes | No (periodic refresh only) |

## Key Design Decisions

1. **Fresh schema, no migration** — V2 uses its own DB at `~/.local/share/signal-house-v2/`; guard refuses V1-shaped DBs (file untouched).
2. **Explicit collector registry** — `src/collectors/index.ts`; adding a source = one line. No dynamic plugin framework.
3. **Privacy fail-closed tri-state** — `RepositoryPrivacy = true | false | null`; null → private. Only GitHub API supplies real visibility.
4. **No WebSockets** — periodic refresh (poller, disabled by default, manual + optional startup run).
5. **Cost faithfulness** — opencode `session.cost` read as-is (never recomputed); hermes cost from DB columns with actual-falls-back-to-estimated per-row.
6. **Time-unit contract** — hermes `started_at` = epoch seconds, opencode `time_created` = epoch milliseconds — never mixed.
7. **First-run backfill** — a fresh DB gets one automatic refresh on startup (covers the last 30 days).
8. **Static SPA serving through auth** — Bun's HTML imports can't apply per-request auth, so the SPA is built to `dist/public/` and served through the auth'd fetch handler.

## Test Coverage

- **103 bun:test** — config, db, privacy, lock, refresh, collectors, API
  contract, frontend component tests, formatting
- **18 Playwright e2e** — desktop Chromium, Pixel 7 (Chromium), and iPhone
  13 (WebKit): load, API shapes, manual refresh, diagnostics, attention
  queue, mobile overflow
- **TSC clean**, **ESLint 0 warnings**

## Bugs Found By Tests

1. Config legacy-alias reverse lookup was wrong (preferred → legacy mapped backwards)
2. OpenCode collector `GROUP BY model` grouped by raw JSON string (cost double-counted for same-model/different-provider)
3. `runCommand` threw on spawn failure instead of returning a failed result
4. `parseRemote` matched non-GitHub SSH hosts (e.g., git@gitlab.com)
5. ECharts canvas min-content blew out CSS grid on mobile (fixed with `minmax(0,…)` in grid tracks)
6. V1-refusal guard triggered on 0-byte files (`null !== undefined` in bun:sqlite)

## Files Changed

~8,200 lines added across 75+ new files in `src/`, `tests/`, `scripts/`, `docs/`.

## Known Limitations

- GitHub token required for GitHub data; without it, the GitHub source is unavailable (graceful degradation)
- Git collector requires explicit repos or discovery roots; without either, it's unavailable
- Usage sources are hermes + opencode (DB-backed); github + git supply repo/work telemetry.
- No known test-infrastructure gaps as of the v2.0.0 release — Playwright
  e2e run green across Chromium (desktop + Pixel 7) and WebKit (iPhone 13).

## How to Verify

```bash
bun run dev          # starts on port 3000 (or next free)
bun test tests/      # 103 tests
bunx playwright test # 18 e2e tests (Chromium + WebKit)
bunx tsc --noEmit    # clean
bunx eslint .        # 0 warnings
```
