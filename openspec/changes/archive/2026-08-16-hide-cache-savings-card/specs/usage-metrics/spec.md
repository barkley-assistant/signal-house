## REMOVED Requirements

### Requirement: Empty-state rendering

**Reason**: The standalone `CacheSavingsCard` is temporarily hidden from the dashboard render in `src/web/app/App.tsx`; with the card not rendered, its empty-state rendering behavior is no longer observable. The underlying `cacheSavings` / `cacheHitRate` pipeline and `fillUsageDefaults` zero-guards in `src/orchestrator/aggregates.ts` remain in force and continue to feed `AgentSpend` and `/api/state`.
**Migration**: To restore this requirement, uncomment the `CacheSavingsCard` import and its `<CacheSavingsCard state={state} />` render in `src/web/app/App.tsx` and re-add the e2e UI assertion. No spec rework is required — the requirement text below is the canonical restored form.

The cache savings card SHALL render `—` for the hit rate, `0` for tokens saved, and `$0.00` for $ saved when there is no cache activity in the window. The card SHALL never render `NaN`, `null`, or `—` for the $ saved figure.

#### Scenario: No cache activity in window

- **WHEN** the window has zero cache activity across all sources
- **THEN** the card shows hit rate `—`, tokens saved `0`, and $ saved `$0.00`

#### Scenario: $ saved never renders null or NaN

- **WHEN** the window has cache activity but the resolved `cost.input` rate is missing or zero
- **THEN** $ saved renders `$0.00`, never `null`, `NaN`, or `—`

### Requirement: Window rescaling of savings

**Reason**: This requirement governed the rendered savings figure on the standalone `CacheSavingsCard` (rescaling to match the Agent Spend chart's peak-reset behavior). With the card hidden, that rendered figure is no longer observable. The windowed `cacheSavings` value is still computed per selected window by the aggregate layer; the daily `cache_read` chart series rescaling remains covered by the `Daily chart cache_read series` requirement.
**Migration**: To restore, uncomment the `CacheSavingsCard` render in `src/web/app/App.tsx`. The requirement text below is the canonical restored form.

When the operator changes the window, cache savings SHALL rescale proportionally to the new window, matching the existing Agent Spend chart's peak-reset-on-window-change behavior. Partial-window days SHALL be within 1% tolerance of the proportional rescale.

#### Scenario: Window narrows

- **WHEN** the operator narrows the window from 30d to 7d
- **THEN** the savings figure rescales to the 7d sum, resetting peaks like the Agent Spend chart

#### Scenario: Partial-window day tolerance

- **WHEN** the window boundary cuts a partial day
- **THEN** the rescaled savings for that day is within 1% of the proportional share for that day

### Requirement: Per-provider breakdown and source discrimination

**Reason**: The primary SHALL of this requirement — the standalone `CacheSavingsCard` surfacing a "by provider" line or expand toggle — is no longer observable while the card is hidden. The pipeline-level source-discrimination invariant (opencode vs. hermes `cache_read_tokens` kept separate at the per-source hit-rate layer) is **not** changed by this hide: `src/orchestrator/aggregates.ts` is untouched, and `tests/unit/aggregates.test.ts` / `tests/unit/cache-metrics.test.ts` continue to enforce it at the aggregate layer.
**Migration**: To restore this requirement, uncomment the `CacheSavingsCard` render in `src/web/app/App.tsx`. The requirement text below is the canonical restored form. The source-discrimination invariant remains enforced by code and aggregate tests throughout the hide period.

The cache savings card SHALL surface a "by provider" line or expand toggle so the operator can see whether a provider change helped cache utilization. Source discrimination SHALL be preserved: opencode's `cache_read_tokens` and hermes's `cache_read_tokens` SHALL be summed at the windowed aggregate layer only; the per-source cache-hit-rate layer SHALL keep them separate (same separation principle as the pre-v15 `byModelBySource`).

#### Scenario: Expand provider breakdown

- **WHEN** the operator expands the "by provider" line
- **THEN** per-provider cache hit rate and savings are shown, each computed from that provider's own `cache_read` and `input` only

#### Scenario: Source discrimination at the hit-rate layer

- **WHEN** the cache hit rate is computed per provider
- **THEN** opencode's `cache_read_tokens` and hermes's `cache_read_tokens` are NOT blended together before the rate is computed; each provider's rate uses only that provider's own numerator and denominator

### Requirement: Mobile reflow

**Reason**: The standalone `CacheSavingsCard` is hidden, so its mobile stacked-layout reflow at ≤ 640px is no longer observable. No new breakpoints are introduced and no other card's mobile behavior is affected.
**Migration**: To restore, uncomment the `CacheSavingsCard` render in `src/web/app/App.tsx`. The requirement text below is the canonical restored form.

The cache savings card SHALL reflow on the same breakpoints the Agent Spend card uses: a stacked layout at viewport width ≤ 640px. No new breakpoints SHALL be introduced.

#### Scenario: Mobile stacked layout

- **WHEN** the viewport width is ≤ 640px
- **THEN** the cache savings card stacks vertically, matching the Agent Spend card's mobile layout
