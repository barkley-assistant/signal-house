/**
 * Null-safe numeric helpers.
 *
 * The dashboard's contract: unknown values stay `null`; aggregates over
 * collections containing unknowns must not silently turn them into zero.
 * These helpers only fold over known values.
 */

export function sum(values: ReadonlyArray<number | null>): number | null {
  let acc = 0;
  let seen = false;
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) {
      acc += v;
      seen = true;
    }
  }
  return seen ? acc : null;
}

export function avg(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0) / known.length;
}

export function median(values: ReadonlyArray<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const mid = Math.floor(known.length / 2);
  return known.length % 2 === 0 ? (known[mid - 1] + known[mid]) / 2 : known[mid];
}

export function percentile(values: ReadonlyArray<number | null>, p: number): number | null {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  if (known.length === 0) return null;
  const idx = Math.min(known.length - 1, Math.max(0, Math.ceil((p / 100) * known.length) - 1));
  return known[idx];
}

/** UTC day boundaries in ms for a YYYY-MM-DD day string. */
export function dayWindowMs(day: string): { start: number; end: number } {
  const start = Date.parse(`${day}T00:00:00Z`);
  return { start, end: start + 86_400_000 };
}
