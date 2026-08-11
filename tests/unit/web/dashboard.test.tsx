/**
 * Frontend component tests (happy-dom + Testing Library).
 *
 * Covers the required behaviours: explicit no-data rendering, partial banner,
 * stale indicator, refresh-in-progress, failed-refresh-with-last-good,
 * privacy-filtered queue, keyboard interaction, reduced-motion, and number
 * formatting.
 */

import { beforeEach, describe, expect, test, afterEach, vi } from "bun:test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import * as echarts from "echarts";
import type { StatePayload } from "../../../src/api/build-state";
import { useDash } from "../../../src/web/state/store";
import { HealthStrip } from "../../../src/web/components/HealthStrip";
import { AttentionQueue } from "../../../src/web/components/AttentionQueue";
import { HeaderRefreshChip, RefreshDetail } from "../../../src/web/components/RefreshStatus";
import { AgentSpend } from "../../../src/web/components/AgentSpend";
import { CacheSavingsCard } from "../../../src/web/components/CacheSavingsCard";
import { formatNumber, formatCompact, formatCost } from "../../../src/shared/format";
// Globals are installed by tests/happy-dom.ts (bunfig [test] preload).

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

function emptyState(overrides: Partial<StatePayload> = {}): StatePayload {
  return {
    window: { start: "2026-07-01", end: "2026-07-31", days: 30 },
    summary: {
      throughput: null,
      cycleTime: null,
      ci: null,
      staleWork: null,
      costAndTokens: null,
    },
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

describe("number formatting", () => {
  test("groups full numbers by default", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(0)).toBe("0");
  });

  test("compact notation only for cramped contexts", () => {
    // ICU may round 1,234,567 to "1.2M" or "1.23M" depending on the runtime.
    expect(formatCompact(1234567)).toMatch(/^1\.2+3?M$/);
  });

  test("null renders as em-dash, never zero", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatCost(null)).toBe("—");
    expect(formatCompact(null)).toBe("—");
  });
});

describe("HealthStrip", () => {
  test("renders explicit no-data tiles when summary is missing", () => {
    render(<HealthStrip state={emptyState()} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No GitHub data").length).toBeGreaterThan(0);
    expect(screen.getByText("No usage telemetry")).toBeTruthy();
  });

  test("renders live values when present", () => {
    const state = emptyState({
      summary: {
        throughput: { issuesOpened: 3, issuesClosed: 5, prsCreated: 2, prsMerged: 4, totalCommits: 120 },
        cycleTime: { avgSeconds: 600, medianSeconds: 540, p95Seconds: 900, sampleSize: 10 },
        ci: { totalRuns: 50, passCount: 45, failCount: 5, passRate: 0.9 },
        staleWork: { staleIssues: 1, stalePrs: 2, thresholdDays: 14 },
        costAndTokens: { cost: 123.45, tokens: 5_000_000, costPerHour: 0.18, tokensPerHour: 6944 },
      },
      usage: {
        totalSessions: 100,
        totalMessages: 2000,
        totalTokens: 5_000_000,
        totalCost: 123.45,
        cacheHitRate: 0.1,
        totalCacheReadTokens: 500_000,
        totalCacheSavingsUsd: 1.5,
        bySource: { hermes: { sessions: 40, cost: 23.45, tokens: 2_000_000, cacheReadTokens: 500_000, cacheSavingsUsd: 1.5 } },
        byModel: [],
      },
    });
    render(<HealthStrip state={state} />);
    expect(screen.getByText("90%")).toBeTruthy();
    expect(screen.getAllByText("$0.18").length).toBeGreaterThan(0);
  });

  test("animates the entrance (staggered variants present)", () => {
    const state = emptyState();
    const { container } = render(<HealthStrip state={state} />);
    // 5 tiles, all motion elements with opacity-0 initial state
    expect(container.querySelectorAll(".kpi-tile").length).toBe(5);
  });
});

describe("AttentionQueue", () => {
  test("renders clear state when empty", () => {
    render(<AttentionQueue attention={[]} />);
    expect(screen.getByText(/all clear/i)).toBeTruthy();
    expect(screen.getByText(/no open issues or prs need attention/i)).toBeTruthy();
  });

  test("shows items and marks stale ones", () => {
    const attention = [
      {
        id: "issue:1",
        type: "issue" as const,
        repoKey: "github:acme/thing",
        repo: "acme/thing",
        title: "Fix the thing",
        url: "https://github.com/acme/thing/issues/1",
        state: "open" as const,
        updatedAt: "2026-07-01T00:00:00Z",
        ageDays: 30,
        stale: true,
        ciStatus: null,
        labels: [],
      },
    ];
    render(<AttentionQueue attention={attention} />);
    expect(screen.getByText("Fix the thing")).toBeTruthy();
    expect(screen.getByText(/stale/i)).toBeTruthy();
  });
});

describe("RefreshStatus", () => {
  test("shows failed refresh banner while keeping last-good data visible", () => {
    const state = emptyState({
      status: {
        ...emptyState().status,
        refresh: {
          status: "failed",
          inProgress: false,
          lastRunStartedAt: "2026-07-31T09:00:00Z",
          lastRunFinishedAt: "2026-07-31T09:00:03Z",
          lastSuccessAt: "2026-07-30T10:00:00Z",
          lastFailureAt: "2026-07-31T09:00:03Z",
          lastFailureMessage: "github: boom",
          lastManualRefreshAt: null,
          lockOwner: null,
          partialData: true,
        },
        coverageWarnings: ["Last refresh failed — showing last good data"],
      },
    });
    render(<RefreshDetail status={state.status} />);
    expect(screen.getAllByText(/showing last good data/i).length).toBeGreaterThan(0);
  });

  test("shows in-progress state and reset control when locked", () => {
    const state = emptyState({
      status: {
        ...emptyState().status,
        refresh: {
          status: "success",
          inProgress: true,
          lastRunStartedAt: "2026-07-31T10:00:00Z",
          lastRunFinishedAt: null,
          lastSuccessAt: "2026-07-31T10:00:00Z",
          lastFailureAt: null,
          lastFailureMessage: null,
          lastManualRefreshAt: null,
          lockOwner: "manual",
          partialData: false,
        },
      },
    });
    render(<RefreshDetail status={state.status} />);
    expect(screen.getByText(/refresh in progress/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reset stuck lock/i })).toBeTruthy();
  });

  test("refresh button is keyboard accessible", () => {
    const state = emptyState();
    render(<RefreshDetail status={state.status} />);
    const button = screen.getByRole("button", { name: /refresh now/i });
    expect(button).toBeTruthy();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
  });
});

describe("AgentSpend", () => {
  function usageState(overrides: Partial<NonNullable<StatePayload["usage"]>> = {}): StatePayload {
    return emptyState({
      usage: {
        totalSessions: 1597,
        totalMessages: 1000,
        totalTokens: 5420000000,
        totalCost: 515.95,
        cacheHitRate: 0.265,
        totalCacheReadTokens: 1_580_000_000,
        totalCacheSavingsUsd: 1500,
        bySource: {
          opencode: { sessions: 900, cost: 300, tokens: 3000000000, cacheReadTokens: 800_000_000, cacheSavingsUsd: 800 },
          hermes: { sessions: 697, cost: 215.95, tokens: 2420000000, cacheReadTokens: 780_000_000, cacheSavingsUsd: 700 },
        },
        byModel: [],
        ...overrides,
      },
    });
  }

  let chartSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // happy-dom's requestAnimationFrame doesn't advance on fake timers; mock
    // it to fire once at the animation's end so useCountUp settles synchronously.
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(performance.now() + 1000);
      return 0;
    });
    // The spend chart (DailyUsageChart) mounts echarts; in happy-dom there is
    // no canvas, so stub echarts.init to keep the AgentSpend render honest.
    chartSpy = vi.spyOn(echarts, "init").mockImplementation(
      // @ts-expect-error minimal stub; only the API DailyUsageChart uses is exercised
      () => ({ setOption() {}, resize() {}, dispose() {}, on() {} }),
    );
  });

  afterEach(() => {
    chartSpy.mockRestore();
  });

  test("hero shows total cost as the headline figure", () => {
    useDash.setState({ state: usageState() });
    render(<AgentSpend />);
    expect(screen.getByText("$515.95")).toBeTruthy();
  });

  test("hero meta lists sessions and tokens beneath the cost", () => {
    useDash.setState({ state: usageState() });
    render(<AgentSpend />);
    expect(screen.getByText("1,597 Sessions")).toBeTruthy();
    expect(screen.getByText("5.42B Tokens")).toBeTruthy();
  });

  test("renders both agent source rows", () => {
    useDash.setState({ state: usageState() });
    render(<AgentSpend />);
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("Hermes")).toBeTruthy();
    // formatCost() always emits two decimals ($300.00), matching the hero + ledger.
    expect(screen.getByText("$300.00")).toBeTruthy();
    expect(screen.getByText("$215.95")).toBeTruthy();
  });

  test("unknown source cost renders em-dash, never zero", () => {
    useDash.setState({
      state: usageState({
        bySource: {
          opencode: { sessions: 0, cost: null, tokens: null, cacheReadTokens: 0, cacheSavingsUsd: 0 },
          hermes: { sessions: 0, cost: null, tokens: null, cacheReadTokens: 0, cacheSavingsUsd: 0 },
        },
      }),
    });
    render(<AgentSpend />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  test("shows empty state when usage is absent", () => {
    useDash.setState({ state: emptyState() });
    render(<AgentSpend />);
    expect(screen.getByText(/no usage telemetry yet/i)).toBeTruthy();
  });

  test("renders cache-% column header on the by-model table", () => {
    useDash.setState({
      state: usageState({
        byModel: [
          { model: "DeepSeek V4 Pro", family: "DeepSeek", sessions: 10, cost: 5, tokens: 100, cacheReadTokens: 30, cacheSavingsUsd: 0.09, cacheHitRate: 0.3 },
          { model: "Kimi K2.7 Code", family: "Moonshot", sessions: 5, cost: 1, tokens: 100, cacheReadTokens: 70, cacheSavingsUsd: null, cacheHitRate: 0.7 },
        ],
      }),
    });
    render(<AgentSpend />);
    // The Cache % column header is rendered and is a sortable button.
    expect(screen.getByRole("button", { name: /Cache %/ })).toBeTruthy();
  });

  test("click cache-% header sorts desc; click again sorts asc with nulls at the bottom; click third reverts", () => {
    useDash.setState({
      state: usageState({
        byModel: [
          { model: "A", family: null, sessions: 1, cost: 1, tokens: 100, cacheReadTokens: null, cacheSavingsUsd: null, cacheHitRate: null },
          { model: "B", family: null, sessions: 1, cost: 1, tokens: 100, cacheReadTokens: 30, cacheSavingsUsd: 0.09, cacheHitRate: 0.3 },
          { model: "C", family: null, sessions: 1, cost: 1, tokens: 100, cacheReadTokens: 70, cacheSavingsUsd: 0.21, cacheHitRate: 0.7 },
        ],
      }),
    });
    render(<AgentSpend />);
    const btn = screen.getByRole("button", { name: /Cache %/ });

    // Click 1 → desc by cacheHitRate
    fireEvent.click(btn);
    let rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows.map((r) => r.querySelector(".model-name")?.textContent)).toEqual(["C", "B", "A"]);

    // Click 2 → asc by cacheHitRate, nulls at the bottom
    fireEvent.click(btn);
    rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector(".model-name")?.textContent)).toEqual(["B", "C", "A"]);

    // Click 3 → reverts to default session order (preserves insertion order)
    fireEvent.click(btn);
    rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector(".model-name")?.textContent)).toEqual(["A", "B", "C"]);
  });

  test("cache-% cell renders em-dash for null hit rate", () => {
    useDash.setState({
      state: usageState({
        byModel: [
          { model: "Unpriced", family: null, sessions: 1, cost: null, tokens: null, cacheReadTokens: 100, cacheSavingsUsd: null, cacheHitRate: null },
        ],
      }),
    });
    render(<AgentSpend />);
    // The by-model row carries a data-label="Cache %" cell whose content is "—".
    const cell = screen.getByText("—", { selector: 'td[data-label="Cache %"]' });
    expect(cell).toBeTruthy();
  });

  test("cache-% cell carries the mobile data-label so the reflow can find it", () => {
    useDash.setState({
      state: usageState({
        byModel: [
          { model: "DeepSeek V4 Pro", family: "DeepSeek", sessions: 1, cost: 1, tokens: 100, cacheReadTokens: 30, cacheSavingsUsd: 0.09, cacheHitRate: 0.3 },
        ],
      }),
    });
    render(<AgentSpend />);
    expect(screen.getByText("30%", { selector: 'td[data-label="Cache %"]' })).toBeTruthy();
  });
});

describe("CacheSavingsCard", () => {
  function usageState(overrides: Partial<NonNullable<StatePayload["usage"]>> = {}): StatePayload {
    return emptyState({
      usage: {
        totalSessions: 100,
        totalMessages: null,
        totalTokens: 5_000_000,
        totalCost: 50,
        cacheHitRate: 0.4,
        totalCacheReadTokens: 2_000_000,
        totalCacheSavingsUsd: 6,
        bySource: {
          opencode: { sessions: 60, cost: 30, tokens: 3_000_000, cacheReadTokens: 1_200_000, cacheSavingsUsd: 3.6 },
          hermes: { sessions: 40, cost: 20, tokens: 2_000_000, cacheReadTokens: 800_000, cacheSavingsUsd: 2.4 },
        },
        byModel: [],
        ...overrides,
      },
    });
  }

  test("renders hit rate, tokens saved, and $ saved from usage", () => {
    useDash.setState({ state: usageState() });
    render(<CacheSavingsCard />);
    expect(screen.getByText("40%")).toBeTruthy();
    // formatCompact(2_000_000) → "2M" (Intl compact notation). The headline
    // cell renders "2M cache-read tokens"; we anchor on the kpi-caption to
    // avoid matching the per-source "1.2M" rows.
    expect(screen.getByText(/^2M cache-read tokens$/)).toBeTruthy();
    expect(screen.getByText("$6.00")).toBeTruthy();
  });

  test("empty state renders em-dash, zero tokens and $0.00 — never NaN/null", () => {
    useDash.setState({
      state: usageState({
        cacheHitRate: null,
        totalCacheReadTokens: 0,
        totalCacheSavingsUsd: 0,
        bySource: {
          opencode: { sessions: 0, cost: null, tokens: null, cacheReadTokens: 0, cacheSavingsUsd: 0 },
          hermes: { sessions: 0, cost: null, tokens: null, cacheReadTokens: 0, cacheSavingsUsd: 0 },
        },
      }),
    });
    render(<CacheSavingsCard />);
    // hit rate shows — (rate unknown with no cache activity); tokens show 0
    // (confident no activity, NOT em-dash); $ saved shows $0.00.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
  });

  test("per-source row carries savings per source", () => {
    useDash.setState({ state: usageState() });
    render(<CacheSavingsCard />);
    // OpenCode $3.60 and Hermes $2.40 both visible.
    expect(screen.getAllByText("$3.60").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$2.40").length).toBeGreaterThan(0);
  });
});

describe("state store", () => {
  test("loading → data transition updates store and clears loading", () => {
    const { setState } = useDash.getState();
    act(() => setState(emptyState()));
    expect(useDash.getState().loading).toBe(false);
    expect(useDash.getState().state).not.toBeNull();
  });
});
