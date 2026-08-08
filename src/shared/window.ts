/**
 * Dashboard time-window presets.
 *
 * The dashboard's time-range filter offers a small fixed set of windows
 * (7 / 30 / 90 days). These are the ONLY windows the UI can request and the
 * only windows the collectors precompute per-window model breakdowns for —
 * a custom window would silently show partial data, so the API rejects
 * anything outside the whitelist.
 */

export const WINDOW_PRESETS = [7, 30, 90] as const;

export type WindowDays = (typeof WINDOW_PRESETS)[number];

/** The window shown when the operator has not chosen one. */
export const DEFAULT_WINDOW_DAYS: WindowDays = 30;

export function isWindowDays(value: unknown): value is WindowDays {
  return typeof value === "number" && (WINDOW_PRESETS as readonly number[]).includes(value);
}

/** Parse a `days` query param — anything outside the preset whitelist falls
 *  back to the default window. A custom window would silently show partial
 *  data (the collectors only precompute the presets), so unknown values are
 *  never honored. */
export function parseWindowDays(value: string | null): WindowDays {
  if (value !== null) {
    const n = Number(value);
    if (isWindowDays(n)) return n;
  }
  return DEFAULT_WINDOW_DAYS;
}

export function windowLabel(days: WindowDays): string {
  return `${days} days`;
}
