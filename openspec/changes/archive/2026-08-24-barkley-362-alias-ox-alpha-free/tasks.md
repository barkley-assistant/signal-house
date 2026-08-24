## 1. Schema — model-map.json

- [x] 1.1 Add an optional `aliases?: string[]` field to the `ModelEntry` type in `src/shared/models.ts` (the TS shape that `model-map.json` is typed against), so loading the JSON keeps type-checking green
- [x] 1.2 Add `aliases: ["ox-alpha-free"]` to the existing `ox-alpha` entry in `src/shared/model-map.json` (entry currently `{ "machine": "ox-alpha", "label": "Ox Alpha", "family": "Stealth" }`). Do not add a separate `ox-alpha-free` entry — the alias is the single source of truth for the rollup

## 2. Code — src/shared/models.ts

- [x] 2.1 Add a `resolveEntry(raw: string): ModelEntry | undefined` helper that (a) looks up `BY_MACHINE.get(machineKey(raw))`, (b) if that misses, scans entries for one whose `aliases` array contains `machineKey(raw)`, and (c) returns the canonical entry or `undefined`. Build an alias→entry index once at module load (e.g. a `Map<string, ModelEntry>` keyed by alias machine key) rather than scanning per call
- [x] 2.2 Switch `modelLabel(raw)` to use `resolveEntry(raw)` for the lookup, falling back to the existing title-case path when `resolveEntry` returns `undefined` — WHEN `"Ox Alpha Free"` is passed THEN `modelLabel` returns `"Ox Alpha"`; WHEN an unknown model is passed THEN the title-cased fallback is unchanged
- [x] 2.3 Switch `modelFamily(raw)` to use `resolveEntry(raw)?.family`, falling back to the existing prefix-matching path when `resolveEntry` returns `undefined` — WHEN `"Ox Alpha Free"` is passed THEN `modelFamily` returns `"Stealth"`
- [x] 2.4 Add `canonicalMachineKey(raw: string): string` that returns the canonical entry's `machine` when `resolveEntry(raw)` finds one (alias or direct), otherwise returns `machineKey(raw)` unchanged. `machineKey()` itself stays a pure normaliser and is NOT modified
- [x] 2.5 Confirm cost-lookup call sites continue to use `machineKey()` (NOT `canonicalMachineKey()`); do not route cost resolution through the alias map

## 3. Code — src/orchestrator/aggregates.ts (rollup)

- [x] 3.1 In `mergeModelRows()` (~line 333), switch the grouping key from `machineKey(row.model)` to `canonicalMachineKey(row.model)` so aliased variants land in the same group — WHEN rows for `"Ox Alpha"` and `"Ox Alpha Free"` are merged THEN both fall under the `"ox-alpha"` group
- [x] 3.2 Audit the rest of `mergeModelRows()` (lines ~307–498) for any other `machineKey(row.model)`/`machineKey(...)` use that drives grouping or row identity; switch those to `canonicalMachineKey(...)` if and only if they determine row grouping or dedup. Leave any `machineKey()` use that drives cost lookup unchanged
- [x] 3.3 Confirm the per-group display-label winner-pick logic still calls `modelLabel(row.model)` (now alias-aware via 2.2) so the collapsed group's label is `"Ox Alpha"`

## 4. Unit tests — tests/unit/models.test.ts

- [x] 4.1 Add a `describe("model aliasing")` block with a positive-path test: WHEN `modelLabel("Ox Alpha Free")` / `modelFamily("Ox Alpha Free")` / `canonicalMachineKey("Ox Alpha Free")` are called THEN they return `"Ox Alpha"` / `"Stealth"` / `"ox-alpha"` respectively. Use the `bun:test` `describe`/`test`/`expect` import pattern already in the file
- [x] 4.2 Add an unknown-model fallback test in the same block: WHEN `modelLabel`/`modelFamily`/`canonicalMachineKey` are called with a model not in the map and not aliased (e.g. `"Some Unknown GPT"`) THEN `modelLabel` returns the existing title-cased fallback, `modelFamily` returns the existing prefix-matched fallback, and `canonicalMachineKey` returns the same value as `machineKey(...)` (no collapse)
- [x] 4.3 Add a direct-canonical test: WHEN `modelLabel("Ox Alpha")` / `canonicalMachineKey("Ox Alpha")` are called THEN they return `"Ox Alpha"` / `"ox-alpha"` (the canonical path is unchanged by aliasing)
- [x] 4.4 Leave existing fleet-coverage / hardcoded-tuple tests unchanged — these are red-first tests; implementation must not break them

## 5. E2E review — tests/e2e/

- [x] 5.1 Search `e2e/` (repo-root; not `tests/e2e/`) for any assertion on the literal row label `Ox Alpha Free` or on a two-row split between `Ox Alpha` and `Ox Alpha Free` in the by-model table. No e2e assertion affected.

## 6. Verification

- [x] 6.1 WHEN `bun run check` runs THEN `typecheck` (tsc --noEmit), `lint` (eslint), `test` (bun test tests/), and `build` all pass green — the new unit tests pass, no type errors from the optional `aliases` field, no lint errors from the new helpers
- [x] 6.2 WHEN the by-model aggregator runs against a fixture containing both `"Ox Alpha"` and `"Ox Alpha Free"` rows THEN the output contains exactly one `Ox Alpha` row whose sessions/tokens are the sum of both variants (manual or test-based confirmation)
- [x] 6.3 WHEN cost lookup runs for `"Ox Alpha Free"` THEN it still resolves to `cost: 0` / `costSource: "unknown"` via the raw `machineKey()` path (no behaviour change at the cost layer)
