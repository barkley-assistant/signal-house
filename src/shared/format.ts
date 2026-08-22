/**
 * Shared formatting utilities.
 *
 * Dashboard values use grouped full numbers by default; compact notation is
 * reserved for chart axes (design-system.md §Typography).
 */

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Grouped full number: 1234567 → "1,234,567". null → "—". */
export function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: fractionDigits }).format(value);
}

/** Compact number for cramped contexts: 1234567 → "1.2M". null → "—". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return compactFormatter.format(value);
}

/** Currency: 12.3456 → "$12.35". null → "—". */
export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Hero currency: drops the cents when the value reaches four digits so the
 *  big Agent Spend tile reads "$1,318" instead of "$1,318.36". Below $1,000
 *  keeps cents as before (consistent with formatCost). The shared divisor
 *  is the visual rule: dashboard wants sub-cent precision on small numbers,
 *  loses it once the precision is noise on the figure.
 *
 *  Note: a per-hour rate that crosses $1k is rare and would show without
 *  cents too — fine, the rule is the same. */
export function formatCostHero(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 1_000 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Cost per 1M effective tokens: 0.1186 → "$0.119", 1.58 → "$1.58". null → "—". */
export function formatEffPerM(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return "—";
  const digits = value >= 1 ? 2 : 3;
  return `$${value.toFixed(digits)}`;
}

/** Duration in seconds → "3m 12s" / "1h 05m" / "45s". null → "—". */
export function formatDurationSeconds(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 60) return `${Math.round(value)}s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Percentage: 0.91 → "91%". null → "—". */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

/** Relative time: ms timestamp → "2m ago". null → "—". */
export function formatRelative(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms === null || ms === undefined) return "—";
  const diff = Math.max(0, now - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Absolute timestamp for "Last updated …" labels. */
export function formatAbsolute(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
