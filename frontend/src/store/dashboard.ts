import { create } from "zustand";
import { fetchState, fetchDiagnostics } from "@/lib/api-client";
import type { LatestState, SourceDiagnostics } from "@/types";

export type RefreshStatus = "idle" | "running" | "success" | "failed";

export interface DashboardState {
  data: LatestState | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  selectedRepoKey: string;
  hasEverLoaded: boolean;
  lastRefreshAt: string | null;
  lastSuccessfulRefreshAt: string | null;
  refreshStatus: RefreshStatus;
  manualRefreshStatus: RefreshStatus;
  manualRefreshErrorTimestamp: number | null;
  lastPollTimestamp: string | null;

  fetch: (repoKey?: string) => Promise<void>;
  diagnostics: SourceDiagnostics | null;
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
  diagnosticsHasLoaded: boolean;

  manualRefresh: () => Promise<void>;
  triggerAutoRefresh: () => Promise<void>;
  clearManualRefreshError: () => void;
  loadDiagnostics: () => Promise<void>;
}

type FetchKind = "manual" | "polled";

function startFetchFlags(isFirstLoad: boolean) {
  return isFirstLoad
    ? { isLoading: true, refreshStatus: "running" as const }
    : { isRefreshing: true, refreshStatus: "running" as const };
}

function applyFetchedState(
  state: DashboardState,
  data: LatestState,
  kind: FetchKind,
) {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    hasEverLoaded: true,
    selectedRepoKey: data.selectedRepoKey,
    lastRefreshAt: new Date().toISOString(),
    lastSuccessfulRefreshAt: data.lastSuccessfulRefreshAt,
    refreshStatus: "success" as const,
    manualRefreshStatus:
      kind === "manual" ? ("success" as const) : state.manualRefreshStatus,
    error: null,
    diagnostics: state.diagnosticsHasLoaded ? state.diagnostics : data.diagnostics,
    diagnosticsHasLoaded: state.diagnosticsHasLoaded || Boolean(data.diagnostics),
  };
}

function applyFetchError(
  state: DashboardState,
  error: unknown,
  kind: FetchKind,
) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isLoading: false,
    isRefreshing: false,
    error: message,
    refreshStatus: "failed" as const,
    manualRefreshStatus:
      kind === "manual" ? ("failed" as const) : state.manualRefreshStatus,
    manualRefreshErrorTimestamp:
      kind === "manual" ? Date.now() : state.manualRefreshErrorTimestamp,
  };
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  data: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
  selectedRepoKey: "barkley-clawd/signal-house",
  hasEverLoaded: false,
  lastRefreshAt: null,
  lastSuccessfulRefreshAt: null,
  refreshStatus: "idle",
  manualRefreshStatus: "idle",
  manualRefreshErrorTimestamp: null,
  lastPollTimestamp: null,
  diagnostics: null,
  diagnosticsLoading: false,
  diagnosticsError: null,
  diagnosticsHasLoaded: false,

  fetch: async (repoKey) => {
    const state = get();
    const repo = repoKey ?? state.selectedRepoKey;
    set({ ...startFetchFlags(!state.hasEverLoaded), error: null });
    try {
      const data = await fetchState(repo);
      set((s) => applyFetchedState(s, data, "polled"));
    } catch (err) {
      set((s) => applyFetchError(s, err, "polled"));
    }
  },

  manualRefresh: async () => {
    const state = get();
    set({
      ...startFetchFlags(!state.hasEverLoaded),
      error: null,
      manualRefreshStatus: "running",
    });
    try {
      const data = await fetchState(state.selectedRepoKey);
      set((s) => applyFetchedState(s, data, "manual"));
    } catch (err) {
      set((s) => applyFetchError(s, err, "manual"));
    }
  },

  triggerAutoRefresh: async () => {
    const state = get();
    try {
      set({ refreshStatus: "running" });
      const data = await fetchState(state.selectedRepoKey);
      const apiLastRefreshAt = data.lastSuccessfulRefreshAt;

      if (apiLastRefreshAt && apiLastRefreshAt !== state.lastPollTimestamp) {
        set((s) => ({
          ...applyFetchedState(s, data, "polled"),
          lastPollTimestamp: apiLastRefreshAt,
        }));
      } else {
        set({ lastPollTimestamp: apiLastRefreshAt, refreshStatus: "idle" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ refreshStatus: "failed", error: message });
    }
  },

  clearManualRefreshError: () => {
    set({ manualRefreshErrorTimestamp: null });
  },

  loadDiagnostics: async () => {
    set({ diagnosticsLoading: true, diagnosticsError: null });
    try {
      const data = await fetchDiagnostics();
      set({
        diagnostics: data,
        diagnosticsLoading: false,
        diagnosticsHasLoaded: true,
        diagnosticsError: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        diagnosticsLoading: false,
        diagnosticsHasLoaded: true,
        diagnosticsError: message,
      });
    }
  },
}));
