## 1. Server-side data layer

- [x] 1.1 Extend `src/db/daily-metrics.ts` `queryDailyTrend` to project an additive `cacheRead` column (additive SELECT; the existing `{date, cost, tokens}` triple's `tokens` 5-term SUM at line 119 keeps its current semantics — `cache_read` is added, not folded into `tokens`)
- [x] 1.2 Extend `src/metrics/usage-history.ts` `queryUsageAggregate` to preserve per-model `cacheReadTokens` through the windowed aggregate (currently dropped at L118/169) and expose a windowed `cacheHitRate` = `sum(cache_read) / sum(cache_read + input)` with zero-guard returning `0` when the denominator is `0` (never `NaN`, never `null`)
- [x] 1.3 Extend `src/orchestrator/aggregates.ts` `mergeModelRows` to preserve `cacheReadTokens` on the by-model row (currently dropped at L183-184); extend the `UsageAggregate` type (L14-21) additively with `cacheHitRate`, `cacheReadTokens`, `cacheSavings` per source and windowed — no existing field removed or reshaped

## 2. Server-side cost-input lookup

- [x] 2.1 Add a server-layer cost-input utility that walks `src/shared/model-map.json` to normalize model identity (machine → canonical key), then reads per-model `cost.input` from `~/.config/opencode/opencode.jsonc` (read-only; the config file is NOT modified)
- [x] 2.2 Wire the utility into the per-model savings computation `cache_read × cost.input_rate / 1e6`; missing rate for a model → savings `0`, never `NaN`/`null`; collectors untouched (OpenCode collector contract #6 preserved)

## 3. API and shared types

- [x] 3.1 Extend `src/shared/types.ts` additively with `cacheReadTokens`, `cacheHitRate`, `cacheSavings` (per source + windowed) on the relevant types (`TrendPoint` at `src/web/state/store.ts:153-157` and the API state types)
- [x] 3.2 Extend `src/api/build-state.ts` `summary.costAndTokens` (L159-177) to materialise the new fields in `StatePayload`; existing fields (`cost`, `tokens`, `costPerHour`, `tokensPerHour`) keep their type and semantics

## 4. UI — cache savings card

- [x] 4.1 Build `src/web/components/CacheSavingsCard.tsx` mirroring the `HealthStrip` KPI grammar (`kpi-tile` / `big-number` / `kpi-caption` / `dot--*` tokens); reuses `--token-*` palette, introduces no new colors or typography
- [x] 4.2 Render empty state: `—` for hit rate, `0` for tokens saved, `$0.00` for $ saved; never `NaN`/`null`/`—` for the $ saved figure
- [x] 4.3 Add a "by provider" line or expand toggle showing per-provider cache hit rate + savings, preserving source discrimination at the rate layer (opencode's and hermes's `cache_read_tokens` are never blended before the per-provider rate is computed)
- [x] 4.4 Reflow on the same breakpoints as `AgentSpend` (stacked at ≤640px); introduce no new breakpoints
- [x] 4.5 Rescale savings proportionally on window change (peak-reset-on-window-change, matching the Agent Spend chart; within 1% tolerance for partial-window days)

## 5. UI — by-model table

- [x] 5.1 Extend `src/web/components/AgentSpend.tsx` `ModelTable` with a cache-% column
- [x] 5.2 Make the cache-% column sortable by cache %, composing with the existing cost / sessions / tokens sort orders; persist the sort state under the existing `signal-house:*` localStorage keys

## 6. UI — daily chart

- [x] 6.1 Extend `src/web/components/AgentSpend.tsx` `DailyUsageChart` (L270-291) with a 4th `cache_read` series using the `--token-*` palette (no new colors)
- [x] 6.2 Freeze chart axes on the first dataset (existing convention); verify the existing input / output / cost series data points and visible range are unchanged after the addition

## 7. Tests

- [x] 7.1 Unit: cache hit rate formula + zero-guard (`0 + 0 → 0`, never `NaN`/`null`) in `tests/unit/usage-history.test.ts` or `tests/unit/aggregates.test.ts`
- [x] 7.2 Unit: by-model cache % sort order, composing with existing cost / sessions / tokens sorts, in `tests/unit/web/dashboard.test.tsx`
- [x] 7.3 Unit: per-model cache savings formula `cache_read × cost.input_rate / 1e6` + missing-rate fallback to `0` (not `NaN`/`null`) against a fixture `opencode.jsonc`
- [x] 7.4 Contract: API shape additivity — new fields present, existing fields unchanged in type and semantics, in `tests/contract/api.test.ts`
- [x] 7.5 E2E: cache savings card renders against a seeded `metrics.db` with cache activity (hit rate, tokens, $ saved populated) and with no cache activity (empty-state `—` / `0` / `$0.00`) in `e2e/dashboard.spec.ts`
