# Design: Fix Chart Legend Color Mismatch

## Context

The `DailyUsageChart` component in `src/web/components/AgentSpend.tsx` (lines 112–320) renders an ECharts 5 line chart titled "Daily cost & tokens" with three series: "Cost ($)", "Tokens", and "Cache read". Each series sets an explicit `lineStyle.color` (`#38bdf8`, `#facc15`, `#4ade80` respectively, lines 279/290/299). The legend config (lines 249–259) declares `data` as plain string names and does not set any per-item color.

Root cause (confirmed against Apache ECharts 5 docs, `handbook/en/concepts/style/index.html` and `option-parts/option.legend.md`): ECharts 5 derives legend swatch colors from the chart's top-level `option.color` palette array, indexed by series position. It does **not** read `series.lineStyle.color` for the legend swatch. With no top-level `color` array set, ECharts falls back to its built-in default palette — so the three legend swatches show default-palette hues that do not match the three lines. See `proposal.md` for the user-facing motivation.

## Goals / Non-Goals

**Goals:**
- Make each legend swatch color match its corresponding series line color: "Cost ($)" → sky blue, "Tokens" → yellow, "Cache read" → green.
- Establish a single source of truth for the three series colors so legend and lines cannot drift apart again.

**Non-Goals (per proposal):**
- No change to series line colors themselves, axis config, tooltips, data, or chart layout.
- No shared theming / color-token system beyond this component.
- No change to other charts in `AgentSpend.tsx`.

## Decisions

### Decision: Set a top-level `option.color` palette array as the single source of truth

**Choice**: Define a `SERIES_COLORS` constant `["#38bdf8", "#facc15", "#4ade80"]` inside `DailyUsageChart`, set it as the chart's top-level `color` option, and reference the same constant from each series' `lineStyle.color`. The `legend.data` stays a plain string array (unchanged shape).

**Alternatives considered**:
- *Per-legend-entry `itemStyle.color` via `legend.data` objects* (`data: [{ name: "Cost ($)", itemStyle: { color: "#38bdf8" } }, ...]`). ECharts supports this (per `option-parts/option.legend.md`). Rejected: it duplicates the three color literals between legend and series, reintroducing the exact drift risk that caused this bug. Violates the single-source-of-truth goal.
- *`dataMap` / name-linking patterns*. Over-engineered for three static series; the palette array already links legend ↔ series by index.

**Rationale**: ECharts 5's documented behavior is that `option.color` (a top-level array) drives both the legend swatch and the default series color, indexed by series order. Setting it once makes the legend match the lines automatically and removes the duplication that caused the mismatch. Because series already set `lineStyle.color`, those continue to win for the line stroke; the top-level palette now governs the legend swatch and serves as the fallthrough default. Referencing the same constant from both sites means any future color edit touches one place.

### Decision: Keep `icon: "circle"` and current legend geometry

**Choice**: Leave `orient`, `top`, `right`, `icon`, `itemWidth`, `itemHeight`, `itemGap`, and `textStyle` exactly as-is. Only `color` (palette) is added; `legend.data` is untouched.

**Rationale**: The proposal scopes the change to swatch color only. The circle icon already matches the line markers' visual language; switching to squares would be an unprescribed behavior change. The `media` query (lines 263–271) overrides only `textStyle.fontSize` and is unaffected.

## Risks / Trade-offs

- **[Risk] Series/palette index drift** — the palette-array approach relies on legend `data` order matching series definition order. Current code already defines `legend.data` as `["Cost ($)", "Tokens", "Cache read"]` and `series` in the same order (lines 250 and 273/283/293), so indices align. → Mitigation: `SERIES_COLORS` is a positional constant; a code comment will note that the array order MUST match the `series` array order. If series are later reordered, the comment is the contract.
- **[Risk] Hidden coupling to series count** — adding a fourth series without extending `SERIES_COLORS` silently falls back to ECharts default palette for index 3. → Mitigation: the constant sits directly above the `series` array in the same option object, making the pairing visually obvious.
- **[Trade-off] `lineStyle.color` becomes redundant** when the palette is set — ECharts would color the line from the palette anyway. We keep explicit `lineStyle.color` (referencing the same constant) because (a) the proposal requires the lines keep their current colors with no behavior change, and (b) explicit `lineStyle` survives any future refactor that drops or reorders the palette. Cost: three lines of redundancy pointing at the same constant. Acceptable.

## Implementation Sketch

Add the constant near the top of the option-building block inside `DailyUsageChart`, then wire it into both the top-level `color` and each series `lineStyle`:

```typescript
// Single source of truth for the three series colors.
// Order MUST match the `series` array below — ECharts 5 indexes this
// palette (not series.lineStyle.color) for the legend swatch.
const SERIES_COLORS = ["#38bdf8", "#facc15", "#4ade80"] as const;
```

Top-level option (added before `grid` / near the start of the option object):

```typescript
color: SERIES_COLORS,
```

Each series `lineStyle` references the constant instead of a bare literal (values identical — lines keep their current colors):

```typescript
// series[0] "Cost ($)"
lineStyle: { color: SERIES_COLORS[0], width: 2 },
// series[1] "Tokens"
lineStyle: { color: SERIES_COLORS[1], width: 2 },
// series[2] "Cache read"
lineStyle: { color: SERIES_COLORS[2], width: 2 },
```

The `legend` block (lines 249–259) is **unchanged** — no `itemStyle`, no `data` object form. The top-level palette now supplies the swatch colors.

## Testing Strategy

| Layer | What to Verify | Approach |
|-------|----------------|----------|
| Manual (required) | Legend swatches match their lines | See steps below |
| Component (optional) | `setOption` is called with `color` array whose entries equal each series' `lineStyle.color` | `bun:test` + render `DailyUsageChart`, capture the option passed to a mocked `echarts.init().setOption`, assert `option.color[i] === option.series[i].lineStyle.color` for i in 0..2. Optional per proposal — no existing test harness for this component. |

**Manual visual verification** (required — no existing test covers this component):
1. Run the web app and open the agent spend view that renders `DailyUsageChart` (the "Daily cost & tokens" tile).
2. Ensure the date range returns non-empty data so all three lines render.
3. Confirm each legend swatch color matches its line: "Cost ($)" swatch = sky blue line, "Tokens" swatch = yellow line, "Cache read" swatch = green line.
4. Toggle each legend entry off/on and confirm the corresponding line hides/shows (verifies legend↔series linkage survived the change).
5. Resize to a narrow viewport (<480px) and confirm the legend still renders legibly (the `media` query path is untouched but worth a glance).

## Migration / Rollout

No migration required. Pure front-end visual fix, single component, no data or API surface. Rollback = revert the single commit.

## Open Questions

None — all decisions are resolved by the proposal scope and ECharts 5 documented behavior.
