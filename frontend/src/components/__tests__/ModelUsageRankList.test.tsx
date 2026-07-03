import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelUsageRankList } from "../ModelUsageRankList";
import type { TokenUsageRow } from "@/types";

describe("ModelUsageRankList", () => {
  const tokenUsage: TokenUsageRow = {
    periodStart: "2026-05-25T00:00:00.000Z",
    periodEnd: "2026-06-22T00:00:00.000Z",
    source: "opencodedb",
    toolName: "opencode",
    totalSessions: 4,
    totalMessages: 16,
    totalTokens: 2000,
    totalCost: 1.25,
    modelUsage: [
      {
        modelName: "opencode-go/minimax-m3",
        messages: 10,
        inputTokens: 800,
        outputTokens: 900,
        cacheReadTokens: 50,
        cacheWriteTokens: 20,
        cost: 0.8,
      },
      {
        modelName: "opencode-go/deepseek-v4-flash",
        messages: 6,
        inputTokens: 200,
        outputTokens: 30,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: 0.45,
      },
    ],
    rawJson: null,
    collectedAt: "2026-06-22T00:00:00.000Z",
  };

  it("renders tokenUsage stats", () => {
    const html = renderToStaticMarkup(<ModelUsageRankList tokenUsage={tokenUsage} />);

    expect(html).toContain("Sessions");
    expect(html).toContain("4");
    expect(html).toContain("16");
    expect(html).toContain("2,000");
    expect(html).toContain("$1.25");
    expect(html).toContain("opencode-go/minimax-m3");
  });
});
