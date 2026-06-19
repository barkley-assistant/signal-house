import type { SectionState } from "./types";

export function resolveSectionState({
  isLoading,
  error,
  isEmpty,
  isStale,
  isPartial,
  isUnconfigured,
}: {
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  isStale?: boolean;
  isPartial?: boolean;
  isUnconfigured?: boolean;
}): SectionState {
  if (isLoading) return "loading";
  if (error && isUnconfigured) return "unavailable";
  if (error) return "error";
  if (isEmpty) return "empty";
  if (isStale) return "stale";
  if (isPartial) return "partial";
  return "data-available";
}
