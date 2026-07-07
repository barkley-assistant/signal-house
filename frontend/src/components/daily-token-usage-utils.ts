import type { DailyTokenUsageRow } from "@/types";

/**
 * Walk the date spine right-to-left and return the first date
 * that has a matching row (i.e., non-gap day).
 * Returns `null` when every day in the spine is a gap.
 */
export function lastNonGapDay(
  spine: string[],
  rows: DailyTokenUsageRow[],
): string | null {
  const datesWithData = new Set(rows.map((r) => r.date));
  for (let i = spine.length - 1; i >= 0; i--) {
    if (datesWithData.has(spine[i])) return spine[i];
  }
  return null;
}
