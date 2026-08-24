## MODIFIED Requirements

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
