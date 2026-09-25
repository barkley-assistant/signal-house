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
    // First model of each family keeps the family colour; a second
    // same-family model takes the next free high-contrast ring colour —
    // never another barely-different shade of the same hue. Palette order
    // == series order so the top-level ECharts `color` array keeps legend
    // swatches in sync.
    expect(built.palette[0]).toBe("#38bdf8"); // DeepSeek family colour
    expect(built.palette[1]).toBe("#f472b6"); // second DeepSeek → ring pink
    expect(built.palette[2]).toBe("#e2e8f0"); // OpenAI family colour
    expect(built.palette[3]).toBe("#71717a"); // Others neutral
    expect(built.series).toHaveLength(4);
    expect(built.series[0]).toMatchObject({ name: "DeepSeek V4 Pro", type: "line", stack: "tokens" });
    expect(built.series[0].data).toEqual([1_000_000, 2_000_000]);
    expect(built.series[3].data).toEqual([150_000, 0]);
    // Band edge strokes are lightened copies of the fill for crisp seams.
    expect(built.series[0].lineStyle?.color).toBe("#92dbfb");
    expect(built.series[0].areaStyle).toEqual({ color: "#38bdf8", opacity: 0.8 });
  });

  test("returns null for an empty window", () => {
    expect(modelShareSeries([])).toBeNull();
  });
});