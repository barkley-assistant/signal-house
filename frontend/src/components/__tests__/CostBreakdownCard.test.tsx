import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { CostBreakdownCard } from "../CostBreakdownCard";
import type { TokenUsageRow } from "@/types";

function makeTokenUsage(
  modelUsage: TokenUsageRow["modelUsage"],
): TokenUsageRow {
  return {
    periodStart: "2026-05-25T00:00:00.000Z",
    periodEnd: "2026-06-22T00:00:00.000Z",
    source: "opencodedb",
    toolName: "opencode",
    totalSessions: 4,
    totalMessages: 16,
    totalTokens: 2000,
    totalCost: 1.25,
    modelUsage,
    rawJson: null,
    collectedAt: "2026-06-22T00:00:00.000Z",
  };
}

describe("CostBreakdownCard", () => {
  it("renders sorted rows with summary metrics and proportional cost bars", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "small",
        messages: 10,
        inputTokens: 100,
        outputTokens: 50,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 1.0,
      },
      {
        modelName: "big",
        messages: 5,
        inputTokens: 1000,
        outputTokens: 500,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 9.0,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);

    expect(html).toContain("big");
    expect(html).toContain("small");

    const bigIndex = html.indexOf("big");
    const smallIndex = html.indexOf("small");
    expect(bigIndex).toBeGreaterThan(-1);
    expect(smallIndex).toBeGreaterThan(-1);
    expect(bigIndex).toBeLessThan(smallIndex);

    expect(html).toContain("$10.00");

    // Multipliers are shown for each model in a multi-model card.
    expect(html).toContain("1.0×");
    expect(html).toContain("18.0×");
  });

  it("renders the custom empty state when modelUsage is empty", () => {
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={null} />);
    expect(html).toContain("No cost data available");
    expect(html).toContain(
      "Cost data appears once model usage includes cost information"
    );
  });

  it("renders the custom empty state when all costs are null", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "free-model",
        messages: 10,
        inputTokens: 100,
        outputTokens: 50,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: null,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);
    expect(html).toContain("No cost data available");
  });

  it("renders multiplier and inefficient bar color for a wildly expensive model without a high-cost-low-usage badge", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "expensive",
        messages: 42,
        inputTokens: 8000,
        outputTokens: 4000,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 8.5,
      },
      {
        modelName: "cheap",
        messages: 1000,
        inputTokens: 1000,
        outputTokens: 500,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 1.0,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);

    // Badge is gone.
    expect(html).not.toContain("High cost, low usage");
    expect(html).not.toContain("Lower efficiency than average");

    // Multipliers are rendered: cheapest shows 1.0×, expensive shows its ratio (≈202.4×).
    expect(html).toContain("1.0×");
    expect(html).toContain("202.4×");

    // Expensive model sits well above 25× cheapest → "inefficient" → bg-status-error.
    expect(html).toContain("bg-status-error");
  });

  it("renders a single model with the normal tier and no multiplier", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "solo",
        messages: 100,
        inputTokens: 500,
        outputTokens: 250,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 3.0,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);
    expect(html).toContain("solo");
    expect(html).toContain("$3.00");

    // Single-model guard: no multiplier is rendered.
    expect(html).not.toContain("×</span>");
  });

  it("renders a zero-cost model with em-dash cost-per-message and no multiplier or warning badges", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "free",
        messages: 500,
        inputTokens: 100,
        outputTokens: 50,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 0,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);
    expect(html).toContain("free");
    expect(html).toContain("0.0¢/msg");
    expect(html).not.toContain("High cost, low usage");
    expect(html).not.toContain("Lower efficiency than average");
    // No multiplier when the only model has zero cost.
    expect(html).not.toContain("×</span>");
  });

  it("includes accessible aria-labels on the rows and bars", () => {
    const tokenUsage = makeTokenUsage([
      {
        modelName: "alpha",
        messages: 200,
        inputTokens: 100,
        outputTokens: 50,
        tokensReasoning: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 4.0,
      },
    ]);
    const html = renderToStaticMarkup(<CostBreakdownCard tokenUsage={tokenUsage} />);
    expect(html).toContain("alpha:");
    expect(html).toContain("per message");
    expect(html).toContain("of total cost");
  });
});
