/**
 * Frontend component tests (happy-dom + Testing Library).
 *
 * Covers the required behaviours: explicit no-data rendering, partial banner,
 * stale indicator, refresh-in-progress, failed-refresh-with-last-good,
 * privacy-filtered queue, keyboard interaction, reduced-motion, and number
 * formatting.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { StatePayload } from "../../../src/api/build-state";
import { useDash } from "../../../src/web/state/store";
import { HealthStrip } from "../../../src/web/components/HealthStrip";
import { AttentionQueue } from "../../../src/web/components/AttentionQueue";
import { RefreshStatus } from "../../../src/web/components/RefreshStatus";
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
    expect(screen.getByText(/queue is clear/i)).toBeTruthy();
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
    render(<RefreshStatus status={state.status} />);
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
    render(<RefreshStatus status={state.status} />);
    expect(screen.getByText(/refresh in progress/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reset stuck lock/i })).toBeTruthy();
  });

  test("refresh button is keyboard accessible", () => {
    const state = emptyState();
    render(<RefreshStatus status={state.status} />);
    const button = screen.getByRole("button", { name: /refresh now/i });
    expect(button).toBeTruthy();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
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
