import { describe, expect, test } from "bun:test";
import { modelShareSeries } from "../../../src/web/components/charts/model-share-series";

describe("modelShareSeries", () => {
  test("transposes days into one line per model with family shades and the Others colour", () => {
    const points = [
      {
        date: "2026-09-01",
        models: [
          { key: "deepseek-v4-pro", label: "DeepSeek V4 Pro", family: "DeepSeek", tokens: 1_000_000 },
          { key: "deepseek-v4-flash", label: "DeepSeek V4 Flash", family: "DeepSeek", tokens: 400_000 },
          { key: "gpt-6-sol", label: "GPT 6 Sol", family: "OpenAI", tokens: 300_000 },
          { key: "__others__", label: "Others", family: null, tokens: 150_000 },
        ],
      },
      {
        date: "2026-09-02",
        models: [
          { key: "deepseek-v4-pro", label: "DeepSeek V4 Pro", family: "DeepSeek", tokens: 2_000_000 },
          { key: "deepseek-v4-flash", label: "DeepSeek V4 Flash", family: "DeepSeek", tokens: 0 },
          { key: "gpt-6-sol", label: "GPT 6 Sol", family: "OpenAI", tokens: 1_500_000 },
          { key: "__others__", label: "Others", family: null, tokens: 0 },
        ],
      },
    ];
    const built = modelShareSeries(points)!;
    expect(built.names).toEqual(["DeepSeek V4 Pro", "DeepSeek V4 Flash", "GPT 6 Sol", "Others"]);
    // Same-family models get consecutive shades; palette order == series order
    // so the top-level ECharts `color` array keeps legend swatches in sync.
    expect(built.palette[0]).toBe("#38bdf8"); // DeepSeek shade 0
    expect(built.palette[1]).toBe("#0ea5e9"); // DeepSeek shade 1
    expect(built.palette[2]).toBe("#e2e8f0"); // OpenAI shade 0
    expect(built.palette[3]).toBe("#71717a"); // Others neutral
    expect(built.series).toHaveLength(4);
    expect(built.series[0]).toMatchObject({ name: "DeepSeek V4 Pro", type: "line" });
    expect(built.series[0].data).toEqual([1_000_000, 2_000_000]);
    expect(built.series[3].data).toEqual([150_000, 0]);
    expect(built.series[0].lineStyle?.color).toBe("#38bdf8");
  });

  test("returns null for an empty window", () => {
    expect(modelShareSeries([])).toBeNull();
  });
});