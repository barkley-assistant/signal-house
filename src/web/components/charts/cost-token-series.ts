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
import { CHART_PALETTE, hexWithAlpha } from "./chart-theme";

export interface CostTokenPoint {
  cost: number | null;
  tokens: number | null;
  cacheRead: number | null;
}

/** Area-fill alphas follow the shared chart language: lead blue 0.12, the
 *  other two 0.08. */
export function costTokenSeries(points: ReadonlyArray<CostTokenPoint>): NonNullable<echarts.EChartsOption["series"]> {
  return [
    {
      name: "Cost ($)",
      type: "line",
      data: points.map((p) => (p.cost === null ? null : Number(p.cost.toFixed(2)))),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: CHART_PALETTE[0], width: 2 },
      areaStyle: { color: hexWithAlpha(CHART_PALETTE[0], 0.12) },
    },
    {
      name: "Tokens",
      type: "line",
      yAxisIndex: 1,
      data: points.map((p) => p.tokens),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: CHART_PALETTE[1], width: 2 },
      areaStyle: { color: hexWithAlpha(CHART_PALETTE[1], 0.08) },
    },
    {
      name: "Cache read",
      type: "line",
      yAxisIndex: 1,
      data: points.map((p) => p.cacheRead),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: CHART_PALETTE[2], width: 2 },
      areaStyle: { color: hexWithAlpha(CHART_PALETTE[2], 0.08) },
    },
  ];
}