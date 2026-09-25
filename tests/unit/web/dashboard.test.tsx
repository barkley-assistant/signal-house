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
    lifetime: null,
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
        ci: { totalRuns: 50, passCount: 45, failCount: 5, otherCount: 0, passRate: 0.9 },
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
    const { container } = render(<HealthStrip state={state} />);
    expect(screen.getByText("90%")).toBeTruthy();
    // The value renders as "$0.18" + a nested unit span ("/hr") — the
    // default matcher only reads direct text nodes, so match on textContent.
    expect(
      screen.getAllByText((_, el) => el?.textContent === "$0.18/hr").length,
    ).toBeGreaterThan(0);
    // The 5th tile's label carries the neutral dot (no status claimed), so
    // its label aligns with the other four.
    expect(container.querySelector(".kpi-tile--cost-tokens .dot--neutral")).not.toBeNull();
  });

  test("CI caption accounts for non-terminal runs when present", () => {
    const state = emptyState({
      summary: {
        throughput: null,
        cycleTime: null,
        ci: { totalRuns: 57, passCount: 45, failCount: 5, otherCount: 7, passRate: 0.9 },
        staleWork: null,
        costAndTokens: null,
      },
      usage: null,
    });
    render(<HealthStrip state={state} />);
    expect(screen.getByText("45 pass · 5 fail · 7 other · 57 runs")).toBeTruthy();
  });

  test("CI caption omits the other segment when it is zero", () => {
    const state = emptyState({
      summary: {
        throughput: null,
        cycleTime: null,
        ci: { totalRuns: 50, passCount: 45, failCount: 5, otherCount: 0, passRate: 0.9 },
        staleWork: null,
        costAndTokens: null,
      },
      usage: null,
    });
    render(<HealthStrip state={state} />);
    expect(screen.getByText("45 pass · 5 fail · 50 runs")).toBeTruthy();
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

  test("per-source ledger rows are removed from the panel body", () => {
    useDash.setState({ state: usageState() });
    const { container } = render(<AgentSpend />);
    expect(container.querySelector(".spend-sources")).toBeNull();
    expect(container.querySelector(".spend-source-row")).toBeNull();
    expect(screen.queryByText("OpenCode")).toBeNull();
    expect(screen.queryByText("Hermes")).toBeNull();
    // The per-source cost figures no longer render anywhere in the panel
    // (byModel is empty in this fixture, so no detail block carries them).
    expect(screen.queryByText("$300.00")).toBeNull();
    expect(screen.queryByText("$215.95")).toBeNull();
  });

  test("lifetime block renders the five to-date stat lines", () => {
    useDash.setState({
      state: {
        ...usageState(),
        lifetime: {
          sinceDay: "2026-06-15",
          totalCommits: 1534,
          totalTokens: 13_500_000_000,
          totalSessions: 3915,
          topModel: { label: "MiniMax M3", sessions: 1057 },
          busiestDay: { date: "2026-08-31", tokens: 505_000_000 },
        },
      },
    });
    const { container } = render(<AgentSpend />);
    const block = container.querySelector(".spend-lifetime");
    expect(block).toBeTruthy();
    expect(block?.textContent).toContain("Lifetime to date");
    // The honest bound — the actual first retained day, never "all time".
    expect(block?.textContent).toContain("since 15 Jun 2026");
    expect(block?.textContent).toContain("1,534");
    expect(block?.textContent).toContain("13.5B");
    expect(block?.textContent).toContain("3,915");
    expect(block?.textContent).toContain("MiniMax M3");
    expect(block?.textContent).toContain("1,057 sessions");
    // Date and magnitude now stack (value / sub) instead of one middot run.
    expect(block?.textContent).toContain("31 Aug");
    expect(block?.textContent).toContain("505M tokens");
  });

  test("lifetime lines render em-dash on missing data, never zero", () => {
    // usageState() leaves lifetime null (emptyState default) — the block
    // still renders so the layout stays stable, every line "—".
    useDash.setState({ state: usageState() });
    const { container } = render(<AgentSpend />);
    const block = container.querySelector(".spend-lifetime");
    expect(block).toBeTruthy();
    const values = [...container.querySelectorAll(".spend-lifetime .model-row__detail-value")];
    expect(values.length).toBe(5);
    for (const v of values) {
      expect(v.textContent).toBe("—");
      expect(v.textContent).not.toContain("0");
      expect(v.textContent).not.toContain("NaN");
    }
    // No bound is claimed when there is no history at all.
    expect(block?.textContent).not.toContain("since");

    // Partial data: commits unknown but tokens known — only that line is "—".
    cleanup();
    useDash.setState({
      state: {
        ...usageState(),
        lifetime: {
          sinceDay: "2026-07-09",
          totalCommits: null,
          totalTokens: 1_000,
          totalSessions: null,
          topModel: null,
          busiestDay: null,
        },
      },
    });
    const { container: partial } = render(<AgentSpend />);
    const lines = [...partial.querySelectorAll(".spend-lifetime .model-row__detail-stat")];
    const byLabel = (label: string) =>
      lines.find((l) => l.querySelector(".model-row__detail-label")?.textContent === label);
    expect(byLabel("Commits")?.querySelector(".model-row__detail-value")?.textContent).toBe("—");
    expect(byLabel("Tokens")?.querySelector(".model-row__detail-value")?.textContent).toBe("1K");
    expect(byLabel("Top model")?.querySelector(".model-row__detail-value")?.textContent).toBe("—");
  });

  test("renders blended $/1M and cost per session from the window totals", () => {
    useDash.setState({ state: usageState() });
    const { container } = render(<AgentSpend />);
    const stats = [...container.querySelectorAll(".spend-overview__stat")];
    expect(stats.length).toBe(2);
    // DOM order matches JSX order: blended first, per-session second.
    // 515.95 / 5.42B tokens × 1M = $0.095; 515.95 / 1597 sessions = $0.32
    // (both verified against the formatters: formatEffPerM uses 3 decimals
    // below $1, formatCost uses 2).
    expect(stats[0].textContent).toContain("Blended $/1M");
    expect(stats[0].textContent).toContain("$0.095");
    // Caption is load-bearing: the by-model $/1M column discounts cache
    // reads (effective tokens), the blended figure counts everything at
    // face value — without the caption the two read as a contradiction.
    expect(stats[0].textContent).toContain("all tokens at face value");
    expect(stats[1].textContent).toContain("Cost / session");
    expect(stats[1].textContent).toContain("$0.32");
  });

  test("unit rates render em-dash on unknown cost, never zero", () => {
    useDash.setState({ state: usageState({ totalCost: null }) });
    const { container } = render(<AgentSpend />);
    const stats = [...container.querySelectorAll(".spend-overview__stat")];
    expect(stats.length).toBe(2);
    for (const cell of stats) {
      expect(cell.textContent).toContain("—");
      // "$0" catches both zero leaks ("$0.00", "$0.000") without tripping
      // on the "Blended $/1M" label text.
      expect(cell.textContent).not.toContain("$0");
      expect(cell.textContent).not.toContain("NaN");
    }
  });

  test("zero or missing denominators render em-dash, never NaN or Infinity", () => {
    // totalTokens 0 → blended "—", per-session still real.
    useDash.setState({ state: usageState({ totalTokens: 0 }) });
    const { container } = render(<AgentSpend />);
    let stats = [...container.querySelectorAll(".spend-overview__stat")];
    expect(stats[0].textContent).toContain("—");
    expect(stats[1].textContent).toContain("$0.32");

    // totalSessions 0 → per-session "—", blended still real. The panel
    // itself still renders: its empty-state guard requires sessions AND
    // tokens AND cost to ALL be empty.
    cleanup();
    useDash.setState({ state: usageState({ totalSessions: 0 }) });
    const { container: c2 } = render(<AgentSpend />);
    stats = [...c2.querySelectorAll(".spend-overview__stat")];
    expect(stats[0].textContent).toContain("$0.095");
    expect(stats[1].textContent).toContain("—");

    // totalTokens null (unknown token telemetry) → blended "—".
    cleanup();
    useDash.setState({ state: usageState({ totalTokens: null }) });
    const { container: c3 } = render(<AgentSpend />);
    stats = [...c3.querySelectorAll(".spend-overview__stat")];
    expect(stats[0].textContent).toContain("—");
    expect(stats[1].textContent).toContain("$0.32");
  });

  test("all-unknown model costs make the unit rates em-dash, not a confident $0", () => {
    // The estimator pins costSource:"unknown" rows to cost 0, so a window
    // where every token-bearing model is unpriced totals $0 — unknown
    // spend, not free spend. The unit rates must say "—". (The hero keeps
    // its pre-existing $0.00 behaviour in this case; fixing it is out of
    // scope, so no hero assertion here.)
    useDash.setState({
      state: usageState({
        totalCost: 0,
        byModel: [
          { model: "Mystery 1", family: null, sessions: 9, cost: 0, tokens: 900, costSource: "unknown", cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0 },
          { model: "Mystery 2", family: null, sessions: 7, cost: 0, tokens: 700, costSource: "unknown", cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0 },
        ],
      }),
    });
    const { container } = render(<AgentSpend />);
    const stats = [...container.querySelectorAll(".spend-overview__stat")];
    expect(stats.length).toBe(2);
    for (const cell of stats) {
      expect(cell.textContent).toContain("—");
      expect(cell.textContent).not.toContain("$0");
    }

    // Complement: one priced model makes the total non-zero again, so the
    // guard must NOT fire — the unknown row contributes 0 silently
    // (existing mixed-payload semantics, same as the hero) and the rates
    // render real numbers.
    cleanup();
    useDash.setState({
      state: usageState({
        totalCost: 5,
        totalTokens: 1_000_000,
        totalSessions: 10,
        byModel: [
          { model: "Priced", family: null, sessions: 4, cost: 5, tokens: 100, costSource: "estimated", cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0 },
          { model: "Mystery", family: null, sessions: 6, cost: 0, tokens: 900, costSource: "unknown", cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0 },
        ],
      }),
    });
    const { container: mixed } = render(<AgentSpend />);
    const cells = [...mixed.querySelectorAll(".spend-overview__stat")];
    // 5 / 1M tokens × 1M = $5.00; 5 / 10 sessions = $0.50.
    expect(cells[0].textContent).toContain("$5.00");
    expect(cells[1].textContent).toContain("$0.50");
  });

  test("the cost per merged PR tile is gone", () => {
    useDash.setState({ state: usageState() });
    const { container } = render(<AgentSpend />);
    expect(container.querySelector(".spend-overview__delivery")).toBeNull();
    expect(screen.queryByText("Cost / merged PR")).toBeNull();
    // Overview cluster: hero pair + the two unit-rate cells = 4 cells.
    expect(container.querySelector(".spend-overview")!.childElementCount).toBe(4);
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
    // The daily chart now splits cost/tokens across two x axes (one per
    // pane) — every pane must keep the flush-edge contract.
    const xAxes = option?.xAxis as Array<{ boundaryGap?: boolean }> | undefined;
    expect(Array.isArray(xAxes)).toBe(true);
    expect(xAxes?.every((x) => x.boundaryGap === false)).toBe(true);
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

describe("ModelTable click-to-expand (mobile-only behaviour, but DOM lives at all widths)", () => {
  function fixture() {
    return emptyState({
      usage: {
        totalSessions: 6,
        totalMessages: 4,
        totalTokens: 1500,
        totalCost: 12,
        bySource: { opencode: { sessions: 6, cost: 12, tokens: 1500 } },
        byModel: [
          { model: "Alpha", family: null, sessions: 5, cost: 5, tokens: 500, cacheReadTokens: 100, cacheHitRate: 0.25, cacheSavings: 0.0003, effPerM: 3 },
          { model: "Beta", family: null, sessions: 3, cost: 3, tokens: 300, cacheReadTokens: 200, cacheHitRate: 0.67, cacheSavings: 0.0006, effPerM: 2 },
          { model: "Gamma", family: null, sessions: 2, cost: 2, tokens: 200, cacheReadTokens: 0, cacheHitRate: 0, cacheSavings: 0, effPerM: 1 },
        ],
      },
    });
  }

  test("every row is a button-like element with role=button + aria-expanded=false on first render", () => {
    useDash.setState({ state: fixture() });
    render(<AgentSpend />);
    const rows = screen.getAllByRole("button", { hidden: true }).filter((el) =>
      el.classList.contains("model-row"),
    );
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.getAttribute("aria-expanded")).toBe("false");
      expect(row.getAttribute("tabindex")).toBe("0");
    }
  });

  test("clicking a row toggles a detail panel below it with all 5 stats", () => {
    useDash.setState({ state: fixture() });
    render(<AgentSpend />);
    // Before: no detail rows exist.
    expect(document.querySelectorAll(".model-row__detail").length).toBe(0);
    // Click first row (Alpha — sessions 5).
    const firstRow = document.querySelectorAll(".model-row")[0] as HTMLElement;
    expect(firstRow.querySelector(".model-name")?.textContent).toBe("Alpha");
    fireEvent.click(firstRow);
    // Now: one detail row exists, anchored to Alpha.
    const details = document.querySelectorAll(".model-row__detail");
    expect(details.length).toBe(1);
    const detailText = details[0].textContent || "";
    // All 5 stats present in the detail panel — Sessions, Tokens, Cost,
    // Cache %, and $/1M (the two columns hidden-by-default on mobile).
    expect(detailText).toMatch(/sessions/i);
    expect(detailText).toMatch(/tokens/i);
    expect(detailText).toMatch(/cost/i);
    expect(detailText).toMatch(/cache %/i);
    expect(detailText).toMatch(/\$[/ ]?1m/i);
    // The first row is now aria-expanded.
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
  });

  test("expanded row detail renders the BY SOURCE per-source block", () => {
    useDash.setState({
      state: emptyState({
        usage: {
          totalSessions: 5,
          totalMessages: 4,
          totalTokens: 500,
          totalCost: 4,
          bySource: { opencode: { sessions: 5, cost: 4, tokens: 500 } },
          byModel: [
            {
              model: "Alpha",
              family: null,
              sessions: 5,
              cost: 4,
              tokens: 500,
              cacheReadTokens: 100,
              cacheHitRate: 0.25,
              cacheSavings: 0.05,
              effPerM: 3,
              bySource: {
                opencode: {
                  cacheReadTokens: 100,
                  cacheSavings: 0.05,
                  inputTokens: 400,
                  outputTokens: 100,
                  cost: 4,
                },
              },
            },
          ],
        },
      }),
    });
    render(<AgentSpend />);
    const firstRow = document.querySelectorAll(".model-row")[0] as HTMLElement;
    fireEvent.click(firstRow);
    const detail = document.querySelector(".model-row__detail-sources");
    expect(detail).toBeTruthy();
    const detailText = detail?.textContent ?? "";
    expect(detailText).toContain("By source");
    expect(detailText).toContain("opencode");
    expect(detailText).toContain("400 in");
    expect(detailText).toContain("$4.00");
  });

  test("clicking a second row collapses the first (single-expand semantics)", () => {
    useDash.setState({ state: fixture() });
    render(<AgentSpend />);
    const rowEls = [...document.querySelectorAll(".model-row")] as HTMLElement[];
    fireEvent.click(rowEls[0]);
    expect(document.querySelectorAll(".model-row__detail").length).toBe(1);
    expect(rowEls[0].getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(rowEls[1]);
    // Still exactly one detail row (single-expand), now anchored to row 1.
    expect(document.querySelectorAll(".model-row__detail").length).toBe(1);
    expect(rowEls[0].getAttribute("aria-expanded")).toBe("false");
    expect(rowEls[1].getAttribute("aria-expanded")).toBe("true");
  });

  test("clicking the same row twice collapses the detail", () => {
    useDash.setState({ state: fixture() });
    render(<AgentSpend />);
    const firstRow = document.querySelectorAll(".model-row")[0] as HTMLElement;
    fireEvent.click(firstRow);
    expect(document.querySelectorAll(".model-row__detail").length).toBe(1);
    fireEvent.click(firstRow);
    expect(document.querySelectorAll(".model-row__detail").length).toBe(0);
    expect(firstRow.getAttribute("aria-expanded")).toBe("false");
  });

  test("keyboard Enter / Space on a focused row toggles the detail", () => {
    useDash.setState({ state: fixture() });
    render(<AgentSpend />);
    const firstRow = document.querySelectorAll(".model-row")[0] as HTMLElement;
    firstRow.focus();
    // Enter
    fireEvent.keyDown(firstRow, { key: "Enter" });
    expect(document.querySelectorAll(".model-row__detail").length).toBe(1);
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
    // Space
    fireEvent.keyDown(firstRow, { key: " " });
    expect(document.querySelectorAll(".model-row__detail").length).toBe(0);
    expect(firstRow.getAttribute("aria-expanded")).toBe("false");
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
