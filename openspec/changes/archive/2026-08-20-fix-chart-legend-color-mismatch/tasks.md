## 1. Test first (red)

- [x] 1.1 Add a failing test under `tests/` (e.g. `tests/agent-spend-chart.test.tsx`) that renders `DailyUsageChart` with a mocked `echarts.init` capturing the option passed to `setOption`, and asserts the option's top-level `color` palette matches each series' `lineStyle.color`: "Cost ($)" = `#38bdf8`, "Tokens" = `#facc15`, "Cache read" = `#4ade80` (i.e. `option.color[i] === option.series[i].lineStyle.color` for i in 0..2, per the spec scenarios). Run `bun test` and confirm it FAILS — today `option.color` is absent, so legend swatches fall back to ECharts' internal palette. If rendering the component is impractical without a DOM environment in this stack, skip the automated test and instead record the manual visual steps from Task 3.2 as this change's acceptance check.

## 2. Implementation

- [x] 2.1 (depends on Task 1.1) In `src/web/components/AgentSpend.tsx`, add a `SERIES_COLORS = ["#38bdf8", "#facc15", "#4ade80"] as const` constant directly above the `series` array in `DailyUsageChart`, with a comment explaining WHY order matters: ECharts 5 indexes the top-level palette (not `series.lineStyle.color`) for legend swatches, so `SERIES_COLORS` order MUST match the `series` array order.

- [x] 2.2 (depends on Task 2.1) Set `color: SERIES_COLORS` as a top-level option on the chart's option object. Leave the `legend` block (data, icon, geometry, textStyle) unchanged.

- [x] 2.3 (depends on Task 2.1) Replace each series' literal `lineStyle.color` with a reference to the same constant: `SERIES_COLORS[0]` for "Cost ($)", `SERIES_COLORS[1]` for "Tokens", `SERIES_COLORS[2]` for "Cache read". The rendered line colors must stay exactly `#38bdf8`, `#facc15`, `#4ade80`.

## 3. Verification

- [x] 3.1 (depends on Task 2.3) Run `bun test` (or the project's test command) plus the project typecheck if one is defined — confirm the new test is green, no existing tests regress, and TypeScript strict passes.

- [x] 3.2 (depends on Task 2.3) Manual visual verification per `design.md`: run the web app, open the "Daily cost & tokens" tile with a non-empty date range, confirm each legend swatch matches its line (blue/yellow/green), toggle each legend entry off/on to confirm legend↔series linkage, and glance at a narrow (<480px) viewport for legend legibility.
