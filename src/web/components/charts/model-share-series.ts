/**
 * Series builder for the top-models-by-tokens chart.
 *
 * Each day from /api/daily/model-share carries every series (top N + an
 * optional Others rollup) 0-filled, so this is a straight transpose:
 * one line per model key over the window's dates. Colours come from the
 * shared family palette — models of the same family share a hue and get
 * consecutive shades, Others gets its own neutral. Because ECharts 5
 * reads legend swatches from the top-level `color` array by series order
 * (not from per-series lineStyle), the palette is returned alongside the
 * series and the caller must set `color: [...]` in the same order.
 */

import * as echarts from "echarts";
import { modelChartColors } from "../../../shared/model-colors";

/** Lighten a hex colour toward white by `amount` (0..1, 0.45 → mix 45%
 *  with white) for band-edge strokes — a LIGHT hairline on the dark
 *  background reads as a crisp seam between adjacent bands, where a
 *  darkened stroke (dark-on-dark) vanishes. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${(((r << 16) | (g << 8) | b).toString(16)).padStart(6, "0")}`;
}

export interface ModelShareSeriesPoint {
  key: string;
  label: string;
  family: string | null;
  tokens: number;
}

export interface ModelShareSeriesDay {
  date: string;
  models: ModelShareSeriesPoint[];
}

export interface ModelShareSeries {
  /** One stacked-area series per model, in rank order (Others last). */
  series: Array<{
    name: string;
    type: "line";
    stack: "tokens";
    data: number[];
    smooth: number;
    showSymbol: boolean;
    lineStyle: { color: string; width: number };
    itemStyle: { color: string };
    areaStyle: { color: string; opacity: number };
  }>;
  /** Palette in EXACT series order — set as the chart's top-level `color`
   *  so legend swatches match the lines. */
  palette: string[];
  /** Model labels in series order, for the legend `data`. */
  names: string[];
}

export function modelShareSeries(points: ReadonlyArray<ModelShareSeriesDay>): ModelShareSeries | null {
  if (points.length === 0) return null;
  const dates = points.map((p) => p.date);
  // Series order is stable per window: day 0 defines the model list and
  // every day carries the same keys (server 0-fills). Defensive against
  // a malformed payload (e.g. a mock returning spend-shaped points): a
  // missing/empty models list means there is nothing to chart.
  const models = points[0]?.models;
  if (!models || models.length === 0) return null;

  // First model per family keeps the family colour; repeats take the next
  // free high-contrast ring colour (see model-colors.ts).
  const colors = modelChartColors(models);

  const series = models.map((model, si) => {
    const fill = colors[si];
    // The stroke is a lightened copy of the fill so adjacent bands keep a
    // crisp edge instead of fusing into a muddy gradient where they meet.
    const edge = lighten(fill, 0.45);
    return {
      name: model.label,
      type: "line" as const,
      // Stacked areas: the top edge of the stack IS the window total, and
      // each band shows its model's share without lines tangling. Rank order
      // (biggest window total first) puts the dominant model on the stable
      // bottom band.
      stack: "tokens" as const,
      data: points.map((p) => p.models[si]?.tokens ?? 0),
      smooth: 0.3,
      showSymbol: false,
      lineStyle: { color: edge, width: 1.5 },
      itemStyle: { color: fill },
      areaStyle: { color: fill, opacity: 0.8 },
    };
  });

  return {
    series,
    palette: colors,
    names: models.map((m) => m.label),
  };
}