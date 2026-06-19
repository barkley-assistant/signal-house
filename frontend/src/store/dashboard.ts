import { create } from "zustand";
import { fetchState } from "@/lib/api-client";

export interface DashboardState {
  data: unknown | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  selectedRepoKey: string;
  hasEverLoaded: boolean;
  lastRefreshAt: string | null;
  lastSuccessfulRefreshAt: string | null;
  refreshStatus: "idle" | "running" | "success" | "failed";
  manualRefreshStatus: "idle" | "running" | "success" | "failed";
  manualRefreshErrorTimestamp: number | null;
  lastPollTimestamp: string | null;

  fetch: (repoKey?: string) => Promise<void>;
  manualRefresh: () => Promise<void>;
  triggerAutoRefresh: () => Promise<void>;
  clearManualRefreshError: () => void;
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

  fetch: async (repoKey) => {
    const state = get();
    const repo = repoKey ?? state.selectedRepoKey;
    const isFirstLoad = !state.hasEverLoaded;

    if (isFirstLoad) {
      set({ isLoading: true, error: null, refreshStatus: "running" });
    } else {
      set({ isRefreshing: true, refreshStatus: "running", error: null });
    }

    try {
      const data = await fetchState(repo);
      const stateData = data as Record<string, unknown>;
      set({
        data,
        isLoading: false,
        isRefreshing: false,
        hasEverLoaded: true,
        selectedRepoKey: repo,
        lastRefreshAt: new Date().toISOString(),
        lastSuccessfulRefreshAt:
          (stateData.lastSuccessfulRefreshAt as string) ?? new Date().toISOString(),
        refreshStatus: "success",
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        isRefreshing: false,
        error: String(err),
        refreshStatus: "failed",
      });
    }
  },

  manualRefresh: async () => {
    const state = get();
    const isFirstLoad = !state.hasEverLoaded;

    if (isFirstLoad) {
      set({
        isLoading: true,
        error: null,
        manualRefreshStatus: "running",
        refreshStatus: "running",
      });
    } else {
      set({
        isRefreshing: true,
        refreshStatus: "running",
        manualRefreshStatus: "running",
        error: null,
      });
    }

    try {
      const data = await fetchState(state.selectedRepoKey);
      const stateData = data as Record<string, unknown>;
      set({
        data,
        isLoading: false,
        isRefreshing: false,
        hasEverLoaded: true,
        lastRefreshAt: new Date().toISOString(),
        lastSuccessfulRefreshAt:
          (stateData.lastSuccessfulRefreshAt as string) ?? new Date().toISOString(),
        refreshStatus: "success",
        manualRefreshStatus: "success",
        error: null,
      });
    } catch (err) {
      set({
        isLoading: false,
        isRefreshing: false,
        error: String(err),
        refreshStatus: "failed",
        manualRefreshStatus: "failed",
        manualRefreshErrorTimestamp: Date.now(),
      });
    }
  },

  triggerAutoRefresh: async () => {
    const state = get();

    try {
      set({ refreshStatus: "running" });
      const data = await fetchState(state.selectedRepoKey);
      const stateData = data as Record<string, unknown>;
      const apiLastRefreshAt = (stateData.lastSuccessfulRefreshAt as string) ?? null;

      if (apiLastRefreshAt && apiLastRefreshAt !== state.lastPollTimestamp) {
        set({
          data,
          lastRefreshAt: new Date().toISOString(),
          lastSuccessfulRefreshAt: apiLastRefreshAt,
          lastPollTimestamp: apiLastRefreshAt,
          refreshStatus: "success",
          hasEverLoaded: true,
          error: null,
        });
      } else {
        set({
          lastPollTimestamp: apiLastRefreshAt,
          refreshStatus: "idle",
        });
      }
    } catch (err) {
      set({
        refreshStatus: "failed",
        error: String(err),
      });
    }
  },

  clearManualRefreshError: () => {
    set({ manualRefreshErrorTimestamp: null });
  },
}));
