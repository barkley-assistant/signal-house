/**
 * The cost/tokens/cache-read line trio shared by the main daily chart and
 * the per-model mini chart.
 *
 * Byte-identical series grammar by design: the mini chart deliberately
 * mirrors the main chart's EXACT series config so the two read as one
 * visual language (the main chart's own comment says so). One factory keeps
 * that mirror true — a series change lands in both at once.
 */

import * as echarts from "echarts";
import { CHART_PALETTE } from "./chart-theme";

export interface CostTokenPoint {
  cost: number | null;
  tokens: number | null;
  cacheRead: number | null;
}

/** No area fills by design: on the shared single pane, the cost area
 *  (0.10) and the token area (0.08) overlap into one greenish mud that
 *  swallows the lines — clean dual-axis lines read better than stacked
 *  translucency. Cache read keeps its dashed subordinate line. The
 *  per-model mini chart shares this grammar at 220px, where fills would
 *  be pure noise.
 *
 *  `axes` lets a caller split the trio across two grid panes (kept for
 *  API symmetry with the older split-pane main chart; the per-model
 *  mini chart uses the defaults — a single pane with the shared dual
 *  axis, which is all a 220px panel can honestly hold). */
export function costTokenSeries(
  points: ReadonlyArray<CostTokenPoint>,
  axes: { costX?: number; costY?: number; tokensX?: number; tokensY?: number } = {},
): NonNullable<echarts.EChartsOption["series"]> {
  const costX = axes.costX ?? 0;
  const costY = axes.costY ?? 0;
  const tokensX = axes.tokensX ?? 0;
  const tokensY = axes.tokensY ?? 1;
  return [
    {
      name: "Cost ($)",
      type: "line",
      xAxisIndex: costX,
      yAxisIndex: costY,
      data: points.map((p) => (p.cost === null ? null : Number(p.cost.toFixed(2)))),
      smooth: 0.3,
      showSymbol: false,
      // The cost series is the hero of this panel: thickest line so it
      // survives the dual-axis muddle instead of hiding behind tokens.
      lineStyle: { color: CHART_PALETTE[0], width: 2.5 },
    },
    {
      name: "Tokens",
      type: "line",
      xAxisIndex: tokensX,
      yAxisIndex: tokensY,
      data: points.map((p) => p.tokens),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: CHART_PALETTE[1], width: 2 },
    },
    {
      name: "Cache read",
      type: "line",
      xAxisIndex: tokensX,
      yAxisIndex: tokensY,
      data: points.map((p) => p.cacheRead),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: CHART_PALETTE[2], width: 1.5, type: "dashed" },
    },
  ];
}