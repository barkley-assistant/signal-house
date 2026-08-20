## MODIFIED Requirements

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

### Requirement: Mobile reflow

The standalone cache savings card reflow requirement (previously 'Mobile reflow') no longer applies — the card is removed. The integrated cache stats inside the Agent Spend panel (hero smaller-stats and the per-source ledger `cache_read` substat) SHALL reflow on the same existing ≤700px breakpoint the Agent Spend panel already uses. No new breakpoints SHALL be introduced; the prior ≤640px cache-card breakpoint SHALL NOT be relied upon by the integrated layout.

#### Scenario: Mobile stacked layout

- **WHEN** the viewport width is ≤ 700px (the existing Agent Spend panel breakpoint)
- **THEN** the integrated cache stats (hero hit rate / Saved, per-source `cache_read` substats) stack with the rest of the Agent Spend panel using the panel's existing mobile layout

#### Scenario: No new breakpoints

- **WHEN** the integrated layout is rendered across viewport widths
- **THEN** no breakpoint other than the existing Agent Spend ≤700px stack (and the existing ≤640px rules shared across the dashboard) governs the cache stats; no new breakpoint is introduced

### Requirement: Palette and typography reuse

The integrated cache metrics — the Agent Spend hero smaller stats (Cache hit rate, Saved) and the per-source `cache_read` ledger substat — SHALL reuse the existing design grammar. No new colors and no new typography SHALL be introduced. The hero smaller stats reuse `.big-number.small`; the ledger per-source substat reuses the existing `sessions · tokens` substat grammar. Accents reuse the existing `--token-*` palette and `dot--success` / `dot--info` tokens. The daily chart `cache_read` series continues to reuse the `--token-*` palette (unchanged).

#### Scenario: No new design tokens

- **WHEN** the integrated cache stats (hero smaller stats and per-source ledger substat) and the daily chart `cache_read` series are rendered
- **THEN** they use only existing CSS custom properties from `--token-*` and the existing `HealthStrip` / spend-panel grammar (`.big-number.small`, `dot--success`, `dot--info`, `kpi-tile`, `kpi-caption`); no new design tokens, colors, typography, or breakpoints are added

## ADDED Requirements

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
