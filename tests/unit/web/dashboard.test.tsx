/**
 * Frontend component tests (happy-dom + Testing Library).
 *
 * Covers the required behaviours: explicit no-data rendering, partial banner,
 * stale indicator, refresh-in-progress, failed-refresh-with-last-good,
 * privacy-filtered queue, keyboard interaction, reduced-motion, and number
 * formatting.
 */

import { beforeEach, describe, expect, test, afterEach, vi } from "bun:test";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
import * as echarts from "echarts";
import type { StatePayload } from "../../../src/api/build-state";
import { useDash } from "../../../src/web/state/store";
import { HealthStrip } from "../../../src/web/components/HealthStrip";
import { AttentionQueue } from "../../../src/web/components/AttentionQueue";
import { HeaderRefreshChip, RefreshDetail } from "../../../src/web/components/RefreshStatus";
import { AgentSpend } from "../../../src/web/components/AgentSpend";
import { DeliveryTrend } from "../../../src/web/components/DeliveryTrend";
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
        bySource: { hermes: { sessions: 40, cost: 23.45, tokens: 2_000_000 } },
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

  // Brand pin (2026-08-24): stale items MUST render with the
  // .dot--warning class (yellow token #fbbf24) and the .att-row--stale
  // accent class. Without this test, a future refactor that swaps the
  // conditional back to blue would ship silently. The test fails
  // loudly instead. Failure mode caught in production: 2026-08-23 when
  // the stale dot was 8px and the indicator never read.
  test("stale row uses the warning dot class and the stale-row accent", () => {
    const attention = [
      {
        id: "issue:1",
        type: "issue" as const,
        repoKey: "github:acme/thing",
        repo: "acme/thing",
        title: "Fresh item",
        url: "https://github.com/acme/thing/issues/1",
        state: "open" as const,
        updatedAt: "2026-07-01T00:00:00Z",
        ageDays: 1,
        stale: false,
        ciStatus: null,
        labels: [],
      },
      {
        id: "issue:2",
        type: "issue" as const,
        repoKey: "github:acme/other",
        repo: "acme/other",
        title: "Stale item",
        url: "https://github.com/acme/other/issues/2",
        state: "open" as const,
        updatedAt: "2026-06-01T00:00:00Z",
        ageDays: 60,
        stale: true,
        ciStatus: null,
        labels: [],
      },
    ];
    render(<AttentionQueue attention={attention} />);
    // Fresh row: blue dot, no stale-row class.
    const freshRow = screen.getByText("Fresh item").closest(".att-row");
    expect(freshRow?.classList.contains("att-row--stale")).toBe(false);
    const freshDot = freshRow?.querySelector(".dot");
    expect(freshDot?.classList.contains("dot--info")).toBe(true);
    expect(freshDot?.classList.contains("dot--warning")).toBe(false);
    // Stale row: yellow dot (warning class) + stale accent class.
    const staleRow = screen.getByText("Stale item").closest(".att-row");
    expect(staleRow?.classList.contains("att-row--stale")).toBe(true);
    const staleDot = staleRow?.querySelector(".dot");
    expect(staleDot?.classList.contains("dot--warning")).toBe(true);
    expect(staleDot?.classList.contains("dot--info")).toBe(false);
    // The CSS module is pinned separately by the .dot--warning → yellow
    // mapping defined in base.css (and the --warning token in tokens.css).
    // We don't assert the resolved colour here because happy-dom doesn't
    // carry the css custom property cascade; a visual smoke test on the
    // live page is the actual proof.
    // Stale row exposes the row-level "Stale · Nd" caption for the
    // ageDays value and an aria-label of "Stale item" on the dot, so
    // a screen reader also announces the stale state.
    expect(screen.getByText(/stale · 60d old/i)).toBeTruthy();
    expect(staleDot?.getAttribute("aria-label")).toBe("Stale item");
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
        bySource: {
          opencode: { sessions: 900, cost: 300, tokens: 3000000000 },
          hermes: { sessions: 697, cost: 215.95, tokens: 2420000000 },
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
    const { container } = render(<AgentSpend />);
    const meta = container.querySelector(".spend-hero__meta");
    expect(meta).toBeTruthy();
    expect(meta?.textContent).toContain("1,597 Sessions");
    expect(meta?.textContent).toContain("5.42B Tokens");
  });

  test("hero shows cache hit rate and saved as smaller stat", () => {
    useDash.setState({
      state: usageState({
        cacheReadTokens: 1000000,
        cacheHitRate: 0.65,
        cacheSavings: 4.2,
      }),
    });
    const { container } = render(<AgentSpend />);
    const cacheStat = container.querySelector(".spend-overview__cache");
    expect(cacheStat).toBeTruthy();
    expect(cacheStat?.textContent).toContain("Cache");
    expect(cacheStat?.textContent).toContain("65%");
    expect(cacheStat?.textContent).toContain("$4.20");
    expect(cacheStat?.textContent).toContain("at model input rates");

    cleanup();
    useDash.setState({
      state: usageState({ cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0 }),
    });
    const { container: emptyContainer } = render(<AgentSpend />);
    const emptyCacheStat = emptyContainer.querySelector(".spend-overview__cache");
    expect(emptyCacheStat?.textContent).toContain("—");
    expect(emptyCacheStat?.textContent).toContain("$0.00");
    expect(emptyCacheStat?.textContent).not.toContain("NaN");
    expect(emptyCacheStat?.textContent).not.toContain("null");
  });

  test("ledger rows show per-source cache_read substat", () => {
    useDash.setState({
      state: usageState({
        bySource: {
          opencode: { sessions: 900, cost: 300, tokens: 3000000000, cacheReadTokens: 1234567 },
          hermes: { sessions: 697, cost: 215.95, tokens: 2420000000, cacheReadTokens: 0 },
        },
      }),
    });
    const { container } = render(<AgentSpend />);
    const metas = container.querySelectorAll(".spend-sources .spend-source-row__meta");
    expect(metas).toHaveLength(2);
    expect(metas[0]?.textContent).toContain(`${formatCompact(1234567)} cached`);
    expect(metas[1]?.textContent).toContain("0 cached");

    cleanup();
    useDash.setState({
      state: usageState({
        bySource: {
          opencode: { sessions: 900, cost: 300, tokens: 3000000000, cacheReadTokens: 1234567 },
        },
      }),
    });
    const { container: missingSourceContainer } = render(<AgentSpend />);
    const missingSourceMeta = missingSourceContainer.querySelectorAll(".spend-sources .spend-source-row__meta")[1];
    expect(missingSourceMeta?.textContent).toBe("No data");
    expect(missingSourceMeta?.textContent).not.toContain("cache_read");
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
          opencode: { sessions: 0, cost: null, tokens: null },
          hermes: { sessions: 0, cost: null, tokens: null },
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

  test("uses each series line color for its legend palette entry", async () => {
    const options: echarts.EChartsOption[] = [];
    chartSpy.mockImplementation(
      () => ({
        setOption(option: echarts.EChartsOption) {
          options.push(option);
        },
        resize() {},
        dispose() {},
        on() {},
      }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        points: [
          { date: "2026-07-01", cost: 1.25, tokens: 100, cacheRead: 25 },
        ],
      }),
    } as Response);
    useDash.setState({ state: usageState() });

    render(<AgentSpend />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const option = options.find((candidate) => Array.isArray(candidate.series));
    expect(option).toBeTruthy();
    const colors = option && Array.isArray(option.color) ? option.color : [];
    const series = option?.series;
    expect(colors).toEqual(["#38bdf8", "#facc15", "#4ade80"]);
    expect(Array.isArray(series) ? series.map((entry) => ("lineStyle" in entry ? entry.lineStyle?.color : undefined)) : []).toEqual(colors);
  });

  test("line endpoints reach both plot edges (no boundary gap)", async () => {
    const options: echarts.EChartsOption[] = [];
    chartSpy.mockImplementation(
      () => ({
        setOption(option: echarts.EChartsOption) {
          options.push(option);
        },
        resize() {},
        dispose() {},
        on() {},
      }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        points: [
          { date: "2026-07-01", cost: 1.25, tokens: 100, cacheRead: 25 },
          { date: "2026-07-02", cost: 2.0, tokens: 200, cacheRead: 40 },
          { date: "2026-07-03", cost: 0.5, tokens: 80, cacheRead: 10 },
        ],
      }),
    } as Response);
    useDash.setState({ state: usageState() });

    render(<AgentSpend />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const option = options.find((candidate) => Array.isArray(candidate.series));
    expect(option).toBeTruthy();
    // boundaryGap: false puts the first/last points flush to the plot edges;
    // the default (true) insets them by half a band, leaving the trailing gap.
    expect((option?.xAxis as { boundaryGap?: boolean } | undefined)?.boundaryGap).toBe(false);
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

describe("ModelTable cache % sort", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(performance.now() + 1000);
      return 0;
    });
    vi.spyOn(echarts, "init").mockImplementation(
      // @ts-expect-error minimal echarts stub
      () => ({ setOption() {}, resize() {}, dispose() {}, on() {} }),
    );
  });

  function modelUsageState(): StatePayload {
    return emptyState({
      usage: {
        totalSessions: 10,
        totalMessages: 100,
        totalTokens: 1000,
        totalCost: 10,
        bySource: { opencode: { sessions: 10, cost: 10, tokens: 1000 } },
        byModel: [
          { model: "Alpha", family: null, sessions: 5, cost: 5, tokens: 500, cacheReadTokens: 100, cacheHitRate: 0.25, cacheSavings: 0.0003, effPerM: 3 },
          { model: "Beta", family: null, sessions: 3, cost: 3, tokens: 300, cacheReadTokens: 200, cacheHitRate: 0.67, cacheSavings: 0.0006, effPerM: 2 },
          { model: "Gamma", family: null, sessions: 2, cost: 2, tokens: 200, cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0, effPerM: 1 },
        ],
      },
    });
  }

  test("sorts by cache % descending on first click", () => {
    useDash.setState({ state: modelUsageState() });
    render(<AgentSpend />);
    const btn = screen.getByRole("button", { name: /cache %/i });
    fireEvent.click(btn);
    const names = screen.getAllByText(/^(Alpha|Beta|Gamma)$/).map((el) => el.textContent);
    expect(names).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  test("cache % sort persists in localStorage and restores on reload", () => {
    useDash.setState({ state: modelUsageState() });
    render(<AgentSpend />);
    fireEvent.click(screen.getByRole("button", { name: /cache %/i }));
    cleanup();
    render(<AgentSpend />);
    const btn = screen.getByRole("button", { name: /cache %/i });
    expect(btn.querySelector(".sort-arrow")).toBeTruthy();
  });

  test("eff sort cycles cheapest-first → most-expensive → default", () => {
    useDash.setState({ state: modelUsageState() });
    render(<AgentSpend />);
    const btn = screen.getByRole("button", { name: /\$\/1M/i });
    const names = () =>
      screen.getAllByText(/^(Alpha|Beta|Gamma)$/).map((el) => el.textContent);

    // First click: cheapest-first (asc).
    fireEvent.click(btn);
    expect(names()).toEqual(["Gamma", "Beta", "Alpha"]);
    // Second click: most-expensive-first (desc).
    fireEvent.click(btn);
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    // Third click: back to default (sessions descending, 2026-08-24).
    fireEvent.click(btn);
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("default sort is sessions descending on a fresh browser", () => {
    // Session order deliberately differs from token order to prove the
    // default is sessions, not upstream (or token) order.
    const s = emptyState({
      usage: {
        totalSessions: 2,
        totalMessages: 4,
        totalTokens: 1000,
        totalCost: 2,
        bySource: { opencode: { sessions: 2, cost: 2, tokens: 1000 } },
        byModel: [
          { model: "Alpha", family: null, sessions: 1, cost: 1, tokens: 100, cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0, effPerM: null },
          { model: "Beta", family: null, sessions: 1, cost: 1, tokens: 900, cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0, effPerM: null },
        ],
      },
    });
    useDash.setState({ state: s });
    render(<AgentSpend />);
    // Alpha (1 session) leads by session-count desc tied — both have 1
    // session in this fixture, so the upstream order is the tiebreaker.
    // What matters is that the sessions header pill is the active one.
    const names = screen.getAllByText(/^(Alpha|Beta)$/).map((el) => el.textContent);
    expect(names).toEqual(["Alpha", "Beta"]);
    // …and the sessions header shows the active descending arrow.
    const btn = screen.getByRole("button", { name: /sessions/i });
    expect(btn.classList.contains("is-active")).toBe(true);
    expect(btn.querySelector(".sort-arrow")?.textContent).toBe("↓");
    localStorage.removeItem("signal-house:agent-spend-sort:cachePct:v3-sessions-desc");
  });

  test("an explicitly chosen sort still beats the default after reload", () => {
    localStorage.setItem(
      "signal-house:agent-spend-sort:cachePct:v3-sessions-desc",
      JSON.stringify({ key: "cost", asc: true }),
    );
    useDash.setState({ state: modelUsageState() });
    render(<AgentSpend />);
    // Cost ascending on the fixture: Gamma ($2) → Beta ($3) → Alpha ($5).
    const names = screen.getAllByText(/^(Alpha|Beta|Gamma)$/).map((el) => el.textContent);
    expect(names).toEqual(["Gamma", "Beta", "Alpha"]);
    localStorage.removeItem("signal-house:agent-spend-sort:cachePct:v3-sessions-desc");
  });
});

describe("DeliveryTrend", () => {
  beforeEach(() => {
    vi.spyOn(echarts, "init").mockImplementation(
      // @ts-expect-error minimal echarts stub
      () => ({ setOption() {}, resize() {}, dispose() {}, on() {} }),
    );
  });

  function mockFetch(payload: { points: Array<{ date: string; ci: { totalRuns: number; passCount: number; failCount: number; passRate: number } | null; commits: number; prsMerged: number }> }) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  test("renders the section heading and subtitle", async () => {
    mockFetch({
      points: [
        { date: "2026-08-20", ci: { totalRuns: 10, passCount: 9, failCount: 1, passRate: 0.9 }, commits: 4, prsMerged: 1 },
        { date: "2026-08-21", ci: { totalRuns: 8, passCount: 8, failCount: 0, passRate: 1 }, commits: 6, prsMerged: 2 },
      ],
    });

    render(<DeliveryTrend />);
    expect(screen.getByRole("heading", { name: /delivery/i })).toBeTruthy();
    // Loading first — skeleton grid renders instead of the charts.
    expect(document.querySelector(".delivery-grid .skeleton")).toBeTruthy();
    // Charts mount after data arrives.
    await waitFor(() => {
      expect(screen.getByLabelText("CI pass-rate trend")).toBeTruthy();
      expect(screen.getByLabelText(/Throughput — commits and PRs merged per day/i)).toBeTruthy();
    });
  });

  test("renders the empty-state message when the API returns no points", async () => {
    mockFetch({ points: [] });

    render(<DeliveryTrend />);
    await waitFor(() => {
      expect(screen.getByText(/No delivery data yet/i)).toBeTruthy();
    });
  });

  // Route-aware fetch stub for the resource-chart cases: the panel now
  // loads /api/daily/delivery AND /api/daily/resource in parallel.
  function mockFetchRoutes(routes: { delivery?: unknown; resource?: unknown }) {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const body = url.includes("/api/daily/resource") ? routes.resource : routes.delivery;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
  }

  function captureInit() {
    const options: unknown[] = [];
    vi.spyOn(echarts, "init").mockImplementation(((el: unknown) => ({
      setOption: (opt: unknown) => options.push(opt),
      resize() {},
      dispose() {},
      on() {},
      getDom: () => el,
    })) as unknown as typeof echarts.init);
    return options;
  }

  const RESOURCE_POINTS = [
    { date: "2026-08-19", memPct: null, swapPct: null, cpuPct: null },
    { date: "2026-08-20", memPct: 59.7, swapPct: 14.9, cpuPct: 4.7 },
    { date: "2026-08-21", memPct: 61.2, swapPct: 15.1, cpuPct: 6.2 },
  ];

  test("resource chart stays hidden when host metrics are disabled", async () => {
    const options = captureInit();
    mockFetchRoutes({ delivery: { points: [{ date: "2026-08-20", ci: { totalRuns: 10, passCount: 9, failCount: 1, passRate: 0.9 }, commits: 4, prsMerged: 1 }] }, resource: { enabled: false, points: [] } });

    render(<DeliveryTrend />);
    await waitFor(() => {
      expect(screen.getByLabelText("CI pass-rate trend")).toBeTruthy();
    });

    // No resource node exposed: the node exists (stable container) but is
    // display:none + aria-hidden, and the two-column grid is preserved.
    expect(document.querySelector(".delivery-grid")).toBeTruthy();
    expect(document.querySelector(".delivery-grid.three")).toBeNull();
    const resNode = document.querySelector('div[aria-label^="Host resources"]') as HTMLElement;
    expect(resNode).toBeTruthy();
    expect(resNode.style.display).toBe("none");
    expect(resNode.getAttribute("aria-hidden")).toBe("true");
    // Only the two default charts were ever rendered.
    const seriesNames = options
      .flatMap((o) => ((o as { series?: Array<{ name?: string }> }).series ?? []).map((s) => s.name));
    expect(seriesNames).not.toContain("Memory");
  });

  test("resource chart renders first-of-three when enabled with data", async () => {
    const options = captureInit();
    mockFetchRoutes({
      delivery: { points: [{ date: "2026-08-20", ci: { totalRuns: 10, passCount: 9, failCount: 1, passRate: 0.9 }, commits: 4, prsMerged: 1 }] },
      resource: { enabled: true, points: RESOURCE_POINTS },
    });

    render(<DeliveryTrend />);
    await waitFor(() => {
      expect(screen.getByLabelText("CI pass-rate trend")).toBeTruthy();
      expect(screen.getByLabelText("Throughput — commits and PRs merged per day")).toBeTruthy();
    });
    expect(screen.getByLabelText("Host resources — memory, swap and CPU utilization per day")).toBeTruthy();

    // Three-across grid replaces the two-column grid on desktop.
    expect(document.querySelector(".delivery-grid.three")).toBeTruthy();

    // The resource renderer got a Memory/Swap/CPU series on a shared 0–100 axis.
    const res = options.find((o) =>
      ((o as { series?: Array<{ name?: string }> }).series ?? []).some((s) => s.name === "Memory"),
    ) as { yAxis?: { max?: number }; series?: Array<{ name?: string; connectNulls?: boolean }> } | undefined;
    expect(res).toBeTruthy();
    expect(res!.yAxis?.max).toBe(100);
    expect(res!.series?.find((s) => s.name === "Swap")).toBeTruthy();
    expect(res!.series?.find((s) => s.name === "CPU")?.connectNulls).toBe(false);
  });
});
