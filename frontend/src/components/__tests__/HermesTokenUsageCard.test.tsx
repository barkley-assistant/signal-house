import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSparklineOption, HermesTokenUsageCard } from "../HermesTokenUsageCard";
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

describe("buildSparklineOption — gap-day series mapping", () => {
  it("renders 0 (not null) for input/output tokens on gap days", () => {
    const makeFilled = (date: string, row: DailyTokenUsageRow | null) => ({
      date, row, isGap: row === null,
    });

    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-06", {
        totalSessions: 1,
        modelUsage: [{
          modelName: "claude-sonnet-4",
          messages: 10,
          inputTokens: 1000,
          outputTokens: 500,
          tokensReasoning: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          cost: 0.5,
        }],
      }),
      // 2026-07-07 is a gap
      makeRow("2026-07-08", {
        totalSessions: 2,
        modelUsage: [{
          modelName: "gpt-4o",
          messages: 5,
          inputTokens: 2000,
          outputTokens: 1000,
          tokensReasoning: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          cost: 0.2,
        }],
      }),
    ];

    const filled = [
      makeFilled("2026-07-06", rows[0]),
      makeFilled("2026-07-07", null), // gap
      makeFilled("2026-07-08", rows[1]),
    ];

    const option = buildSparklineOption(filled);
    const series = option.series as Array<{ data: (number | null)[] }>;

    // Gap day at index 1 must be 0, not null
    expect(series[0].data[1]).toBe(0);
    expect(series[1].data[1]).toBe(0);

    // Non-gap days keep real values
    expect(series[0].data[0]).toBe(1000);
    expect(series[0].data[2]).toBe(2000);
    expect(series[1].data[0]).toBe(500);
    expect(series[1].data[2]).toBe(1000);
  });
});
