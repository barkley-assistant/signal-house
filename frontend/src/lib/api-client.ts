import type { LatestState, SourceDiagnostics } from "@/types";

const API_BASE = "";

export async function fetchState(repoKey?: string): Promise<LatestState> {
  const params = repoKey ? `?repoKey=${repoKey}` : "";
  const res = await fetch(`${API_BASE}/api/state${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch state: ${res.statusText}`);
  return (await res.json()) as LatestState;
}

export interface TriggerRefreshResult {
  started: boolean;
  skipped?: boolean;
  skippedReason?: string;
}

export async function triggerRefresh(): Promise<TriggerRefreshResult> {
  const res = await fetch(`${API_BASE}/api/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to trigger refresh: ${res.statusText}`);
  return (await res.json()) as TriggerRefreshResult;
}

export async function fetchDiagnostics(): Promise<SourceDiagnostics> {
  const res = await fetch(`${API_BASE}/api/diagnostics`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to fetch diagnostics: ${res.statusText}`);
  return (await res.json()) as SourceDiagnostics;
}
