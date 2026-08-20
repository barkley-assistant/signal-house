## 1. Unit tests — red first (AgentSpend block)

- [x] 1.1 Broaden the "hero meta lists sessions and tokens beneath the cost" test at `tests/unit/web/dashboard.test.tsx:260–265` to partial-match on the queried meta node (`toContain("Sessions")` / `toContain("Tokens")` or a `/Sessions\s*·\s*.*Tokens/` regex) so hero siblings added under the row no longer break the assertion — WHEN the hero renders with additional `.spend-hero__cache` siblings THEN the sessions/tokens meta test still passes
- [x] 1.2 Add "hero shows cache hit rate and saved as smaller stats" — WHEN the fixture has cache activity THEN `.spend-hero__cache` contains the labels `Cache hit rate` and `Saved` plus their formatted values (`formatPercent(cacheHitRate)` via count-up settle, `formatCost(cacheSavings)`); WHEN `usage.cacheReadTokens === 0` THEN hit rate renders `—` and Saved renders `$0.00`, both never `NaN`/`null`
- [x] 1.3 Add "ledger rows show per-source cache_read substat" — WHEN a SpendSource row (OpenCode/Hermes) renders with `cacheReadTokens > 0` THEN `.spend-sources .spend-source-row__meta` contains a `formatCompact` figure followed by literal `cache_read`; WHEN `cacheReadTokens === 0` THEN the meta renders `0 cache_read`; WHEN the source is missing THEN the row falls back to `No data` with NO `cache_read` suffix
- [x] 1.4 Confirm the existing "unknown source cost renders em-dash, never zero" test still passes unchanged — WHEN a SpendSource is unknown THEN the row renders `No data`/`—` (SpendSource fallback preserved)

## 2. AgentSpend hero smaller-stats

- [x] 2.1 Add a second `useCountUp` call site beside the existing one (AgentSpend.tsx:18–35) for `Saved` (count-up), honoring the same usage-guard / hook ordering as `heroAmount`; compute `hasCacheActivity = usage.cacheReadTokens > 0`, `hitRateDisplay = hasCacheActivity ? formatPercent(usage.cacheHitRate) : "—"`, and `savedAmount = formatCost(useCountUp(hasCacheActivity ? usage.cacheSavings : 0))` — WHEN the hero mounts THEN Saved animates via the existing hook (no new hook instance introduced) and hit rate snaps in
- [x] 2.2 Insert the `.spend-hero__cache` motion.div sub-row directly under `.spend-hero__meta` (AgentSpend.tsx:51–61 region) with two `.spend-hero__cache-stat` tiles (`kpi-tile__label` + `big-number small` + `kpi-caption`) per design.md JSX — WHEN the hero renders THEN both stats mount atomically with Total cost inside the same `usage` guard, with a single opacity 0→1 / y 4→0 fade (~0.4s, delay 0.15s) and no stagger
- [x] 2.3 Honor empty-state contract exactly — WHEN `usage.cacheReadTokens === 0` THEN hit rate renders `—` and Saved renders `$0.00`; WHEN cache activity exists but `cost.input` is missing/zero THEN Saved still renders `$0.00` (never `NaN`/`null`/`—`)

## 3. AgentSpend ledger per-source cache_read

- [x] 3.1 Extend `SpendSource` (AgentSpend.tsx:96–99) meta template to `"{sessions} sessions · {tokens} tokens · {cache_read} cache_read"` using `formatCompact(src.cacheReadTokens)` as a third segment when `src` is present — WHEN a known source renders THEN the row shows its own raw token count as the third segment
- [x] 3.2 Preserve the `"No data"` fallback unchanged — WHEN the SpendSource is unknown THEN the meta renders `No data` with NO `cache_read` suffix (no new fallback branch)
- [x] 3.3 Render literal `0` for zero cache — WHEN `src.cacheReadTokens === 0` THEN the third segment renders `0 cache_read` (a measured count, not `—`/`null`)

## 4. CSS — integrated layout

- [x] 4.1 Append `.spend-hero__cache` (flex row, `gap: 24px`, `margin-top: 4px`) and `.spend-hero__cache-stat` (flex column, `gap: 2px`, `min-width: 0`) to the spend block (components.css:109–201) reusing `.kpi-tile__label` (12px uppercase) / `.big-number.small` (20px mono) / `.kpi-caption` (12px muted) — WHEN the hero renders THEN the two stats sit under Total cost with no new colors, typography, or breakpoints
- [x] 4.2 Add the ≤700px rule for `.spend-hero__cache` (flex-wrap, shrink caption font-size) so the pair reflows on the existing Agent Spend stack — WHEN viewport ≤700px THEN the stats wrap without overflow and no new breakpoint is introduced
- [x] 4.3 Extend `.spend-source-row__meta` on ≤700px to `white-space: normal; max-width: none` so the third ledger segment wraps instead of clipping — WHEN viewport ≤700px THEN both ledger rows wrap identically and `cache_read` is never the part that disappears
- [x] 4.4 Reclaim `.cache-card__overview` rules (components.css:335–345) and its ≤640px stack rule; search-check the base `.cache-card` class and remove it ONLY if no consumer remains, otherwise leave it — WHEN the standalone card is gone THEN no `.cache-card__overview` remnants exist in components.css

## 5. Standalone card removal

- [x] 5.1 Delete `src/web/components/CacheSavingsCard.tsx` entirely
- [x] 5.2 Remove `import { CacheSavingsCard } from "../components/CacheSavingsCard";` (App.tsx:16) and the `<CacheSavingsCard state={state} />` mount (App.tsx:54) from `src/web/app/App.tsx` — WHEN the dashboard renders THEN no standalone cache card is mounted and no dangling import remains

## 6. E2E retarget

- [x] 6.1 Retarget `e2e/dashboard.spec.ts:131–139`: drop the "Cache" heading assertion; split Saved + Cache hit rate assertions into `.spend-hero` via the new `.spend-hero__cache` selector; assert per-source `cache_read` inside `.spend-sources .spend-source-row__meta` (both rows) per the design.md sketch — WHEN the e2e suite runs THEN it asserts the three metrics at their new integrated locations against a seeded `metrics.db` (active + empty cache activity), and the old `.cache-card__overview` selector is gone

## 7. Verification

- [x] 7.1 WHEN `bun test` runs THEN the full unit suite is green (broadened meta test, two new AgentSpend tests, preserved SpendSource fallback test)
- [x] 7.2 WHEN lint/typecheck runs THEN no new errors and no `.cache-card__overview` / dangling `CacheSavingsCard` references remain
- [x] 7.3 WHEN the e2e suite runs against a seeded `metrics.db` THEN the retargeted dashboard spec is green
- [x] 7.4 WHEN manually smoke-tested at desktop and ≤700px THEN the hero stats sit under Total cost without overflow, the ledger meta wraps without clipping `cache_read`, no new breakpoints/tokens/typography appear, and reduced-motion is respected (single fade, ledger stagger unchanged)
