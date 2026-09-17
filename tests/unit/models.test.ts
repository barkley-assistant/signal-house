import { describe, test, expect } from "bun:test";
import { canonicalMachineKey, machineKey, modelLabel, modelFamily } from "../../src/shared/models";

describe("machineKey", () => {
  test("collapses case + separator variants to one key", () => {
    const keys = ["DeepSeek-V4-Pro", "deepseek-v4-pro", "deepseek_v4_pro", "DeepSeek V4 Pro"].map(machineKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("deepseek-v4-pro");
  });

  test("strips dots entirely (GLM-5.2 → glm-52, not glm-5-2)", () => {
    expect(machineKey("GLM-5.2")).toBe("glm-52");
    expect(machineKey("glm-5.2")).toBe("glm-52");
    expect(machineKey("Grok 4.5")).toBe("grok-45");
    expect(machineKey("MiMo-V2.5-Pro")).toBe("mimo-v25-pro");
  });

  test("strips vendor prefixes but keeps bare names intact", () => {
    expect(machineKey("openrouter/deepseek/deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(machineKey("deepseek/deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(machineKey("openai/gpt-56-luna")).toBe("gpt-56-luna");
  });
});

describe("full fleet coverage — every model the operator uses maps to a clean label", () => {
  const fleet: Array<[string, string, string | null]> = [
    ["Grok 4.5", "Grok 4.5", "xAI"],
    ["GLM-5.2", "GLM 5.2", "z.ai"],
    ["GLM-5.1", "GLM 5.1", "z.ai"],
    ["GPT 5.6 Luna", "GPT 5.6 Luna", "OpenAI"],
    ["Gpt 5.6 Luna 900k", "GPT 5.6 Luna", "OpenAI"],
    ["Gpt 5.6 Sol 900k", "GPT 5.6 Sol", "OpenAI"],
    ["Gpt 5.6 Terra 900k", "GPT 5.6 Terra", "OpenAI"],
    ["Gpt 5.6 Astra 900k", "GPT 5.6 Astra", "OpenAI"],
    ["Kimi K3", "Kimi K3", "Moonshot"],
    ["Kimi K2.7 Code", "Kimi K2.7 Code", "Moonshot"],
    ["Kimi K2.6", "Kimi K2.6", "Moonshot"],
    ["MiMo-V2.5", "MiMo V2.5", "Xiaomi"],
    ["MiMo-V2.5-Pro", "MiMo V2.5 Pro", "Xiaomi"],
    ["Muse Spark 1.3", "Muse Spark 1.3", "Meta"],
    ["Muse Spark 1.3 Contributor", "Muse Spark 1.3", "Meta"],
    ["Muse Spark 1.2", "Muse Spark 1.2", "Meta"],
    ["Muse Spark 1.2 Contributor", "Muse Spark 1.2", "Meta"],
    ["Muse Spark 1.1", "Muse Spark 1.1", "Meta"],
    ["Muse Glimmer 30B", "Muse Glimmer 30B", "Meta"],
    ["Union Alpha", "Union Alpha", "Stealth"],
    ["stealth/union-alpha", "Union Alpha", "Stealth"],
    ["Omen Alpha", "Omen Alpha", "Stealth"],
    ["MiniMax M3", "MiniMax M3", "MiniMax"],
    ["MiniMax M2.7", "MiniMax M2.7", "MiniMax"],
    ["Qwen3.7 Max", "Qwen 3.7 Max", "Qwen"],
    ["Qwen3.7 Plus", "Qwen 3.7 Plus", "Qwen"],
    ["Qwen3.6 Plus", "Qwen 3.6 Plus", "Qwen"],
    ["DeepSeek V4 Pro", "DeepSeek V4 Pro", "DeepSeek"],
    ["DeepSeek V4 Flash", "DeepSeek V4 Flash", "DeepSeek"],
    ["Hy3", "Hy3", "Tencent"],
  ];
  for (const [raw, label, family] of fleet) {
    test(`${raw} → "${label}" (${family})`, () => {
      expect(modelLabel(raw)).toBe(label);
      expect(modelFamily(raw)).toBe(family);
    });
  }
});

describe("modelFamily", () => {
  test("prefix fallback covers models not in the table", () => {
    expect(modelFamily("claude-sonnet-4")).toBe("Anthropic");
    expect(modelFamily("gemini-2.5-pro")).toBe("Google");
    expect(modelFamily("mistral-large")).toBe("Mistral");
    expect(modelFamily("llama-4")).toBe("Meta");
    expect(modelFamily("o3-mini")).toBe("OpenAI");
  });

  test("returns null for unknown models", () => {
    expect(modelFamily("some-random-model")).toBeNull();
    expect(modelFamily("")).toBeNull();
  });
});

describe("modelLabel", () => {
  test("title-case fallback for models not in the table", () => {
    expect(modelLabel("some-new-model-v3")).toBe("Some New Model V3");
    expect(modelLabel("Auto")).toBe("Auto");
    expect(modelLabel("unknown")).toBe("Unknown");
  });
});

describe("model aliasing", () => {
  test("dated DeepSeek variants are their own canonical keys (display + trend split)", () => {
    expect(canonicalMachineKey("DeepSeek-V4-Flash-0731")).toBe("deepseek-v4-flash-0731");
    expect(canonicalMachineKey("DeepSeek-V4-Flash")).toBe("deepseek-v4-flash");
    expect(canonicalMachineKey("deepseek/deepseek-v4-flash-0731")).toBe("deepseek-v4-flash-0731"); // vendor-prefixed spelling
    expect(canonicalMachineKey("DeepSeek-V4-Pro-0813")).toBe("deepseek-v4-pro-0813");
    expect(canonicalMachineKey("DeepSeek-V4-Pro")).toBe("deepseek-v4-pro");
    expect(modelLabel("DeepSeek-V4-Flash-0731")).toBe("DeepSeek V4 Flash 0731");
    expect(modelLabel("DeepSeek-V4-Pro-0813")).toBe("DeepSeek V4 Pro 0813");
    expect(modelFamily("DeepSeek-V4-Flash-0731")).toBe("DeepSeek");
    expect(modelFamily("DeepSeek-V4-Pro-0813")).toBe("DeepSeek");
  });

  test("resolves aliases to the canonical label, family, and machine key", () => {
    expect(modelLabel("Ox Alpha Free")).toBe("Ox Alpha");
    expect(modelFamily("Ox Alpha Free")).toBe("Stealth");
    expect(canonicalMachineKey("Ox Alpha Free")).toBe("ox-alpha");
  });

  test("900k variants roll up under their standard OpenAI model", () => {
    expect(modelLabel("Gpt 5.6 Luna 900k")).toBe("GPT 5.6 Luna");
    expect(modelFamily("Gpt 5.6 Luna 900k")).toBe("OpenAI");
    expect(canonicalMachineKey("Gpt 5.6 Luna 900k")).toBe("gpt-56-luna");
  });

  test("900k rollup is generic — any future terra/sol/astra 900k variant resolves to its base", () => {
    expect(modelLabel("Gpt 5.6 Terra 900k")).toBe("GPT 5.6 Terra");
    expect(modelFamily("Gpt 5.6 Terra 900k")).toBe("OpenAI");
    expect(canonicalMachineKey("Gpt 5.6 Terra 900k")).toBe("gpt-56-terra");
    expect(modelLabel("Gpt 5.6 Sol 900k")).toBe("GPT 5.6 Sol");
    expect(canonicalMachineKey("Gpt 5.6 Sol 900k")).toBe("gpt-56-sol");
    expect(modelLabel("Gpt 5.6 Astra 900k")).toBe("GPT 5.6 Astra");
    expect(modelFamily("Gpt 5.6 Astra 900k")).toBe("OpenAI");
    expect(canonicalMachineKey("Gpt 5.6 Astra 900k")).toBe("gpt-56-astra");
  });

  test("900k variant whose base is not in the map keeps its own fallback row", () => {
    expect(modelLabel("Some Future Model 900k")).toBe("Some Future Model 900k");
    expect(modelFamily("Some Future Model 900k")).toBeNull();
    expect(canonicalMachineKey("Some Future Model 900k")).toBe("some-future-model-900k");
  });

  test("Muse Spark 1.3 Contributor rolls up under Muse Spark 1.3 with the Muse family", () => {
    expect(modelLabel("Muse Spark 1.3 Contributor")).toBe("Muse Spark 1.3");
    expect(modelFamily("Muse Spark 1.3 Contributor")).toBe("Meta");
    expect(canonicalMachineKey("Muse Spark 1.3 Contributor")).toBe("muse-spark-13");
    // The canonical entry itself is untouched by the alias.
    expect(modelLabel("Muse Spark 1.3")).toBe("Muse Spark 1.3");
    expect(canonicalMachineKey("Muse Spark 1.3")).toBe("muse-spark-13");
  });

  test("Union Alpha and Omen Alpha resolve as Stealth models (vendor-prefixed spelling included)", () => {
    expect(modelLabel("Union Alpha")).toBe("Union Alpha");
    expect(modelFamily("Union Alpha")).toBe("Stealth");
    expect(canonicalMachineKey("Union Alpha")).toBe("union-alpha");
    expect(modelLabel("stealth/union-alpha")).toBe("Union Alpha");
    expect(modelFamily("stealth/union-alpha")).toBe("Stealth");
    expect(modelLabel("Omen Alpha")).toBe("Omen Alpha");
    expect(modelFamily("Omen Alpha")).toBe("Stealth");
    expect(canonicalMachineKey("Omen Alpha")).toBe("omen-alpha");
  });

  test("preserves unknown-model fallbacks without collapsing", () => {
    const raw = "some-unknown-thing";

    expect(modelLabel(raw)).toBe("Some Unknown Thing");
    expect(modelFamily(raw)).toBeNull();
    expect(canonicalMachineKey(raw)).toBe(machineKey(raw));
  });

  test("leaves the canonical model path unchanged", () => {
    expect(modelLabel("Ox Alpha")).toBe("Ox Alpha");
    expect(canonicalMachineKey("Ox Alpha")).toBe("ox-alpha");
  });
});
