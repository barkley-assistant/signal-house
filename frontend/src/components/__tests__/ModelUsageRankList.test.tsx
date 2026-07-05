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
        tokensReasoning: 0,
        cacheReadTokens: 50,
        cacheWriteTokens: 20,
        cost: 0.8,
      },
      {
        modelName: "opencode-go/deepseek-v4-flash",
        messages: 6,
        inputTokens: 200,
        outputTokens: 30,
        tokensReasoning: null,
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

  it("renders the StatsBar 'Tokens' total as the sum of the model breakdown, not the stored totalTokens column", () => {
    // Deliberately make the stored totalTokens field disagree with the sum
    // of the modelUsage entries. The StatsBar should display the breakdown
    // sum (800+900+0+50+20) + (200+30+0+0+0) = 1770 + 230 = 2000.
    const stale: TokenUsageRow = {
      ...tokenUsage,
      // Sum of breakdown is 2000, so make the stored value 9999 to
      // prove the StatsBar ignores the column.
      totalTokens: 9999,
    };
    const html = renderToStaticMarkup(<ModelUsageRankList tokenUsage={stale} />);

    // The breakdown sum is 2,000. The stale column value (9,999) must not
    // appear, and 2,000 must be present at least once (StatsBar + per-row Total).
    expect(html).not.toContain("9,999");
    expect(html).toContain("2,000");
  });
});
