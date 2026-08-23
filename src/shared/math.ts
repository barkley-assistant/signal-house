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

/**
 * Round `v` up to a "nice" axis maximum with ~20% headroom built in.
 *
 * Uses a per-decade ladder of friendly mantissas instead of pure
 * powers-of-ten, so values land on the next familiar step rather than
 * leaping a whole order of magnitude: a 93-commit day yields max 120,
 * not 200. Steps within a decade: 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10×.
 * Non-positive input returns 0 (callers apply their own floors).
 */
export function niceCeil(v: number): number {
  if (v <= 0 || !Number.isFinite(v)) return 0;
  const withHead = v * 1.2;
  const mag = Math.pow(10, Math.floor(Math.log10(withHead)));
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) {
    if (s * mag >= withHead) return s * mag;
  }
  return 10 * mag;
}
