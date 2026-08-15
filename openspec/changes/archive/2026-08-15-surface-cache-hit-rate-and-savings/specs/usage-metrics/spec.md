## Purpose

Surfaces prompt-cache utilization (hit rate, cache_read tokens, estimated $ saved) and by-model / per-provider cache breakdowns on the signal-house dashboard, computed additively from data already collected by the opencode and hermes collectors, so operators can make model-selection, subscription-justification, and cost-forecasting decisions.

## ADDED Requirements

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

#### Scenario: Known model

- **WHEN** a model has `cache_read = 1000` tokens and `cost.input = 3.00` per 1M tokens in `opencode.jsonc`
- **THEN** cache savings for that model is `0.003` USD

#### Scenario: Unknown model falls back to zero

- **WHEN** a model has `cache_read = 500` tokens but no `cost.input` entry in `opencode.jsonc`
- **THEN** cache savings for that model is `0` USD (NOT `NaN`, NOT `null`)

#### Scenario: Collector untouched

- **WHEN** the cost-input lookup is performed for any model
- **THEN** neither `src/collectors/opencode/collector.ts` nor `src/collectors/hermes/collector.ts` is modified; the lookup runs only at the server layer

### Requirement: Empty-state rendering

The cache savings card SHALL render `—` for the hit rate, `0` for tokens saved, and `$0.00` for $ saved when there is no cache activity in the window. The card SHALL never render `NaN`, `null`, or `—` for the $ saved figure.

#### Scenario: No cache activity in window

- **WHEN** the window has zero cache activity across all sources
- **THEN** the card shows hit rate `—`, tokens saved `0`, and $ saved `$0.00`

#### Scenario: $ saved never renders null or NaN

- **WHEN** the window has cache activity but the resolved `cost.input` rate is missing or zero
- **THEN** $ saved renders `$0.00`, never `null`, `NaN`, or `—`

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

The cache savings card SHALL surface a "by provider" line or expand toggle so the operator can see whether a provider change helped cache utilization. Source discrimination SHALL be preserved: opencode's `cache_read_tokens` and hermes's `cache_read_tokens` SHALL be summed at the windowed aggregate layer only; the per-source cache-hit-rate layer SHALL keep them separate (same separation principle as the pre-v15 `byModelBySource`).

#### Scenario: Expand provider breakdown

- **WHEN** the operator expands the "by provider" line
- **THEN** per-provider cache hit rate and savings are shown, each computed from that provider's own `cache_read` and `input` only

#### Scenario: Source discrimination at the hit-rate layer

- **WHEN** the cache hit rate is computed per provider
- **THEN** opencode's `cache_read_tokens` and hermes's `cache_read_tokens` are NOT blended together before the rate is computed; each provider's rate uses only that provider's own numerator and denominator

### Requirement: Daily chart cache_read series

The daily usage chart SHALL add a 4th series for `cache_read`. The new series SHALL NOT change the data, visible range, or axis scaling of the existing input/output/cost series. The chart axes SHALL freeze on the first dataset (existing convention).

#### Scenario: Existing series unchanged

- **WHEN** the `cache_read` series is added to the daily usage chart
- **THEN** the cost, tokens, input, and output series' data points and visible range are identical to before the addition

#### Scenario: Cache_read series renders with palette reuse

- **WHEN** a window contains cache activity
- **THEN** the `cache_read` series is plotted using the existing `--token-*` palette, with no new colors introduced

### Requirement: Mobile reflow

The cache savings card SHALL reflow on the same breakpoints the Agent Spend card uses: a stacked layout at viewport width ≤ 640px. No new breakpoints SHALL be introduced.

#### Scenario: Mobile stacked layout

- **WHEN** the viewport width is ≤ 640px
- **THEN** the cache savings card stacks vertically, matching the Agent Spend card's mobile layout

### Requirement: Additive API state shape

The API state payload (`StatePayload`) SHALL gain `cacheReadTokens`, `cacheHitRate`, and `cacheSavings` fields per source and windowed, additively. No existing field SHALL be removed or reshaped. Existing consumers SHALL continue to deserialize the payload without modification.

#### Scenario: Existing fields preserved

- **WHEN** the new fields are added to `StatePayload`
- **THEN** every field present before this change is still present with the same type and semantics

#### Scenario: Additive contract for existing consumers

- **WHEN** a consumer that predates this change reads the new payload
- **THEN** it successfully ignores the new fields and behaves identically to before

### Requirement: Palette and typography reuse

The cache savings card and the new chart series SHALL reuse the existing `--token-*` palette and the `HealthStrip` KPI grammar (`kpi-tile`, `big-number`, `kpi-caption`, `dot--*` tokens). No new colors and no new typography SHALL be introduced.

#### Scenario: No new design tokens

- **WHEN** the cache savings card and the new chart series are rendered
- **THEN** they use only existing CSS custom properties from `--token-*` and the `HealthStrip` grammar; no new design tokens, colors, or typography are added
