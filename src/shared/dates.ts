/** UTC date helpers. All dashboard "days" are UTC days (YYYY-MM-DD). */

/** Today's UTC day as YYYY-MM-DD. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** YYYY-MM-DD for a UTC timestamp (ms). */
export function utcDayFromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Day string N days before `anchor` (inclusive), UTC. */
export function utcDaysAgo(n: number, anchor: Date = new Date()): string {
  const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - n));
  return d.toISOString().slice(0, 10);
}

/** Number of UTC days between two day strings (inclusive count of boundaries). */
export function utcDayDiff(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** All day strings from `start` to `end` inclusive (UTC), ascending. */
export function utcDayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** ISO-8601 timestamp for display ("2026-07-31T21:14:14Z"). */
export function isoNow(): string {
  return new Date().toISOString();
}

/** True when both instants fall inside the same wall-clock hour (UTC).
 *  Deliberately hour-of-day + day granularity, not elapsed-3600s: an
 *  11:59 computation and a 12:00 one are different hours even though
 *  they're 60s apart, which makes refresh timing predictable ("on the
 *  hour"). Used by the fetchers' freshness gates. */
export function sameUtcHour(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCHours() === b.getUTCHours()
  );
}
