/**
 * Shared ECharts theme tokens for every dashboard chart. One palette, one
 * tooltip shell, one set of axis colours — panels stay siblings by
 * construction, not by copy-paste.
 */

export const CHART_BLUE = "#38bdf8";
export const CHART_YELLOW = "#facc15";
export const CHART_GREEN = "#4ade80";
export const CHART_MUTED = "#94a3b8";
export const CHART_AXIS_LABEL = "#64748b";
export const CHART_BORDER = "#232732";
export const CHART_SPLIT_LINE = "rgba(35, 39, 50, 0.85)";
export const CHART_TOOLTIP_BG = "rgba(17, 19, 24, 0.96)";

/** The shared accent palette in series order. ECharts 5 indexes the
 *  top-level `color` array by series order for legend swatches and tooltip
 *  markers, so series must be painted in this order (or the palette array
 *  must be re-ordered to match the actual series order). */
export const CHART_PALETTE = [CHART_BLUE, CHART_YELLOW, CHART_GREEN] as const;

/** Standard axis-trigger tooltip shell. Deliberately excludes the
 *  `formatter` (every chart's tooltip HTML differs) and the
 *  `axisPointer` (line vs shadow differs per chart). */
export const COMMON_TOOLTIP = {
  trigger: "axis" as const,
  confine: true,
  backgroundColor: CHART_TOOLTIP_BG,
  borderColor: CHART_BORDER,
  borderWidth: 1,
  padding: [10, 12] as [number, number],
  textStyle: { color: CHART_MUTED, fontSize: 12 },
};

/** hex → rgba() with the given alpha. Used for area fills. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}