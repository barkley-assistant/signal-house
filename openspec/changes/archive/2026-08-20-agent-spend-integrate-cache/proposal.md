## Why

Cache metrics already flow into the dashboard and are surfaced today as a standalone `CacheSavingsCard` mounted above the Agent Spend panel. That puts cache visibility in a separate visual block from the spend it explains, leaves empty space in Agent Spend's hero, and forces the operator's eye to jump between two cards to connect savings to cost. Folding cache metrics into the Agent Spend panel — once, in the place they explain — makes the relationship legible without a new card or new data.

## What Changes

- **Remove the standalone `CacheSavingsCard`** from `src/web/app/App.tsx` and delete `src/web/components/CacheSavingsCard.tsx`. No metric is rendered in two places.
- **Hero smaller-stats row** (`.spend-hero`, beside Total cost): add two `.big-number.small` stats — windowed **Cache hit rate** (`formatPercent(cacheHitRate)`) and **Saved** (`formatCost(cacheSavings)`) — reusing the existing `useCountUp` already in `AgentSpend`. Both render `—` when `cacheReadTokens === 0` (hit rate) and `$0.00` otherwise, matching the existing empty-state contract. These are window-level rollups, not per-source, honoring the user's "maybe we don't need it per OpenCode or Hermes basis" for the rate/savings pair.
- **Per-source cache read tokens in the ledger**: each row in `.spend-sources` (OpenCode, Hermes) gains a `cache_read` substat beside its existing `sessions · tokens`, formatted with `formatCompact`. This is the only per-source cache figure shown, and it is a raw-token total (distinct from the per-day chart series and the per-model cache-% column), so it does not repeat the rate or savings already in the hero.
- **Kept as-is, non-redundant**: the daily `cache_read` series in `DailyUsageChart` (per-day trend) and the cache-% column in `ModelTable` (per-model breakdown) are unchanged — neither duplicates the hero rollups or the ledger per-source totals.
- No server, collector, aggregation, or `StatePayload` changes. All metrics are already populated by `fillUsageDefaults` and `aggregates.ts:186–211`.

### New layout (plain words)

The Agent Spend top section becomes: a big **Total cost** number on the left with two smaller stats under it — **Cache hit rate** and **Saved**; on the right, the OpenCode and Hermes ledger rows each show `sessions · tokens · cache_read`. The standalone Cache card above is gone. Hit rate and savings appear once (hero); cache read tokens appear once per source (ledger), once per day (chart), once per model as a percentage (table) — three different slicings of the same underlying tokens, not the same number in three boxes.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `usage-metrics`: presentation requirements that today name the `CacheSavingsCard` as the surfacing vehicle — empty-state rendering, per-provider breakdown, mobile reflow, palette/typography reuse — are revised to describe cache metrics integrated into the Agent Spend panel (hero smaller stats + per-source ledger substats). Metric definitions (windowed hit rate, per-model savings, additive `StatePayload`, daily chart series, by-model cache-% column/sort) are unchanged.

## Impact

- **Files**: `src/web/components/AgentSpend.tsx` (hero smaller-stats + ledger cache_read substat), `src/web/components/CacheSavingsCard.tsx` (deleted), `src/web/app/App.tsx` (drop `<CacheSavingsCard>` mount at lines 54–55), `src/web/styles/components.css` (reclaim `.cache-card__overview` rules at 335–345; extend `.spend-hero__meta`/`.spend-sources` substats on existing tokens), `e2e/dashboard.spec.ts`.
- **API**: none — `StatePayload` and all aggregations are unchanged; the windowed and per-source `cacheReadTokens` / `cacheHitRate` / `cacheSavings` fields are already populated.
- **Design system**: no new colors, no new typography, no new breakpoints. Hero smaller stats reuse `.big-number.small`; ledger substats reuse the existing `sessions · tokens` substat grammar; accents reuse `--success` / `--info` via `dot--success` / `dot--info`. Reflow rides the existing ≤700px spend stack and ≤640px rules.
- **Mobile**: the integrated layout stacks on the same ≤700px spend breakpoint the panel already uses; no new breakpoints.
- **Tests**: `tests/unit/web/dashboard.test.tsx` (AgentSpend block) needs no cache-card assertion changes since it had none; `e2e/dashboard.spec.ts:131–139` (`cache panel renders savings, hit rate, and read-volume tiles` targeting `.cache-card__overview` and the "Cache" heading) **must be updated** to assert the three metrics at their new integrated locations (hero hit-rate/saved, per-source cache_read in the ledger). Rationale: the selector it targets (`.cache-card__overview`) no longer exists once the card is removed.
- **Risk**: low — purely presentational relocation of already-computed metrics; no data, collector, or API contract touched. The one behavioral note: the hero Saved figure keeps the existing empty-state rule (`$0.00`, never `—`/`null`) and the hit rate renders `—` on no cache activity, matching the current `usage-metrics` empty-state requirement.

## Non-goals

- No server, collector, `aggregates.ts`, `usage-history.ts`, or `StatePayload` changes — cache metrics are already computed.
- No new design tokens, colors, typography, or breakpoints.
- No new dependencies; no new `useCountUp` instance (reuse the one in `AgentSpend`).
- No change to the daily `cache_read` chart series or the by-model cache-% column/sort.
- No per-source hit-rate or savings figures (the user flagged these as possibly unnecessary; the hero shows window-level rollups instead).
