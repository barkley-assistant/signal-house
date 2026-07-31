/**
 * Dashboard API client + Zustand store.
 */

import { create } from "zustand";
import type { StatePayload } from "../../api/build-state";
import type { DiagnosticsPayload } from "../../diagnostics/sources";
import { formatNumber, formatCompact } from "../../shared/format";

export type { StatePayload, DiagnosticsPayload };

export interface RefreshStatus {
  inProgress: boolean;
  status: string;
  message: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

interface DashState {
  state: StatePayload | null;
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  refreshMessage: string | null;
  lastStateSync: number | null;
  diagnostics: DiagnosticsPayload | null;
  diagnosticsLoading: boolean;
  diagnosticsOpen: boolean;
  setState(payload: StatePayload): void;
  setLoading(v: boolean): void;
  setError(e: string | null): void;
  setRefreshing(v: boolean): void;
  setRefreshMessage(m: string | null): void;
  setDiagnostics(p: DiagnosticsPayload | null): void;
  setDiagnosticsLoading(v: boolean): void;
  setDiagnosticsOpen(v: boolean): void;
}

export const useDash = create<DashState>((set) => ({
  state: null,
  loading: true,
  error: null,
  refreshing: false,
  refreshMessage: null,
  lastStateSync: null,
  diagnostics: null,
  diagnosticsLoading: false,
  diagnosticsOpen: false,
  setState: (p) => set({ state: p, lastStateSync: Date.now(), loading: false }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e, loading: false }),
  setRefreshing: (v) => set({ refreshing: v }),
  setRefreshMessage: (m) => set({ refreshMessage: m }),
  setDiagnostics: (p) => set({ diagnostics: p, diagnosticsLoading: false }),
  setDiagnosticsLoading: (v) => set({ diagnosticsLoading: v }),
  setDiagnosticsOpen: (v) => set({ diagnosticsOpen: v }),
}));

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loadState(): Promise<void> {
  const { setState, setError } = useDash.getState();
  try {
    const payload = await fetchJson<StatePayload>("/api/state");
    setState(payload);
  } catch (err) {
    setError((err as Error).message);
  }
}

export async function loadDiagnostics(): Promise<void> {
  const { setDiagnostics, setDiagnosticsLoading } = useDash.getState();
  setDiagnosticsLoading(true);
  try {
    const payload = await fetchJson<DiagnosticsPayload>("/api/diagnostics");
    setDiagnostics(payload);
  } catch (err) {
    setDiagnostics(null);
    setDiagnosticsLoading(false);
  }
}

export async function triggerRefresh(): Promise<void> {
  const { setRefreshing, setRefreshMessage } = useDash.getState();
  setRefreshing(true);
  setRefreshMessage("Starting refresh…");
  try {
    const res = await fetchJson<{ status: string; message?: string }>("/api/refresh", { method: "POST" });
    setRefreshMessage(res.status === "success" ? "Refresh complete" : res.status === "partial" ? "Refresh partially completed" : `Refresh: ${res.status}`);
  } catch (err) {
    setRefreshMessage((err as Error).message);
  } finally {
    setRefreshing(false);
  }
}

export async function resetLock(): Promise<void> {
  const { setRefreshMessage } = useDash.getState();
  try {
    await fetchJson<{ status: string }>("/api/refresh/reset-lock", { method: "POST" });
    setRefreshMessage("Refresh lock cleared");
  } catch (err) {
    setRefreshMessage((err as Error).message);
  }
}

/** Poll /api/state on an interval (~30s) while the page is open. */
export function startPolling(intervalMs = 30_000): () => void {
  void loadState();
  const id = setInterval(() => void loadState(), intervalMs);
  return () => clearInterval(id);
}

export interface TrendPoint {
  date: string;
  cost: number | null;
  tokens: number | null;
}

/** Load the daily spend trend for the Agent Spend chart. */
export async function loadTrend(): Promise<TrendPoint[]> {
  try {
    const res = await fetchJson<{ points: TrendPoint[] }>("/api/daily/spend");
    return res.points;
  } catch {
    return [];
  }
}

export { formatNumber, formatCompact };
