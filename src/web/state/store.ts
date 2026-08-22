/**
 * Dashboard API client + Zustand store.
 */

import { create } from "zustand";
import type { StatePayload } from "../../api/build-state";
import type { DiagnosticsPayload } from "../../diagnostics/sources";
import { DEFAULT_WINDOW_DAYS, isWindowDays, type WindowDays } from "../../shared/window";

export type { StatePayload, DiagnosticsPayload };

/** localStorage key for the selected time window (same persistence pattern
 *  as the by-model sort state). */
export const WINDOW_STORAGE_KEY = "signal-house:window-days";

export function readStoredDays(): WindowDays {
  try {
    const raw = localStorage.getItem(WINDOW_STORAGE_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (isWindowDays(n)) return n;
    }
  } catch {
    /* storage unavailable or corrupt — fall through to the default */
  }
  return DEFAULT_WINDOW_DAYS;
}

export function storeWindowDays(days: WindowDays): void {
  try {
    localStorage.setItem(WINDOW_STORAGE_KEY, String(days));
  } catch {
    /* storage unavailable — the window still applies for this session */
  }
}

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
  /** Selected dashboard time window (7/30/90 days), restored from storage. */
  days: WindowDays;
  setState(payload: StatePayload): void;
  setLoading(v: boolean): void;
  setError(e: string | null): void;
  setRefreshing(v: boolean): void;
  setRefreshMessage(m: string | null): void;
  setDiagnostics(p: DiagnosticsPayload | null): void;
  setDiagnosticsLoading(v: boolean): void;
  setDiagnosticsOpen(v: boolean): void;
  setDays(d: WindowDays): void;
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
  days: readStoredDays(),
  setState: (p) => set({ state: p, lastStateSync: Date.now(), loading: false }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e, loading: false }),
  setRefreshing: (v) => set({ refreshing: v }),
  setRefreshMessage: (m) => set({ refreshMessage: m }),
  setDiagnostics: (p) => set({ diagnostics: p, diagnosticsLoading: false }),
  setDiagnosticsLoading: (v) => set({ diagnosticsLoading: v }),
  setDiagnosticsOpen: (v) => set({ diagnosticsOpen: v }),
  setDays: (d) => set({ days: d }),
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
  const { setState, setError, days, state: current } = useDash.getState();
  try {
    const payload = await fetchJson<StatePayload>(`/api/state?days=${days}`);
    setState(payload);
  } catch (err) {
    // Transient network blips (background-tab throttling wake-up, wifi
    // re-association, laptop sleep resume) surface as TypeError/NetworkError
    // on the FIRST fetch after returning to the tab. When we still hold
    // stale-but-renderable data, stay quiet — the visibility handler below
    // refires immediately and the next success clears any lingering error.
    // A hard failure with nothing on screen still gets the banner.
    const transient = err instanceof TypeError;
    if (!transient || !current) {
      setError((err as Error).message);
    }
  }
}

export async function loadDiagnostics(): Promise<void> {
  const { setDiagnostics, setDiagnosticsLoading } = useDash.getState();
  setDiagnosticsLoading(true);
  try {
    const payload = await fetchJson<DiagnosticsPayload>("/api/diagnostics");
    setDiagnostics(payload);
  } catch {
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

/** Poll /api/state on an interval (~30s) while the page is open.
 *  Refetches immediately when the tab becomes visible again: browsers
 *  throttle timers in background tabs (and the network stack may need a
 *  moment after resume), so without this the first paint back on the tab
 *  can show stale data or a spurious network error until the next tick. */
export function startPolling(intervalMs = 30_000): () => void {
  void loadState();
  const id = setInterval(() => {
    if (document.visibilityState === "visible") void loadState();
  }, intervalMs);
  const onVisible = () => {
    if (document.visibilityState === "visible") void loadState();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export interface TrendPoint {
  date: string;
  cost: number | null;
  tokens: number | null;
  cacheRead: number | null;
}

/** Load the daily spend trend for the Agent Spend chart, windowed. */
export async function loadTrend(days: WindowDays): Promise<TrendPoint[]> {
  try {
    const res = await fetchJson<{ points: TrendPoint[] }>(`/api/daily/spend?days=${days}`);
    return res.points;
  } catch {
    return [];
  }
}

export interface DeliveryPoint {
  date: string;
  ci: {
    totalRuns: number;
    passCount: number;
    failCount: number;
    passRate: number | null;
  } | null;
  /** null = no commit telemetry for this day (renders as a gap, never 0). */
  commits: number | null;
  /** null = no PR-merge telemetry for this day (renders as a gap, never 0). */
  prsMerged: number | null;
}

/** Load the daily delivery trend for the Delivery panel, windowed. */
export async function loadDeliveryTrend(days: WindowDays): Promise<DeliveryPoint[]> {
  try {
    const res = await fetchJson<{ points: DeliveryPoint[] }>(`/api/daily/delivery?days=${days}`);
    return res.points;
  } catch {
    return [];
  }
}
