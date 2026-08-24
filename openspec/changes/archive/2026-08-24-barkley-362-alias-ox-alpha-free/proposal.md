## Why

The dashboard's "By model" table shows two separate rows — `Ox Alpha` (11 sessions, ~340M tokens, the real/paid variant) and `Ox Alpha Free` (1 session, ~10K tokens, the test/free variant) — for what is in practice the same model from the `opencode-go` provider. Both render `cost: 0`, `costSource: "unknown"`, `family: "Stealth"`. Operators want the free variant to roll up under the paid one as a single `Ox Alpha` row. Today there is no alias mechanism in `src/shared/models.ts` or `src/shared/model-map.json`, so the free variant is treated as a distinct model at every layer.

## What Changes

- Add an optional `aliases: string[]` field to `ModelEntry` in `src/shared/model-map.json`; populate the existing `ox-alpha` entry with `aliases: ["ox-alpha-free"]`.
- Add a `resolveEntry()` helper in `src/shared/models.ts` that consults `BY_MACHINE` first, then resolves any alias to its canonical entry. Switch `modelLabel()` and `modelFamily()` to use it so display label and family both resolve through the alias map.
- Add a `canonicalMachineKey()` helper that wraps `machineKey()` + alias resolution, and switch the aggregator's by-model grouping key (`src/orchestrator/aggregates.ts`, `mergeModelRows()`) to use it. This is the change that actually collapses the two rows into one group; alias-aware `modelLabel()` alone would only relabel the rows while leaving them in separate groups (the aggregator groups by `machineKey()`, not by display label).
- Leave `machineKey()` itself untouched as a pure normaliser. Cost lookup, which uses `machineKey()` directly, is therefore unaffected (matching the explorer finding); `ox-alpha-free` continues to fall through cost lookup exactly as it does today (both variants already resolve to `cost: 0` / `costSource: "unknown"`).
- Add a unit test in `tests/unit/models.test.ts` covering the alias positive path (`"Ox Alpha Free"` → label `"Ox Alpha"`, family `"Stealth"`, canonical key `"ox-alpha"`) and the unknown-model fallback (still title-cased, no alias match, no canonical collapse).

## Capabilities

### New Capabilities

<!-- None. Model aliasing is an internal normalisation concern; it modifies the existing by-model display contract rather than introducing a new externally-visible capability. -->

### Modified Capabilities

- `usage-metrics`: the by-model table rollup contract changes — aliased model identifiers SHALL collapse to a single row keyed by the canonical machine key, with display label and family resolved through the alias map. Unknown models SHALL continue to fall through without collapsing.

## Impact

- **`src/shared/model-map.json`** — schema gains an optional `aliases: string[]` on `ModelEntry`; one existing entry (`ox-alpha`) gains an alias.
- **`src/shared/models.ts`** — new `resolveEntry()` and `canonicalMachineKey()` helpers; `modelLabel()` and `modelFamily()` switch to `resolveEntry()`. `machineKey()` is unchanged. Type for `ModelEntry` gains the optional field.
- **`src/orchestrator/aggregates.ts`** — `mergeModelRows()` grouping key switches from `machineKey(row.model)` to `canonicalMachineKey(row.model)` (the explorer-flagged line ~333). Display-label winner-pick logic continues to use `modelLabel()` (now alias-aware).
- **`tests/unit/models.test.ts`** — new cases for alias positive path and unknown-model fallback.
- **`tests/e2e/`** — review for assertions on exact `Ox Alpha Free` row presence; if any e2e asserts the two-row split, retarget to the single rolled-up row. (Explorer risk 3.)
- **Cost lookup** — unchanged. It reads `machineKey()` directly and is not aliased; `ox-alpha-free` cost falls through as today (`0` / `unknown`), which matches the rolled-up row's existing `cost: 0` display.
- **No breaking API/state-shape changes.** The by-model table row count may decrease (alias variants collapse); this is the intended user-visible fix and matches the issue acceptance criterion.
