# usage-metrics Specification

## Purpose
Surfaces prompt-cache utilization (hit rate, cache_read tokens, estimated $ saved) and by-model / per-provider cache breakdowns on the signal-house dashboard, computed additively from data already collected by the opencode and hermes collectors, so operators can make model-selection, subscription-justification, and cost-forecasting decisions.

## Requirements

### Requirement: Windowed cache hit rate

The dashboard SHALL surface a windowed cache hit rate computed as `sum(cache_read) / sum(cache_read + input)` over the selected window, where `cache_read` and `input` are summed across all sources in the window. The rate SHALL be a finite number in `[0, 1]` for every window. When `sum(cache_read + input) == 0`, the rate SHALL be `0`, never `NaN` and never `null`.

#### Scenario: All-cached window

- **WHEN** the window contains `cache_read = 1000` and `input = 0`
- **THEN** the cache hit rate is `1.0`

#### Scenario: No-cache window

- **WHEN** the window contains `cache_read = 0` and `input = 1000`
- **THEN** the cache hit rate is `0.0`

#### Scenario: Empty window zero-guard

- **WHEN** the window contains `cache_read = 0` and `input = 0`
- **THEN** the cache hit rate is `0` (NOT `NaN`, NOT `null`)

#### Scenario: Mixed window

- **WHEN** the window contains `cache_read = 300` and `input = 700`
- **THEN** the cache hit rate is `0.3`

### Requirement: Per-model cache savings

The dashboard SHALL surface per-model estimated cache savings in USD, computed as `cache_read × cost.input_rate / 1e6`. The `cost.input_rate` SHALL be resolved at the server/dashboard layer by first walking `src/shared/model-map.json` to normalize the model identity, then reading `cost.input` per model from `~/.config/opencode/opencode.jsonc`. The collectors SHALL NOT be modified to perform this lookup. When `cost.input` is unavailable for a model, the savings for that model SHALL be `0` USD (NOT `NaN`, NOT `null`).

Model identity normalization SHALL consult an alias map maintained in `src/shared/model-map.json` (an optional `aliases: string[]` field on each model entry). When a raw model identifier matches an alias, it SHALL resolve to the canonical entry for all of: display label, family, and by-model grouping. The by-model table SHALL group rows by the canonical machine key (alias-resolved), NOT by the raw `machineKey()` normaliser, so that aliased variants roll up into a single row. Unknown models — those with no `BY_MACHINE` match and no alias match — SHALL continue to fall through to the existing title-cased label / prefix-matched family / per-row grouping without collapsing onto any other model. Cost lookup (`cost.input` resolution) SHALL continue to use the raw `machineKey()` normaliser and is unaffected by the alias map, so that aliased variants whose cost is already `0` / `unknown` do not change cost behaviour.

#### Scenario: Known model

- **WHEN** a model has `cache_read = 1000` tokens and `cost.input = 3.00` per 1M tokens in `opencode.jsonc`
- **THEN** cache savings for that model is `0.003` USD

#### Scenario: Unknown model falls back to zero

- **WHEN** a model has `cache_read = 500` tokens but no `cost.input` entry in `opencode.jsonc`
- **THEN** cache savings for that model is `0` USD (NOT `NaN`, NOT `null`)

#### Scenario: Collector untouched

- **WHEN** the cost-input lookup is performed for any model
- **THEN** neither `src/collectors/opencode/collector.ts` nor `src/collectors/hermes/collector.ts` is modified; the lookup runs only at the server layer

#### Scenario: Alias resolves to canonical label and family

- **WHEN** a raw model identifier `"Ox Alpha Free"` is normalized and the `ox-alpha` entry in `src/shared/model-map.json` declares `aliases: ["ox-alpha-free"]`
- **THEN** `modelLabel("Ox Alpha Free")` returns `"Ox Alpha"` and `modelFamily("Ox Alpha Free")` returns `"Stealth"` (the canonical entry's label and family), not a title-cased `"Ox Alpha Free"` label or a prefix-matched family

#### Scenario: Alias collapses into one by-model row

- **WHEN** the by-model aggregator groups rows for `"Ox Alpha"` and `"Ox Alpha Free"` and the `ox-alpha` entry declares `aliases: ["ox-alpha-free"]`
- **THEN** both rows are grouped under the canonical machine key `"ox-alpha"` and the by-model table renders a single `Ox Alpha` row whose sessions and tokens are the sum of both variants (chosen approach: Option B — a `canonicalMachineKey()` helper wraps `machineKey()` + alias resolution and is used as the aggregator grouping key, while `machineKey()` itself stays a pure normaliser)

#### Scenario: Unknown model does not collapse

- **WHEN** a raw model identifier has no `BY_MACHINE` match and matches no alias in `src/shared/model-map.json`
- **THEN** it does not collapse onto any other model's row; it renders as its own row with the existing title-cased label and prefix-matched family, and its canonical machine key equals its raw `machineKey()` output

#### Scenario: Cost lookup unaffected by alias map

- **WHEN** the `cost.input` rate is resolved for an aliased variant (e.g. `"Ox Alpha Free"`)
- **THEN** the lookup uses the raw `machineKey()` normaliser (NOT the alias-resolved canonical key), preserving today's behaviour where the variant falls through to `cost: 0` / `costSource: "unknown"`

### Requirement: Empty-state rendering

The integrated cache metrics (previously rendered by the standalone `CacheSavingsCard`, now surfaced inside the Agent Spend panel's hero smaller-stats area) SHALL render `—` for the windowed cache hit rate, and `$0.00` for $ saved when there is no cache activity in the window (`cacheReadTokens === 0` across all sources). The hit rate and $ saved figures SHALL render in the Agent Spend panel's hero smaller-stats area beside Total cost — not in a standalone card. The panel SHALL never render `NaN`, `null`, or `—` for the $ saved figure. The "tokens saved" figure previously shown on the standalone card is removed (no per-window tokens-saved tile in the integrated layout); the per-source `cache_read` totals that replace its role are governed by the "Per-source cache_read substat in Agent Spend ledger" requirement.

#### Scenario: No cache activity in window

- **WHEN** the window has zero cache activity across all sources (`cacheReadTokens === 0`)
- **THEN** the Agent Spend hero shows hit rate `—` and $ saved `$0.00`, rendered in the smaller-stats area beside Total cost

#### Scenario: $ saved never renders null or NaN

- **WHEN** the window has cache activity but the resolved `cost.input` rate is missing or zero
- **THEN** $ saved renders `$0.00` in the Agent Spend hero, never `null`, `NaN`, or `—`

#### Scenario: No standalone cache card

- **WHEN** the dashboard renders the integrated layout
- **THEN** no standalone `CacheSavingsCard` is mounted; the hit rate and $ saved figures appear exactly once, in the Agent Spend hero smaller-stats area

### Requirement: Window rescaling of savings

When the operator changes the window, cache savings SHALL rescale proportionally to the new window, matching the existing Agent Spend chart's peak-reset-on-window-change behavior. Partial-window days SHALL be within 1% tolerance of the proportional rescale.

#### Scenario: Window narrows

- **WHEN** the operator narrows the window from 30d to 7d
- **THEN** the savings figure rescales to the 7d sum, resetting peaks like the Agent Spend chart

#### Scenario: Partial-window day tolerance

- **WHEN** the window boundary cuts a partial day
- **THEN** the rescaled savings for that day is within 1% of the proportional share for that day

### Requirement: By-model table cache % column and sort

The by-model table SHALL show a cache-% column. The table SHALL be sortable by cache %, and that sort order SHALL compose with the existing cost, sessions, and tokens sort orders. Sort state SHALL persist under the existing `signal-house:*` localStorage keys.

#### Scenario: Sort by cache %

- **WHEN** the operator clicks the cache-% column header
- **THEN** rows reorder by cache % (descending on first click, ascending on second), composing with any active secondary sort order

#### Scenario: Sort state persists

- **WHEN** the operator reloads the page after sorting by cache %
- **THEN** the cache-% sort is restored from the existing `signal-house:*` localStorage keys

### Requirement: Per-provider breakdown and source discrimination

The standalone `CacheSavingsCard` "by provider" line/expand toggle is removed. Source discrimination is now surfaced in the Agent Spend ledger: each source row (OpenCode, Hermes) shows that source's raw `cacheReadTokens` total as a substat beside its existing `sessions · tokens` substats (see "Per-source cache_read substat in Agent Spend ledger"). The windowed cache hit rate and $ saved shown in the Agent Spend hero are window-level rollups only; they SHALL NOT be duplicated per source in the ledger. Source discrimination SHALL be preserved at the metric layer: opencode's `cache_read_tokens` and hermes's `cache_read_tokens` SHALL be summed at the windowed aggregate layer only; the per-source cache-hit-rate layer (when computed) SHALL keep them separate (same separation principle as the pre-v15 `byModelBySource`).

#### Scenario: Expand provider breakdown

- **WHEN** the operator looks for a per-provider cache breakdown
- **THEN** the standalone `CacheSavingsCard` "by provider" line/expand toggle is no longer present; per-source `cache_read` totals are surfaced instead as a substat in each Agent Spend ledger row (OpenCode, Hermes), using only that source's own tokens

#### Scenario: Source discrimination at the hit-rate layer

- **WHEN** the cache hit rate is computed per source
- **THEN** opencode's `cache_read_tokens` and hermes's `cache_read_tokens` are NOT blended together before the rate is computed; each source's rate uses only that source's own numerator and denominator

#### Scenario: Window-level rate and savings not duplicated per source

- **WHEN** the integrated layout renders
- **THEN** the cache hit rate and $ saved appear only once, in the Agent Spend hero as window-level rollups; no per-source hit-rate or per-source $-saved substat is shown in the ledger

### Requirement: Daily chart cache_read series

The daily usage chart SHALL add a 4th series for `cache_read`. The new series SHALL NOT change the data, visible range, or axis scaling of the existing input/output/cost series. The chart axes SHALL freeze on the first dataset (existing convention).

#### Scenario: Existing series unchanged

- **WHEN** the `cache_read` series is added to the daily usage chart
- **THEN** the cost, tokens, input, and output series' data points and visible range are identical to before the addition

#### Scenario: Cache_read series renders with palette reuse

- **WHEN** a window contains cache activity
- **THEN** the `cache_read` series is plotted using the existing `--token-*` palette, with no new colors introduced

### Requirement: Mobile reflow

The standalone cache savings card reflow requirement (previously 'Mobile reflow') no longer applies — the card is removed. The integrated cache stats inside the Agent Spend panel (hero smaller-stats and the per-source ledger `cache_read` substat) SHALL reflow on the same existing ≤700px breakpoint the Agent Spend panel already uses. No new breakpoints SHALL be introduced; the prior ≤640px cache-card breakpoint SHALL NOT be relied upon by the integrated layout.

#### Scenario: Mobile stacked layout

- **WHEN** the viewport width is ≤ 700px (the existing Agent Spend panel breakpoint)
- **THEN** the integrated cache stats (hero hit rate / Saved, per-source `cache_read` substats) stack with the rest of the Agent Spend panel using the panel's existing mobile layout

#### Scenario: No new breakpoints

- **WHEN** the integrated layout is rendered across viewport widths
- **THEN** no breakpoint other than the existing Agent Spend ≤700px stack (and the existing ≤640px rules shared across the dashboard) governs the cache stats; no new breakpoint is introduced

### Requirement: Additive API state shape

The API state payload (`StatePayload`) SHALL gain `cacheReadTokens`, `cacheHitRate`, and `cacheSavings` fields per source and windowed, additively. No existing field SHALL be removed or reshaped. Existing consumers SHALL continue to deserialize the payload without modification.

#### Scenario: Existing fields preserved

- **WHEN** the new fields are added to `StatePayload`
- **THEN** every field present before this change is still present with the same type and semantics

#### Scenario: Additive contract for existing consumers

- **WHEN** a consumer that predates this change reads the new payload
- **THEN** it successfully ignores the new fields and behaves identically to before

### Requirement: Palette and typography reuse

The integrated cache metrics — the Agent Spend hero smaller stats (Cache hit rate, Saved) and the per-source `cache_read` ledger substat — SHALL reuse the existing design grammar. No new colors and no new typography SHALL be introduced. The hero smaller stats reuse `.big-number.small`; the ledger per-source substat reuses the existing `sessions · tokens` substat grammar. Accents reuse the existing `--token-*` palette and `dot--success` / `dot--info` tokens. The daily chart `cache_read` series continues to reuse the `--token-*` palette (unchanged).

#### Scenario: No new design tokens

- **WHEN** the integrated cache stats (hero smaller stats and per-source ledger substat) and the daily chart `cache_read` series are rendered
- **THEN** they use only existing CSS custom properties from `--token-*` and the existing `HealthStrip` / spend-panel grammar (`.big-number.small`, `dot--success`, `dot--info`, `kpi-tile`, `kpi-caption`); no new design tokens, colors, typography, or breakpoints are added

### Requirement: Agent Spend hero smaller-stats

The Agent Spend panel hero (`.spend-hero`, beside Total cost) SHALL render two smaller stats: the windowed **Cache hit rate** (formatted via `formatPercent`) and **Saved** (formatted via `formatCost`). Both SHALL reuse the existing `useCountUp` entrance animation already used in `AgentSpend` — no new `useCountUp` instance is introduced. **Saved** SHALL always be a finite value and SHALL render `$0.00` when no cache activity exists in the window (`cacheReadTokens === 0`). **Cache hit rate** SHALL render `—` when no cache activity exists in the window. These are window-level rollups; they are not reproduced per source (see "Per-provider breakdown and source discrimination").

#### Scenario: Empty-state hero stats

- **WHEN** the window has zero cache activity across all sources (`cacheReadTokens === 0`)
- **THEN** the Agent Spend hero shows Cache hit rate as `—` and Saved as `$0.00`, both as `.big-number.small` stats beside Total cost

#### Scenario: Active-window hero stats

- **WHEN** the window has cache activity (`cacheReadTokens > 0`)
- **THEN** the Agent Spend hero shows Cache hit rate via `formatPercent(cacheHitRate)` and Saved via `formatCost(cacheSavings)`, each animated on mount by the existing `useCountUp` hook

#### Scenario: Saved is finite in every window

- **WHEN** the hero Saved figure is rendered for any window (including empty and unknown-cost windows)
- **THEN** the rendered value is finite (never `NaN`, `null`, or `—`); it is `$0.00` when there is no cache activity or when `cost.input` is unavailable

### Requirement: Per-source cache_read substat in Agent Spend ledger

Each row in the Agent Spend ledger (OpenCode, Hermes) SHALL show a `cache_read` token substat alongside its existing `sessions · tokens` substats, formatted with `formatCompact`. The substat value SHALL come from that source's own `cacheReadTokens` (always populated per `usage-history.ts` and `fillUsageDefaults`). Because `cache_read` is a measured count rather than an unknown value, the substat SHALL render a literal `0` when the source's `cacheReadTokens` is `0` — not `—`, not `null`. This substat is the only per-source cache figure shown; it is a raw-token total distinct from the daily `cache_read` chart series and the by-model cache-% column. When the source itself is unknown to the payload (the SpendSource is not present), the whole ledger row SHALL fall back to `No data` / `—` per the existing `SpendSource` behavior — that behavior is preserved unchanged.

#### Scenario: Source with cache activity

- **WHEN** the OpenCode (or Hermes) ledger row renders and that source's `cacheReadTokens > 0`
- **THEN** the row shows a `cache_read` substat beside `sessions · tokens`, formatted with `formatCompact`, reflecting that source's own token count

#### Scenario: Source with zero cache activity

- **WHEN** the OpenCode (or Hermes) ledger row renders and that source's `cacheReadTokens === 0`
- **THEN** the `cache_read` substat renders a literal `0` (not `—`, not `null`), since it is a measured count rather than an unknown value

#### Scenario: Unknown source row fallback preserved

- **WHEN** a source is not present in the payload (the `SpendSource` is unknown)
- **THEN** the whole ledger row falls back to `No data` / `—` per the existing `SpendSource` behavior, unchanged by this integration

#### Scenario: Per-source substat is not a rate or savings

- **WHEN** the ledger `cache_read` substat renders for any source
- **THEN** it shows a raw token count only; it does not show a hit rate, a $-saved figure, or any other derived cache metric per source
