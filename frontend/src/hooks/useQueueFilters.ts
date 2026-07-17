import { useEffect, useState } from "react";

export type TypeFilter = "issues" | "prs" | "all";
export type ConditionFilter = "stale" | "blocked" | "failing" | "all";
export type SortMode = "oldest" | "urgent";

const TYPE_KEY = "sh-queue-type";
const CONDITION_KEY = "sh-queue-cond";
const SORT_KEY = "sh-queue-sort";

const TYPE_VALUES: TypeFilter[] = ["issues", "prs", "all"];
const CONDITION_VALUES: ConditionFilter[] = ["stale", "blocked", "failing", "all"];
const SORT_VALUES: SortMode[] = ["oldest", "urgent"];

/**
 * Reads a sessionStorage value, falling back to `fallback` when storage is
 * unavailable (SSR) or the stored value is not a known member of `allowed`.
 * The validity check guards against corrupt or stale values from a previous
 * schema version.
 */
export function loadFilter<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.sessionStorage.getItem(key);
    if (value === null) return fallback;
    return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

export interface QueueFilters {
  typeFilter: TypeFilter;
  setTypeFilter: (value: TypeFilter) => void;
  conditionFilter: ConditionFilter;
  setConditionFilter: (value: ConditionFilter) => void;
  sortMode: SortMode;
  setSortMode: (value: SortMode) => void;
}

export function useQueueFilters(): QueueFilters {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() =>
    loadFilter(TYPE_KEY, "all", TYPE_VALUES),
  );
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(() =>
    loadFilter(CONDITION_KEY, "all", CONDITION_VALUES),
  );
  const [sortMode, setSortMode] = useState<SortMode>(() =>
    loadFilter(SORT_KEY, "urgent", SORT_VALUES),
  );

  useEffect(() => {
    try {
      window.sessionStorage.setItem(TYPE_KEY, typeFilter);
    } catch {
      /* sessionStorage unavailable — non-fatal */
    }
  }, [typeFilter]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(CONDITION_KEY, conditionFilter);
    } catch {
      /* sessionStorage unavailable — non-fatal */
    }
  }, [conditionFilter]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SORT_KEY, sortMode);
    } catch {
      /* sessionStorage unavailable — non-fatal */
    }
  }, [sortMode]);

  return {
    typeFilter,
    setTypeFilter,
    conditionFilter,
    setConditionFilter,
    sortMode,
    setSortMode,
  };
}
