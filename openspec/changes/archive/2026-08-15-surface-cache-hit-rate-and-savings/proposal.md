## Why

Operators pay for every input token but get zero visibility into how much of that input is served from the provider's prompt cache — and cached reads are free (or near-free), so cache utilization directly drives real spend. The data already flows through both collectors and lands in `daily_metrics` (`tokens_cache_read` for opencode at `src/collectors/opencode/collector.ts:149,163,206,222,248`, `cache_read_tokens` for hermes at `src/collectors/hermes/collector.ts:123`, summed at `src/db/daily-metrics.ts:119`), but the dashboard stops at input/output tokens and cost: the by-model table, Agent Spend chart, and summary card never expose cache hit rate or savings. Without that visibility, operators cannot make model-selection decisions, justify subscriptions, or forecast cost as prompt shapes change.

## What Changes

- New `CacheSavingsCard` KPI card mirroring the `HealthStrip` grammar, showing windowed cache hit rate, `cache_read` tokens, and estimated $ saved via `cache_read × cost.input_rate / 1e6`, plus a "by provider" line/expand toggle.
- Cache-% column added to `AgentSpend`'s `ModelTable`, sortable alongside the existing cost/sessions/tokens sort orders; sort state persists under the existing `signal-house:*` localStorage keys.
- 4th `cache_read` series added to `AgentSpend`'s `DailyUsageChart`, additive to the existing Cost/Tokens series; existing series data, axis scaling, and visible range unchanged (axes frozen on first dataset, existing convention).
- Additive server-side aggregation: `queryDailyTrend`, `queryUsageAggregate`, `mergeModelRows`, the `UsageAggregate` type, and `build-state`'s `StatePayload` gain `cacheReadTokens` / `cacheHitRate` / `cacheSavings` fields per source and windowed. No existing field is removed or reshaped.
- New server-side cost-input lookup utility that walks `src/shared/model-map.json` to normalize the model identity, then reads `cost.input` per-model from `~/.config/opencode/opencode.jsonc` server-side. **The collectors are NOT modified** — contract #6 (no cost recomputation inside the collector) is preserved.

### Design fork resolution — how `cost.input` is sourced

The acceptance criteria says "walk `src/shared/model-map.json` then fall back to `cost.input` from `~/.config/opencode/opencode.jsonc` (via the opencode collector's existing model lookup — not a new path)", but the explorer found `src/shared/model-map.json` ships only `{machine, label, family}` — no `cost.input` field — and that OpenCode collector contract #6 (`src/collectors/opencode/collector.ts:5-6`) forbids recomputing cost inside the collector. Resolution, reconciling both:

1. `src/shared/model-map.json` is used to **normalize model identity** (machine name → canonical model key); it does not provide `cost.input` because it has no cost field.
2. `cost.input` is sourced **only** from `~/.config/opencode/opencode.jsonc`, read server-side.
3. The lookup utility lives at the **server/dashboard layer**, not inside either collector. The collector contract is untouched.
4. Missing `cost.input` for a model → savings `0` for that model, never `NaN`/`null`.

This keeps a single source of truth for `cost.input` (the operator's opencode config), reuses the existing `model-map.json` for identity normalization (no parallel lookup table), and respects collector contract #6. No new path is introduced inside the collector; the "not a new path" language in the AC is honored by reusing the same model-resolution chain rather than introducing a parallel cost table.

### Non-goals (explicitly NOT modified)

- `src/collectors/opencode/collector.ts` and `src/collectors/hermes/collector.ts` — collectors are unchanged.
- The existing `tokens` semantics in `src/db/daily-metrics.ts` (the 5-term SUM at line 119) — the `cacheRead` projection is additive, not a reshape of `tokens`.
- `~/.config/opencode/opencode.jsonc` itself — read-only.
- No new `DailyTokenUsageCard.tsx` / `HermesTokenUsageCard.tsx` — those do not exist in this worktree; the chart extension lives in `AgentSpend.tsx`.

## Capabilities

### New Capabilities

- `usage-metrics`: Dashboard surfacing of usage-derived metrics — prompt-cache hit rate, cache savings, by-model cache %, daily cache_read chart series, per-provider breakdown — for the operator, computed additively from data already collected.

### Modified Capabilities

- (none — `openspec/specs/` is empty; this change introduces the first capability)

## Impact

- **Files**: `src/db/daily-metrics.ts`, `src/metrics/usage-history.ts`, `src/orchestrator/aggregates.ts`, `src/api/build-state.ts`, `src/shared/types.ts`, new `src/web/components/CacheSavingsCard.tsx`, `src/web/components/AgentSpend.tsx`, new server-side cost-input utility (e.g. `src/server/cost-input.ts` — exact path is a design decision).
- **API**: `StatePayload` gains additive fields; existing consumers see no shape change (additive contract).
- **Design system**: no new colors, no new typography — reuses `--token-*` palette and the `HealthStrip` KPI grammar (`kpi-tile` / `big-number` / `kpi-caption` / `dot--*`).
- **Mobile**: new card reflows on the same breakpoints `AgentSpend` uses (≤640px stacked); no new breakpoints.
- **Tests**: `tests/unit/usage-history.test.ts`, `tests/unit/aggregates.test.ts`, `tests/unit/web/dashboard.test.tsx`, `tests/contract/api.test.ts`, `e2e/dashboard.spec.ts` extended.
- **Risk surface**: low — purely additive; the only behavioral fork (cost.input sourcing) is resolved above and does not touch collectors or the operator's config.
