/**
 * CacheSavingsCard — three tiles (hit rate / cache read / saved) plus a
 * compact by-provider breakdown. Mirrors the same `useDash.setState` /
 * `emptyState` / happy-dom pattern as tests/unit/web/dashboard.test.tsx.
 *
 * The card never mounts echarts so the echarts.init spy isn't needed.
 */

import { beforeEach, describe, expect, test, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import type { StatePayload } from "../../../src/api/build-state";
import { useDash } from "../../../src/web/state/store";
import { CacheSavings } from "../../../src/web/components/CacheSavingsCard";

beforeEach(() => {
  cleanup();
  useDash.setState({
    state: null,
    loading: true,
    error: null,
    refreshing: false,
    refreshMessage: null,
    lastStateSync: null,
    diagnostics: null,
    diagnosticsLoading: false,
    diagnosticsOpen: false,
  });
});

afterEach(() => cleanup());

function emptyState(overrides: Partial<StatePayload> = {}): StatePayload {
  return {
    window: { start: "2026-07-01", end: "2026-07-31", days: 30 },
    summary: { throughput: null, cycleTime: null, ci: null, staleWork: null, costAndTokens: null },
    usage: null,
    attention: [],
    status: {
      refresh: {
        status: "success",
        inProgress: false,
        lastRunStartedAt: "2026-07-31T10:00:00Z",
        lastRunFinishedAt: "2026-07-31T10:00:05Z",
        lastSuccessAt: "2026-07-31T10:00:05Z",
        lastFailureAt: null,
        lastFailureMessage: null,
        lastManualRefreshAt: null,
        lockOwner: null,
        partialData: false,
      },
      freshness: { state: "fresh", lastUpdatedAt: Date.now(), staleThresholdMinutes: 15 },
      partialData: false,
      sources: [],
      coverageWarnings: [],
    },
    ...overrides,
  };
}

describe("CacheSavings", () => {
  test("renders the empty/zero state when usage is absent", () => {
    useDash.setState({ state: emptyState() });
    render(<CacheSavings />);
    // Card header is visible.
    expect(screen.getByText("Cache savings")).toBeTruthy();
    // No cache activity → em-dash for hit rate, 0 for tokens, $0.00 for saved.
    // The by-provider block is hidden entirely.
    expect(screen.getByText("of input tokens served from cache")).toBeTruthy();
    // formatPercent(null) → "—" so we see at least one em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.queryByText("By provider")).toBeNull();
  });

  test("renders hit rate, cache read tokens, and saved when usage has data", () => {
    useDash.setState({
      state: emptyState({
        usage: {
          totalSessions: 100,
          totalMessages: 1000,
          totalTokens: 1_000_000,
          totalCost: 50,
          totalCacheReadTokens: 500_000,
          totalCacheWriteTokens: 1000,
          totalCacheSavingsUsd: 7.5,
          cacheHitRate: 0.5,
          bySource: {
            opencode: { sessions: 50, cost: 25, tokens: 500_000, cacheReadTokens: 250_000, cacheSavingsUsd: 3.75 },
            hermes: { sessions: 50, cost: 25, tokens: 500_000, cacheReadTokens: 250_000, cacheSavingsUsd: 3.75 },
          },
          byModel: [],
        },
      }),
    });
    render(<CacheSavings />);
    // 50% rate, 500K tokens, $7.50 saved.
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("$7.50")).toBeTruthy();
    // formatCompact(500_000) → "500K".
    expect(screen.getByText(/500K/)).toBeTruthy();
    // By-provider section appears with both providers.
    expect(screen.getByText("By provider")).toBeTruthy();
    expect(screen.getAllByText("OpenCode").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Hermes").length).toBeGreaterThan(0);
  });

  test("renders the per-provider savings line with formatted tokens + dollars", () => {
    useDash.setState({
      state: emptyState({
        usage: {
          totalSessions: 10,
          totalMessages: 100,
          totalTokens: 1_000_000,
          totalCost: 5,
          totalCacheReadTokens: 1_000_000,
          totalCacheWriteTokens: null,
          totalCacheSavingsUsd: 15.0,
          cacheHitRate: 1.0,
          bySource: {
            opencode: { sessions: 10, cost: 5, tokens: 1_000_000, cacheReadTokens: 1_000_000, cacheSavingsUsd: 15.0 },
          },
          byModel: [],
        },
      }),
    });
    render(<CacheSavings />);
    // Hit rate 100%, cache read 1M tokens, $15 saved.
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("$15.00")).toBeTruthy();
    // The provider row carries the "OpenCode" name + a tokens + $ summary.
    expect(screen.getByText("OpenCode")).toBeTruthy();
    // formatCompact(1_000_000) → "1M".
    expect(screen.getByText(/1M\s+tokens ·/)).toBeTruthy();
  });

  test("by-provider line shows '$0.00' (not em-dash) when source has reads but no rate", () => {
    useDash.setState({
      state: emptyState({
        usage: {
          totalSessions: 5,
          totalMessages: 10,
          totalTokens: 1000,
          totalCost: 1,
          totalCacheReadTokens: 5000,
          totalCacheWriteTokens: 0,
          // Aggregated savings is null because none of the byModel rows have
          // a rate — but per-source savings was computed and is also null.
          totalCacheSavingsUsd: null,
          cacheHitRate: 0.5,
          bySource: {
            opencode: { sessions: 5, cost: 1, tokens: 1000, cacheReadTokens: 5000, cacheSavingsUsd: null },
          },
          byModel: [
            // A model without a rate so the savings split falls back to null.
            { model: "non-mapped-model", family: null, sessions: 5, cost: 1, tokens: 1000, cacheReadTokens: 5000, cacheHitRate: 0.5, cacheSavingsUsd: null },
          ],
        },
      }),
    });
    render(<CacheSavings />);
    expect(screen.getByText("By provider")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    // The provider savings is null → renderSaved falls through to "$0.00".
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
  });
});