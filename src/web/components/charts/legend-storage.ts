/**
 * Persisted ECharts legend selections (localStorage).
 *
 * Legend toggles are operator preference (issue #363): they must survive
 * reloads. Reading and writing live here so Agent Spend and the Delivery
 * panel can't drift into two implementations of the same contract.
 */

import * as echarts from "echarts";

/** Read a persisted ECharts legend selection ({seriesName: visible}) from
 *  localStorage. Absent key, corrupt JSON, or non-object payload → undefined
 *  (ECharts then shows every series — the natural default). */
export function readLegendSelection(storageKey: string): Record<string, boolean> | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  } catch {
    /* corrupt or unavailable storage — default to all-visible */
  }
  return undefined;
}

/** Persist the chart's current legend selection to localStorage. Safe no-op
 *  when storage is unavailable (toggling still works this session). */
export function persistLegendSelection(chart: echarts.ECharts | null, storageKey: string): void {
  try {
    const legendOpt = chart?.getOption().legend as Array<{ selected?: Record<string, boolean> }> | undefined;
    localStorage.setItem(storageKey, JSON.stringify(legendOpt?.[0]?.selected ?? {}));
  } catch {
    /* storage unavailable — toggling still works this session */
  }
}