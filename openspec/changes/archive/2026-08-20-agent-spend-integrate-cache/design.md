## Context

See `proposal.md` — Why / What Changes for motivation. Current state, from fresh explorer evidence:

- `src/web/components/AgentSpend.tsx:49–76` renders `.spend-overview` (2-col grid, 1.2fr / 1fr): left `.spend-hero` (Total cost label, 56px mono amount driven by `useCountUp` at lines 18–35, meta line "sessions · tokens" at lines 57–61); right `.spend-sources` with two `SpendSource` rows (lines 86–105) under an existing stagger (lines 63–66, 90–94).
- `SpendSource`'s meta is a single template string — `` `${sessions} sessions · ${tokens} tokens` `` with a `"No data"` fallback when the source is missing (lines 96–99).
- All cache metrics already arrive on the same `usage` object: window-level `cacheReadTokens` / `cacheHitRate` / `cacheSavings` and per-source `bySource[source].cacheReadTokens` (populated by `fillUsageDefaults` and `aggregates.ts:186–211`). No server, collector, or `StatePayload` work exists in this change.
- `CacheSavingsCard` is mounted above the panel (`src/web/app/App.tsx:54`, import at `:16`) and owns the `.cache-card__overview` rules at `src/web/styles/components.css:335–345`.
- Design grammar to reuse (no new tokens): `.kpi-tile__label`, `.big-number.small` (20px, already dropping to 18px in the ≤700px media block), `.kpi-caption`, spacing scale 4–24. The spend block lives at `components.css:109–201`; ≤700px is the only spend breakpoint; `prefers-reduced-motion` is killed globally, so plain opacity/y `motion.div` variants are the sanctioned motion pattern.

```
Before                                   After
──────────────────────────────────       ──────────────────────────────────────
[ Cache card: Saved | Hit rate | Read ]  (standalone card removed)

Total cost              OpenCode ── $x   Total cost              OpenCode ── $x
$1,234.56               Hermes   ── $y   $1,234.56               900 s · 3.0B t · 1.2M cache_read
1,597 Sessions · 5.42B Tokens            1,597 Sessions · 5.42B Tokens
                                         Cache hit rate 65%   Saved $4.20   Hermes ── $y
```

## Goals / Non-Goals

**Goals:**

- Integrate the window-level Cache hit rate and Saved figures into `.spend-hero` as two smaller stats under Total cost, reusing `.kpi-tile__label` / `.big-number.small` / `.kpi-caption` and the existing in-file `useCountUp` (AgentSpend.tsx:18–35).
- Add a per-source `cache_read` substat to each ledger row's existing meta string (AgentSpend.tsx:96–99) as a one-line diff.
- Remove the standalone card, its mount, its import, and its exclusive CSS in the same change that retargets the e2e spec (`e2e/dashboard.spec.ts:131–139`).
- Zero new design tokens, typography, breakpoints, dependencies, or API surface.

**Non-Goals:**

- Per-source hit-rate or savings figures (proposal non-goal; the hero shows window rollups only).
- Any change to the daily `cache_read` chart series or the by-model cache-% column/sort.
- Restructuring the `.spend-overview` grid (components.css:109–201) or touching the ≤640px model-table rules.
- New motion grammar: no stagger for the new stats, and the ledger stagger stays untouched.

## Decisions

### 1. Hero smaller-stats placement — Option B (sub-row under the meta)

| Option | Shape | Verdict |
|---|---|---|
| **B — new sub-row `.spend-hero__cache`** | Flex row directly under `.spend-hero__meta` (AgentSpend.tsx:57–61); two mini-stats, each `kpi-tile__label` + `big-number.small` + `kpi-caption` | **Chosen.** Matches the proposal's plain-words layout ("a big Total cost number on the left with two smaller stats under it") and its `.big-number.small` grammar; label + value + caption is the established KPI-tile pattern; it rides the hero's existing flex-column with 8px gap (components.css:109–201), so density is controlled and nothing needs to reflow at ≤700px beyond what the grid already does. |
| A — extend the meta line | "1,597 Sessions · 5.42B Tokens · 65% cache · $4.20 saved" | Rejected: demotes the two headline figures to 14px muted text, contradicting the proposal's `.big-number.small` requirement; a five-segment meta ellipsizes on narrow widths; it mixes units (counts, ratio, currency) in one breath. |
| C — asymmetric split inside the hero | 56px amount left, two small figures stacked right of it | Rejected: no precedent in the dashboard grammar; fights the amount's baseline; at ≤700px the amount shrinks to 44px (existing media block) and the stacked pair gets cramped. |

JSX — inserted inside `.spend-hero`, immediately after the meta div (AgentSpend.tsx:51–61 region):

```tsx
<motion.div
  className="spend-hero__cache"
  initial={{ opacity: 0, y: 4 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, delay: 0.15 }}
>
  <div className="spend-hero__cache-stat">
    <span className="kpi-tile__label">Cache hit rate</span>
    <span className="big-number small">{hitRateDisplay}</span>
    <span className="kpi-caption">cache_read ÷ (cache_read + input)</span>
  </div>
  <div className="spend-hero__cache-stat">
    <span className="kpi-tile__label">Saved</span>
    <span className="big-number small">{savedAmount}</span>
    <span className="kpi-caption">at model input rates</span>
  </div>
</motion.div>
```

Computed beside the existing `useCountUp` call (AgentSpend.tsx:18–35), honoring the same usage-guard / hook ordering as `heroAmount`:

```tsx
const hasCacheActivity = usage.cacheReadTokens > 0;
const hitRateDisplay = hasCacheActivity ? formatPercent(usage.cacheHitRate) : "—";
const savedAmount = formatCost(useCountUp(hasCacheActivity ? usage.cacheSavings : 0));
```

Count-up policy: **Saved counts up; hit rate snaps in.** Cost figures accumulate, so Saved gets the same treatment as Total cost; a ratio does not accumulate, and animating 0 → 65% would falsely imply the rate itself grew. Reading of the proposal non-goal "no new `useCountUp` instance": it means *reuse the hook defined in this file* via a second call next to the existing one — a single hook call can only animate one number, so one shared animated value is not a viable reading.

New CSS appended to the spend block (components.css:109–201); nothing else is added:

```css
.spend-hero__cache {
  display: flex;
  gap: 24px;
  margin-top: 4px;
}
.spend-hero__cache-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
```

### 2. Ledger substat — extend the meta template string (one-line diff)

In `SpendSource` (AgentSpend.tsx:96–99):

```tsx
{src
  ? `${formatNumber(src.sessions)} sessions · ${formatCompact(src.tokens)} tokens · ${formatCompact(src.cacheReadTokens)} cache_read`
  : "No data"}
```

- Literal lowercase `cache_read` matches the chart-legend naming and signals a raw count, not a rate; the figure uses `formatCompact` (e.g. `1.2M cache_read`).
- Zero policy: `src` present with `cacheReadTokens === 0` → render `0 cache_read` (a measured count renders `0`, never `—`). `src` missing → the existing `"No data"` fallback stands, with no `cache_read` suffix. This mirrors the hero: only derived ratios get `—`.

### 3. Ellipsis vs. wrap for the longer ledger meta

`.spend-source-row__meta` is 12px, `white-space: nowrap`, with ellipsis (components.css:109–201). Three segments run ≈45 chars ≈ ~270px; the ledger column affords ~350px+ at desktop (1fr of the grid, minus the cost figure and the 16px row gap), so it fits and the ellipsis stays a pure safety net. At ≤700px the grid stacks and rows narrow to ~210–250px on phones, so the *existing* media block gains one rule:

```css
@media (max-width: 700px) {
  .spend-source-row__meta { white-space: normal; }
}
```

Wrapping — not truncation — is the mobile strategy, so the new segment is never the part that disappears. Both ledger rows wrap identically and stay balanced; the cost figure keeps its current alignment. No new breakpoints.

### 4. Standalone card removal and CSS reclaim

- Delete `src/web/components/CacheSavingsCard.tsx`; remove the mount at `App.tsx:54` (proposal Impact: lines 54–55) and the import at `App.tsx:16`.
- Remove `.cache-card__overview` (components.css:335–345) and any other `.cache-card__*` rules exclusive to the deleted component. The base `.cache-card` class is removed only if a repo search at apply time shows no remaining consumer; otherwise it stays.
- The card's staggered framer-motion variants die with it; nothing replaces that motion.

### 5. Motion

- New hero stats: a single `motion.div`, opacity 0 → 1, y 4 → 0, ~0.4s with a short delay so it lands just after the amount starts counting. No stagger.
- Ledger rows keep the existing stagger (AgentSpend.tsx:63–66, 90–94) untouched.
- On window switch, Saved re-counts through the same hook lifecycle Total cost already uses; hit rate simply updates.
- Reduced motion is killed globally per repo constraint; the simple opacity/y variant is the sanctioned pattern and needs no extra handling.

### 6. Empty-state rendering (exact)

When window-level `cacheReadTokens === 0`:

- Cache hit rate renders `—` (em dash).
- Saved renders `formatCost(0)` = `$0.00`; the count-up target is `0`, so it settles immediately.

This preserves the existing `usage-metrics` empty-state contract called out in the proposal (line 34) and the archived card's `—` / `0` / `$0.00` behavior.

### 7. Test updates

- `e2e/dashboard.spec.ts:131–139` — retarget, in the same change as the removal:
  - Drop the "Cache" heading assertion (the heading no longer exists).
  - Saved + Cache hit rate now assert inside `.spend-hero` via the new `.spend-hero__cache` selector.
  - Per-source `cache_read` asserts inside `.spend-sources .spend-source-row__meta` on both rows. Sketch:

    ```ts
    const hero = page.locator(".spend-hero");
    await expect(hero.locator(".spend-hero__cache")).toContainText("Cache hit rate");
    await expect(hero.locator(".spend-hero__cache")).toContainText("Saved");

    const metas = page.locator(".spend-sources .spend-source-row__meta");
    await expect(metas).toHaveCount(2);
    await expect(metas.nth(0)).toContainText("cache_read");
    await expect(metas.nth(1)).toContainText("cache_read");
    ```

- `tests/unit/web/dashboard.test.tsx:260–265` ("hero meta lists sessions and tokens beneath the cost") — replace exact-string equality with partial matching on the same queried node, e.g. `expect(meta.textContent).toContain("Sessions")` and `.toContain("Tokens")` (or a `/Sessions\s*·\s*.*Tokens/` regex), so siblings added under the hero no longer break it. Adjust to the literal query at those lines.
- Add "hero shows cache hit rate and saved as smaller stats": fixture with activity asserts the labels and formatted values; a `cacheReadTokens: 0` fixture asserts `—` and `$0.00`. Follow the count-up assertion pattern the existing hero-amount test already uses.
- Add "ledger rows show per-source cache_read substat": asserts the `formatCompact` figure plus the literal `cache_read`; `0 cache_read` when the count is zero; no `cache_read` text in the `"No data"` case.

## Risks / Trade-offs

- Removing the card breaks the e2e spec by design → retarget `dashboard.spec.ts:131–139` in the same change; never land the removal without the spec update.
- Layout shift when the new stats appear → they render inside the same `usage` guard as the rest of the hero (AgentSpend.tsx:49–76), so they mount atomically with Total cost; the only motion is the 4px fade. No skeleton or min-height is needed.
- The longer ledger meta could ellipsize at mid-widths → desktop fits with margin and ≤700px wraps (Decision 3); the accepted trade-off is that a narrow band just above 700px may still clip the tail. We keep segment order `sessions · tokens · cache_read` rather than engineering per-segment truncation (which would require splitting the string into spans) for a case that fits at all confirmed widths.
- Count-up on tiny Saved values (e.g. `$0.04`) could read as noise → reuse the hook's existing duration; small deltas settle almost immediately. If review finds it distracting, pass a shorter duration only if the existing hook signature (AgentSpend.tsx:18–35) already supports one — no hook rewrite in this change.
- "Saved" could be misread as net of cache-read pricing → the `kpi-caption` states the basis ("at model input rates"); the metric definition itself is unchanged from the archived aggregation design.

## Migration Plan

Purely presentational; no flag, no data migration, no API change.

1. Add the hero sub-row and its CSS (Decisions 1, 3) and the ledger segment (Decision 2).
2. Retarget the e2e spec and broaden/add the unit tests (Decision 7).
3. Delete `CacheSavingsCard.tsx`, its `App.tsx` mount (:54) and import (:16), and reclaim `.cache-card__overview` (components.css:335–345); search-check the base `.cache-card` class.
4. Land as one PR with the full suite green. Roll back by reverting the PR: the card restores from git history and no consumer contract was touched.

## Open Questions

- Caption wording ("cache_read ÷ (cache_read + input)" / "at model input rates") is cosmetic and can be tuned during apply/review without touching specs or tasks.
- Whether the base `.cache-card` class has residual consumers is verified by search during apply; either outcome leaves this design intact.

## Verification Strategy

| Layer | Evidence to add |
|---|---|
| Unit (`tests/unit/web/dashboard.test.tsx`) | Hero shows both smaller stats with formatted values; empty state renders `—` / `$0.00`; ledger meta carries `cache_read` per source, `0 cache_read` at zero, and a clean `"No data"`; the broadened sessions/tokens meta assertion survives the new siblings. |
| E2E (`e2e/dashboard.spec.ts:131–139`) | No "Cache" heading; hero contains Saved + Cache hit rate; both ledger rows contain `cache_read`. |
| Responsive | At ≤700px the hero stats sit under Total cost without overflow and the ledger meta wraps with no clipped `cache_read`; at desktop the three-segment meta fits without ellipsis. No new breakpoints. |
| Motion | A single fade on the new row; ledger stagger unchanged; global reduced-motion kill respected. |
| Hygiene | No `.cache-card__overview` remnants; no dangling `CacheSavingsCard` import or mount; no new tokens or typography in `components.css`. |
