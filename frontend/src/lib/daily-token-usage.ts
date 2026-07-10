import type { DailyTokenUsageRow } from "@/types";

const API_BASE = "";

export async function fetchDailyTokenUsageHistory(
  from: string,
  to: string,
  source?: string,
): Promise<DailyTokenUsageRow[]> {
  const params = new URLSearchParams({ from, to });
  if (source) params.set("source", source);
  const res = await fetch(`${API_BASE}/api/daily-token-usage/history?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed fetch daily token usage: ${res.statusText}`);
  return (await res.json()) as DailyTokenUsageRow[];
}

export interface TriggerDailyTokenUsageCollectResult {
  success: boolean;
  date: string;
  row: DailyTokenUsageRow | null;
  errors: string[];
}

export async function triggerDailyTokenUsageCollect(
  date?: string,
): Promise<TriggerDailyTokenUsageCollectResult> {
  const res = await fetch(`${API_BASE}/api/daily-token-usage/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(date ? { date } : {}),
  });
  if (!res.ok) throw new Error(`Failed collect daily token usage: ${res.statusText}`);
  return (await res.json()) as TriggerDailyTokenUsageCollectResult;
}