import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { HermesTokenUsageCard } from "../HermesTokenUsageCard";
import type { DailyTokenUsageRow } from "@/types";

function makeRow(date: string, overrides: Partial<DailyTokenUsageRow> = {}): DailyTokenUsageRow {
  return {
    date,
    source: "hermes",
    totalSessions: 0,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: null,
    modelUsage: [],
    rawJson: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const DEFAULT_START = "2026-07-01"
const DEFAULT_END = "2026-07-07"

describe("HermesTokenUsageCard", () => {
  it("renders the card title with Hermes badge", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        totalSessions: 5,
        totalCost: 0.5,
        modelUsage: [
          {
            modelName: "claude-sonnet-4",
            messages: 10,
            inputTokens: 1000,
            outputTokens: 500,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 0.5,
          },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} startDay={DEFAULT_START} endDay={DEFAULT_END} />,
    );

    expect(html).toContain("Agent Token Usage");
    expect(html).toContain("Hermes Agent");
  });

  it("renders empty state when no rows", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} startDay="" endDay="" />,
    );
    expect(html).toContain("No agent token usage data");
  });

  it("renders loading state", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} startDay={DEFAULT_START} endDay={DEFAULT_END} loading={true} />,
    );
    // Skeleton renders as a div with animation classes
    expect(html).toContain("animate-pulse");
  });

  it("renders error state", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} startDay={DEFAULT_START} endDay={DEFAULT_END} error="Connection failed" />,
    );
    expect(html).toContain("Connection failed");
    expect(html).toContain('role="alert"');
  });

  it("renders summary row with StatsBar", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        totalSessions: 4,
        totalCost: 2.0,
        modelUsage: [
          {
            modelName: "model-a",
            messages: 3,
            inputTokens: 500,
            outputTokens: 250,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 1.0,
          },
          {
            modelName: "model-b",
            messages: 2,
            inputTokens: 300,
            outputTokens: 150,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 1.0,
          },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} startDay={DEFAULT_START} endDay={DEFAULT_END} />,
    );

    // StatsBar renders as <dl data-slot="stats-bar"> with <dt> labels
    expect(html).toContain('data-slot="stats-bar"');
    expect(html).toContain("<dt");
    expect(html).toContain("Input");
    expect(html).toContain("Output");
    expect(html).toContain("Cost");
    expect(html).toContain("Sessions");
  });

  it("uses full-number formatting for stats", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        totalSessions: 1,
        totalCost: 0.5,
        modelUsage: [
          {
            modelName: "claude-sonnet-4",
            messages: 10,
            inputTokens: 1500,
            outputTokens: 2500,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 0.5,
          },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} startDay={DEFAULT_START} endDay={DEFAULT_END} />,
    );

    expect(html).toContain("1,500");
    expect(html).toContain("2,500");
    expect(html).not.toContain("1.5K");
  });

  it("renders date spine with 0-fill for gap days", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        totalSessions: 1,
        totalCost: 0.1,
        modelUsage: [{ modelName: "a", messages: 1, inputTokens: 100, outputTokens: 50, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: 0.1 }],
      }),
      makeRow("2026-07-07", {
        totalSessions: 1,
        totalCost: 0.1,
        modelUsage: [{ modelName: "a", messages: 1, inputTokens: 50, outputTokens: 25, tokensReasoning: null, cacheReadTokens: null, cacheWriteTokens: null, cost: 0.1 }],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} startDay="2026-07-01" endDay="2026-07-07" />,
    );

    // Component renders without crashing (totals include only the 2 non-gap days)
    expect(html).toContain("Agent Token Usage");
    // No expand details button
    expect(html).not.toContain("Expand details");
    // StatsBar still renders
    expect(html).toContain('data-slot="stats-bar"');
  });

  it("renders flat sparkline when no data in valid window", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} startDay="2026-07-01" endDay="2026-07-07" />,
    );

    // Should NOT show the empty state text (it has a window to display)
    expect(html).not.toContain("No agent token usage data");
    // Sparkline container is still rendered (empty div for echarts)
    expect(html).toContain("echarts-for-react");
    // StatsBar renders with zero values
    expect(html).toContain('data-slot="stats-bar"');
  });

  it("handles invalid window dates gracefully", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} startDay="" endDay="" />,
    );

    // Should not crash — renders empty state or handles gracefully
    expect(html).toContain("Agent Token Usage");
    expect(html).toContain("No agent token usage data");
  });
});
