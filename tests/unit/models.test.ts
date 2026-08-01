import { describe, test, expect } from "bun:test";
import { modelGroupKey, modelFamily, cleanModelName } from "../../src/shared/models";

describe("modelGroupKey", () => {
  test("collapses case + separator variants to one key", () => {
    const keys = ["DeepSeek-V4-Pro", "deepseek-v4-pro", "deepseek_v4_pro", "DeepSeek V4 Pro"].map(modelGroupKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("deepseekv4pro");
  });

  test("strips vendor prefixes but keeps bare names intact", () => {
    expect(modelGroupKey("openrouter/deepseek/deepseek-v4-pro")).toBe("deepseekv4pro");
    expect(modelGroupKey("deepseek/deepseek-v4-pro")).toBe("deepseekv4pro");
    expect(modelGroupKey("glm-5.2")).toBe("glm52");
  });
});

describe("modelFamily", () => {
  test("maps known families case-insensitively", () => {
    expect(modelFamily("DeepSeek-V4-Pro")).toBe("DeepSeek");
    expect(modelFamily("deepseek-v4-flash")).toBe("DeepSeek");
    expect(modelFamily("GLM-5.2")).toBe("z.ai");
    expect(modelFamily("glm-5.2")).toBe("z.ai");
    expect(modelFamily("Kimi K3")).toBe("Moonshot");
    expect(modelFamily("kimi-k3")).toBe("Moonshot");
    expect(modelFamily("MiniMax M3")).toBe("MiniMax");
    expect(modelFamily("minimax-m3")).toBe("MiniMax");
    expect(modelFamily("Qwen3.7-Plus")).toBe("Qwen");
    expect(modelFamily("GPT-5")).toBe("OpenAI");
    expect(modelFamily("o3-mini")).toBe("OpenAI");
    expect(modelFamily("claude-sonnet-4")).toBe("Anthropic");
    expect(modelFamily("gemini-2.5-pro")).toBe("Google");
    expect(modelFamily("Auto")).toBe("Auto");
  });

  test("returns null for unknown models", () => {
    expect(modelFamily("mimo-v2.5")).toBeNull();
    expect(modelFamily("Hy3")).toBeNull();
    expect(modelFamily("unknown")).toBeNull();
  });
});

describe("cleanModelName", () => {
  test("strips vendor prefixes and normalises separators", () => {
    expect(cleanModelName("openrouter/deepseek/deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(cleanModelName("DeepSeek-V4-Pro")).toBe("DeepSeek-V4-Pro");
    expect(cleanModelName("Kimi K2.7 Code")).toBe("Kimi K2.7 Code");
  });
});
