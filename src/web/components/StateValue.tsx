/**
 * Presentational state labels — never pretend absent data is zero.
 */

export function StateValue({ label }: { label: string }) {
  return <span className="state-label">{label}</span>;
}

export const NO_DATA = "No data";
export const UNAVAILABLE = "Source unavailable";
export const PARTIAL = "Partial data";
export const UNKNOWN = "Unknown";
