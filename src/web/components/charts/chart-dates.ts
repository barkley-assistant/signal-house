/**
 * en-GB date formatting for the dashboard's UTC day strings (YYYY-MM-DD).
 * One implementation of each display shape, so the chart axes, tooltips and
 * stat blocks can never disagree on how a date reads.
 */

function utcDate(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** "2026-08-31" → "31 Aug" — the chart axis label shape. */
export function fmtDayShort(d: string): string {
  return utcDate(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "2026-08-31" → "Monday, 31 August 2026" — the tooltip header shape. */
export function fmtDayFull(d: string): string {
  return utcDate(d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "2026-08-31" → "31 Aug 2026" — the stat-line bound shape (no weekday). */
export function fmtDayWithYear(d: string): string {
  return utcDate(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}