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
      <HermesTokenUsageCard rows={rows} />,
    );

    expect(html).toContain("Hermes Token Usage");
    expect(html).toContain("Hermes Agent");
    expect(html).toContain("claude-sonnet-4");
  });

  it("renders empty state when no rows", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} />,
    );
    expect(html).toContain("No Hermes token usage data");
  });

  it("renders loading state", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} loading={true} />,
    );
    // Skeleton renders as a div with animation classes
    expect(html).toContain("animate-pulse");
  });

  it("renders error state", () => {
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={[]} error="Connection failed" />,
    );
    expect(html).toContain("Connection failed");
    expect(html).toContain('role="alert"');
  });

  it("renders expand/collapse button text", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        totalSessions: 3,
        modelUsage: [
          {
            modelName: "model-a",
            messages: 5,
            inputTokens: 100,
            outputTokens: 50,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 0.1,
          },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} />,
    );
    // Should contain expand text in collapsed state
    expect(html).toContain("Expand");
  });

  it("renders summary row with token info", () => {
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
      <HermesTokenUsageCard rows={rows} />,
    );

    // Summary row shows totals across all modelUsages
    expect(html).toContain("Input:");
    expect(html).toContain("Output:");
    expect(html).toContain("Cost:");
    expect(html).toContain("Sessions:");
    expect(html).toContain("Top model:");
  });

  it("identifies the dominant model by message count", () => {
    const rows: DailyTokenUsageRow[] = [
      makeRow("2026-07-01", {
        modelUsage: [
          {
            modelName: "model-a",
            messages: 100,
            inputTokens: 10,
            outputTokens: 5,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 0.01,
          },
          {
            modelName: "model-b",
            messages: 20,
            inputTokens: 50,
            outputTokens: 25,
            tokensReasoning: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            cost: 0.05,
          },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      <HermesTokenUsageCard rows={rows} />,
    );

    // model-a has 100 messages across all entries → dominant
    expect(html).toContain("model-a");
  });
});
