## Why

The legend on the "Daily cost & tokens" chart (rendered by `DailyUsageChart` in `src/web/components/AgentSpend.tsx`) shows swatch colors that do not match the corresponding series line colors. ECharts 5 draws legend items from its internal palette rather than from each series' line color, so the legend currently mislabels which line is which and misleads users reading the chart.

## What Changes

- Make each legend entry on the "Daily cost & tokens" chart render with a color that matches its series line: "Cost ($)" = sky blue, "Tokens" = yellow, "Cache read" = green.
- Scope the fix to the `DailyUsageChart` component only; series data, axis configuration, tooltips, and chart layout are unchanged.

## Capabilities

### New Capabilities

- `daily-usage-chart`: The observable rendering behavior of the "Daily cost & tokens" usage chart, specifically that each legend entry's swatch color matches its corresponding series line color.

### Modified Capabilities

No existing capabilities are modified (there are no existing specs under `openspec/specs/`).

## Impact

- Affected files: `src/web/components/AgentSpend.tsx` (`DailyUsageChart` component only).
- Affected specs/capabilities: new capability `daily-usage-chart`.
- No API, dependency, data-model, or backend changes.
- Risk: low — visual-only correction. The component currently has no test coverage, so the fix should include a focused test (project convention: `bun:test` under `tests/`).

## Out of Scope

- Changes to series data, axis config, tooltips, chart size/layout, or any other chart in `AgentSpend.tsx`.
- Changes to the series line colors themselves — the lines keep their current colors; only the legend swatches are corrected.
- Introduction of a shared theming/color-token system.

## Approach

Correct the legend swatches to use the same colors as the series lines rather than ECharts' default palette. Exact ECharts option keys are deferred to `design.md`.