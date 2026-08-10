/**
 * costInputForModel — the per-1M-token USD input rate used by the cache
 * savings card. The model-map.json is the source of truth; the helper walks
 * the curated map by normalised machine key.
 */

import { describe, expect, test } from "bun:test";
import { costInputForModel, machineKey } from "../../src/shared/models";

describe("costInputForModel", () => {
  test("returns the rate for a known model with a positive costInput", () => {
    expect(costInputForModel("Claude-Opus-4.5")).toBe(15.0);
    expect(costInputForModel("claude-opus-45")).toBe(15.0);
    expect(costInputForModel("CLAUDE OPUS 4.5")).toBe(15.0);
    expect(costInputForModel("DeepSeek-V4-Pro")).toBe(2.0);
    expect(costInputForModel("MiniMax-M3")).toBe(1.0);
  });

  test("returns null for an unknown model (no map entry)", () => {
    expect(costInputForModel("some-random-model-v9")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(costInputForModel("")).toBeNull();
  });

  test("returns null for 'unknown' (it's in the map but has no costInput)", () => {
    expect(costInputForModel("unknown")).toBeNull();
    expect(costInputForModel("Unknown")).toBeNull();
  });

  test("normalises via machineKey so casing/separator variants resolve to the same rate", () => {
    // machineKey collapses variants to a stable key, so the rate lookup is
    // consistent regardless of how the upstream tool spells the model.
    // The dot form is canonical ("claude-opus-4.5" → "claude-opus-45");
    // under_scores vs spaces don't collapse to the same key — they're
    // different spellings and intentionally don't match the curated entry.
    expect(machineKey("Claude-Opus-4.5")).toBe("claude-opus-45");
    expect(costInputForModel("Claude-Opus-4.5")).toBe(costInputForModel("claude-opus-4.5"));
    expect(costInputForModel("CLAUDE-OPUS-4.5")).toBe(costInputForModel("claude-opus-4.5"));
    expect(costInputForModel("DeepSeek-V4-Pro")).toBe(costInputForModel("deepseek-v4-pro"));
  });
});