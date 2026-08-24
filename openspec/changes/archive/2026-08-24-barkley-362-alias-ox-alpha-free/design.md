## Context

See proposal.md — Why for motivation. Current state, verified against the repo:

- `src/shared/models.ts` builds `BY_MACHINE: Map<string, ModelEntry>` once at module load from `model-map.json` (line 26). `machineKey()` (line 31) is a pure normaliser; `modelLabel()` (line 51) and `modelFamily()` (line 68) each do `BY_MACHINE.get(machineKey(raw))` with title-case / prefix fallbacks. There is no alias mechanism.
- `src/shared/model-map.json` line 8: `{ "machine": "ox-alpha", "label": "Ox Alpha", "family": "Stealth" }` — no `ox-alpha-free` entry exists. The top-of-file `"//"` comment (line 2) documents the schema.
- `src/orchestrator/aggregates.ts` `mergeModelRows()` (lines 307–498) groups by `machineKey(row.model)` at line 333 — this is the only by-model grouping site in the codebase. Display label/family come from `modelLabel(row.model)` / `modelFamily(row.model)` on the per-group winner (lines 435–436, 442–443).
- Two constraints from the approved spec shape every decision below:
  - **Cost lookup SHALL keep using the raw `machineKey()` normaliser** (spec scenario "Cost lookup unaffected by alias map"). Verified: the `key` from line 333 is *reused* for the cost-rates lookup at lines 364, 418, and 462 (`stripDateSnapshot(key)` → `costOpts.rates.get(...)`), so a naive single-variable swap would silently re-key cost resolution. The design must split grouping and cost keys.
  - **Unknown models SHALL NOT collapse** — they keep title-cased labels, prefix-matched families, and per-row grouping.
- Verified: `familyPrefixes` already contains `{ "prefix": "ox", "family": "Stealth" }` (model-map.json line 84), so `modelFamily("Ox Alpha Free")` already returns `"Stealth"` today — coincidentally, via prefix fallback. The alias makes that resolution authoritative (canonical entry) instead; the observable value is unchanged.
- Verified: the only e2e assertion touching this area is the `"By model"` section header (`e2e/dashboard.spec.ts:75`, repo-root `e2e/` — note tasks.md says `tests/e2e/`, the actual path is `e2e/`). No assertion on `Ox Alpha Free` or a two-row split exists.

## Goals / Non-Goals

**Goals:**

- `Ox Alpha Free` rolls up under `Ox Alpha` as one row in the by-model table: one group keyed `ox-alpha`, label `"Ox Alpha"`, family `"Stealth"`, sessions/tokens summed.
- A reusable alias mechanism in `model-map.json` (optional `aliases: string[]` on a `ModelEntry`) so future variants roll up with a data-only edit.
- Single, documented lookup precedence — direct machine-key hit > alias hit > fallbacks — shared by `modelLabel()`, `modelFamily()`, and the new grouping key.
- Cost behaviour byte-identical to today: every cost/rates lookup keeps keying on the raw `machineKey()` output.

**Non-Goals:**

- Changing `machineKey()` normalisation itself (it stays a pure normaliser — planner's Option B).
- Routing cost resolution through the alias map, or re-keying any pricing/rates data structure.
- Collector, UI, or API-shape changes. No e2e changes (verified none affected).
- Enforcement machinery for alias uniqueness beyond documentation (map is small, hand-edited).

## Decisions

### 1. Aliases are declared on the canonical entry in `model-map.json`

The `ox-alpha` entry gains the alias; no separate `ox-alpha-free` entry is created (the alias is the single source of truth — tasks 1.2).

```diff
-    { "machine": "ox-alpha", "label": "Ox Alpha", "family": "Stealth" },
+    { "machine": "ox-alpha", "label": "Ox Alpha", "family": "Stealth", "aliases": ["ox-alpha-free"] },
```

The `"//"` schema comment (line 2) gains one sentence: `'aliases' (optional) lists extra machine keys that roll up into this entry — display label, family, and by-model grouping resolve to the canonical entry; cost lookup is NOT aliased. Keep aliases unique across the map.`

**Rationale:** co-locating aliases with their target means the mapping is edited in one place and cannot dangle — deleting an entry atomically deletes its aliases (see Risks). **Alternative considered:** a separate top-level `"aliases": { "ox-alpha-free": "ox-alpha" }` object — rejected: two places to keep in sync, and dangling targets become possible.

### 2. New module-load alias index in `src/shared/models.ts`

`ModelEntry` gains the optional field, and a second lookup map is built next to `BY_MACHINE`:

```diff
-type ModelEntry = { machine: string; label: string; family?: string };
+type ModelEntry = { machine: string; label: string; family?: string; aliases?: string[] };
```

```diff
 const BY_MACHINE = new Map<string, ModelEntry>(MODELS.map((m) => [m.machine, m]));
+
+// Alias machine key → canonical entry, built once at import (map is tiny).
+// Direct BY_MACHINE hits take precedence over aliases (see resolveEntry).
+// Convention: aliases are unique across model-map.json — last write wins here.
+const BY_ALIAS = new Map<string, ModelEntry>();
+for (const m of MODELS) {
+  for (const a of m.aliases ?? []) BY_ALIAS.set(a, m);
+}
```

**Rationale:** O(1) per lookup, mirrors the existing `BY_MACHINE` build-once pattern (line 25 comment). The dispatch called this map `ALIAS_TO_MACHINE`; it is named `BY_ALIAS` here to parallel `BY_MACHINE`, and it maps alias → *entry* (not alias → string) so `resolveEntry()` is a single hop. **Alternative considered:** scanning `MODELS` per call for an alias match — rejected: needless O(n) per lookup on a hot display path.

### 3. `resolveEntry()` — one precedence path for label and family

```typescript
/** Canonical entry for a raw model name: direct machine-key hit first, then
 *  the alias map. Undefined when the model is unknown (or unnormalisable). */
export function resolveEntry(raw: string): ModelEntry | undefined {
  const key = machineKey(raw);
  if (!key) return undefined;
  return BY_MACHINE.get(key) ?? BY_ALIAS.get(key);
}
```

**Precedence (documented, load-bearing):** a direct `BY_MACHINE` hit wins over an alias claim on the same key. If someone later adds a real `ox-alpha-free` entry to the map, `Ox Alpha Free` immediately resolves to that entry — the alias takes a back seat — without editing the `ox-alpha` entry.

`modelLabel()` / `modelFamily()` switch their lookup source to `resolveEntry(raw)`, keeping their existing guards and fallbacks byte-identical:

```diff
 export function modelLabel(raw: string): string {
   const key = machineKey(raw);
   if (!key) return raw.trim();
-  const entry = BY_MACHINE.get(key);
+  const entry = resolveEntry(raw);
   if (entry) return entry.label;
   // Fallback: title-case each word, separators → single spaces (unchanged)
```

```diff
 export function modelFamily(raw: string): string | null {
   const key = machineKey(raw);
   if (!key) return null;
-  const entry = BY_MACHINE.get(key);
+  const entry = resolveEntry(raw);
   if (entry?.family) return entry.family;
   for (const { prefix, family } of FAMILY_PREFIXES) {
     if (key.startsWith(prefix)) return family;
```

Two subtleties, both deliberate:

- The empty-key guards (`if (!key) return raw.trim()` / `return null`) must stay in the callers. `resolveEntry()` alone cannot distinguish "unknown model" (fallback applies) from "unnormalisable input" (return raw trim / null).
- `modelFamily()`'s prefix fallback keeps matching on the **raw** key. It is only reachable when the resolved entry lacks `family` (no aliased entry does — `ox-alpha` has `"Stealth"`), so this changes nothing observable; it is simply the smallest diff.

### 4. `canonicalMachineKey()` — grouping key, defined via `resolveEntry()`

```typescript
/** Grouping key for rollups: the canonical entry's machine key when the raw
 *  name resolves (directly OR via alias), else the raw machineKey() output.
 *  machineKey() itself stays a pure normaliser and is NOT modified. */
export function canonicalMachineKey(raw: string): string {
  return resolveEntry(raw)?.machine ?? machineKey(raw);
}
```

**Rationale for defining it via `resolveEntry()` rather than the dispatch shorthand `ALIAS_TO_MACHINE.get(machineKey(raw)) ?? machineKey(raw)`:** the shorthand would let an alias claim shadow a *real* entry added later (an `ox-alpha-free` entry would still group under `ox-alpha`), contradicting the direct-hit-wins precedence from Decision 3. The two forms are equivalent whenever no alias/machine-key collision exists — which holds today — but the `resolveEntry()` form keeps one precedence rule across the whole module, and matches tasks 2.4 verbatim. Unknown models get `machineKey(raw)` back unchanged, so they never collapse (spec scenario "Unknown model does not collapse").

### 5. Aggregator: canonical key for grouping, raw key for cost — two variables

This is the critical implementation detail. `mergeModelRows()` currently uses one `key` for **both** the group Map and the cost-rates lookup (line 333 feeds lines 364, 418, 462). The grouping key switches to `canonicalMachineKey()`; the cost key stays on `machineKey()`:

```diff
   for (const row of rows) {
-    const key = machineKey(row.model);
-    if (!key) continue;
+    // Cost lookup keys on the RAW machine key — the alias map must not
+    // re-key pricing (spec: "Cost lookup unaffected by alias map").
+    const rawKey = machineKey(row.model);
+    if (!rawKey) continue;
+    // Grouping identity is alias-resolved so variants roll up into one row.
+    const key = canonicalMachineKey(row.model);
     // "unknown" carries no signal — drop it from the display entirely.
     if (key === "unknown") continue;
```

…and at each of the three cost-rates lookups inside the loop (currently lines 364, 418, 462):

```diff
-      const lookupKey = stripDateSnapshot(key);
+      const lookupKey = stripDateSnapshot(rawKey);
```

The `"unknown"` drop and the group Map (`map.get(key)` / `map.set(key, ...)`) operate on the canonical `key` unchanged — for real data `canonicalMachineKey("unknown") === "unknown"` (the map has an `unknown` entry), so the guard behaves exactly as today. The per-group winner-pick keeps calling `modelLabel(row.model)` / `modelFamily(row.model)` (lines 435–436, 442–443) and needs no change: both are now alias-aware, so whichever variant wins the sessions race, the collapsed row is labelled `"Ox Alpha"` with family `"Stealth"`.

For `ox-alpha`/`ox-alpha-free` specifically, raw-key vs canonical-key cost lookup is observably identical today (neither has a rate; both render `cost: 0` / `costSource: "unknown"`). The split is still required: it preserves the spec contract for any *future* alias whose canonical model does have a rate (see Risks).

### 6. Call-site audit for `machineKey()` — verified against the repo

Every `machineKey(` call site in `src/`, with the switch decision:

| Site | Role | Switch to `canonicalMachineKey()`? |
|---|---|---|
| `src/shared/models.ts:31` | definition | n/a — unchanged |
| `src/shared/models.ts:52` (`modelLabel`) | display lookup | internal — superseded by `resolveEntry()` (Decision 3) |
| `src/shared/models.ts:69` (`modelFamily`) | family lookup | internal — superseded by `resolveEntry()` (Decision 3) |
| `src/orchestrator/aggregates.ts:333` (`mergeModelRows`) | **by-model grouping** | **YES — grouping key only**; cost `lookupKey` at lines 364/418/462 stays raw (Decision 5) |
| `src/shared/model-pricing-parser.ts:106` | rates-map keyspace (`stripDateSnapshot(machineKey(rawKey))`) | NO — cost path |
| `src/server/model-pricing.ts:58,87` | rates-map keyspace | NO — cost path |
| `src/server/model-pricing-fetcher.ts:84` | pricing fetch keying | NO — cost path |
| `src/server/cost-input.ts:59,108` | `cost.input` resolution keyspace | NO — cost path (the spec's "cost lookup" scenario) |
| `src/db/daily-metrics.ts:199` | daily-cost rollup; `rates.get(mk)` keyed by machine key | NO — cost path (verified: feeds `rates` lookup, not display grouping) |

No other grouping consumers exist: `mergeModelRows()` is the sole builder of `UsageAggregate["byModel"]`, and no other `src/` code groups display rows by model.

## Risks / Trade-offs

- **Overlapping aliases across two entries** → last write wins in `BY_ALIAS` (module-load iteration order). → Mitigation: documented convention — aliases must be unique across `model-map.json` — recorded in the JSON `"//"` comment (Decision 1) and the map's code comment (Decision 2). The map is small and hand-edited; a uniqueness assertion is Non-Goal.
- **Future alias whose canonical model HAS a rate** → raw-key cost lookup (Decision 5) prices the alias variant as `unknown`, and the existing "any unknown row poisons the group's `costSource`" rule (`aggregates.ts:439`) marks the rolled-up row `unknown`. → Accepted per the approved spec ("cost lookup … is unaffected by the alias map"); it is the conservative choice — the rollup never invents a price for a variant that has none. Revisit the cost-key policy only if that display becomes misleading.
- **Alias target entry deleted from the map** → impossible to dangle by construction: aliases are declared on the target entry (Decision 1), so deleting `ox-alpha` also deletes `aliases: ["ox-alpha-free"]`. `Ox Alpha Free` reverts to today's behaviour — its own row, title-cased label, family `"Stealth"` via the `ox` prefix. No orphaned state.
- **Row-count change is user-visible** → the by-model table drops from two Ox rows to one. → This is the intended fix (proposal acceptance criterion), not a regression; call it out in the PR description.
- **Family resolution path changes, value does not** → `modelFamily("Ox Alpha Free")` was already `"Stealth"` via the `ox` family prefix; it now resolves via the canonical entry. → No observable change; noted so reviewers don't read the family test as vacuous — it pins the value while the alias pins the path.

## Test Plan

New `describe("model aliasing")` block in `tests/unit/models.test.ts`, using the file's existing `bun:test` import pattern (tasks 4.1–4.4). Red-first: these fail until the implementation lands.

- **Alias positive path:** `modelLabel("Ox Alpha Free") === "Ox Alpha"`; `modelFamily("Ox Alpha Free") === "Stealth"`; `canonicalMachineKey("Ox Alpha Free") === "ox-alpha"`.
- **Direct-canonical path unchanged:** `modelLabel("Ox Alpha") === "Ox Alpha"`; `canonicalMachineKey("Ox Alpha") === "ox-alpha"`.
- **Unknown-model fallback (no collapse):** for `"Some Unknown GPT"` (matches no `BY_MACHINE` entry, no alias, and no family prefix — note `"gpt"` only prefixes keys that *start* with it): `modelLabel(...) === "Some Unknown GPT"` (title-case fallback; already-capitalised input passes through unchanged), `modelFamily(...) === null`, and `canonicalMachineKey(...) === machineKey(...) === "some-unknown-gpt"`.
- **Existing fleet-coverage / hardcoded-tuple describes** remain untouched and must stay green — they pin today's behaviour for every other model.
- **Verification gate:** `bun run check` (typecheck + lint + `bun test tests/` + build) all green (tasks 6.1); aggregator fixture with both variants yields exactly one `Ox Alpha` row with summed sessions/tokens (tasks 6.2); cost for `"Ox Alpha Free"` still resolves `0` / `"unknown"` via the raw-key path (tasks 6.3).
- **e2e:** verified — the only model-table assertion is the `"By model"` section header (`e2e/dashboard.spec.ts:75`). No e2e retarget needed (tasks 5.1 resolves as "no e2e assertion affected").

## Migration Plan

No data migration. The `model-map.json` schema gains an optional field; entries without `aliases` behave exactly as today (the `BY_ALIAS` build tolerates absent fields via `?? []`). `model-map.json` is imported at module load, so the map and code ship in the same deploy unit — no ordering concerns, no persistent state, no feature flag. Rollback is a plain revert; the only user-visible effect (one row instead of two) reverts with it.
