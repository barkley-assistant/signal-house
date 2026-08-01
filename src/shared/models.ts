/**
 * Model name normalisation + family mapping.
 *
 * Sources (hermes, opencode, sessions) report the same model under many
 * spellings and vendor prefixes ("DeepSeek-V4-Pro", "deepseek/v4-pro",
 * "openrouter/deepseek/deepseek-v4-pro", …). We reduce every raw name to a
 * canonical group key so the same model across providers collapses into ONE
 * row (cost/tokens/sessions merged), and we attach a human family label
 * (DeepSeek, z.ai, Moonshot, OpenAI, …) for display.
 */

/** Strip vendor/provider prefixes and separators → stable lowercase key. */
export function modelGroupKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  // Vendor prefixes come as path segments ("openrouter/deepseek/deepseek-v4-pro",
  // "deepseek/deepseek-v4-pro"); the model body is always the LAST segment.
  const parts = s.split("/");
  const body = parts.length > 1 ? parts[parts.length - 1] : s;
  // Remove every non-alphanumeric char so "DeepSeek V4 Pro", "deepseek-v4-pro"
  // and "deepseek_v4_pro" all map to the same key.
  return body.replace(/[^a-z0-9]+/g, "");
}

/** Human family label for a model name (or null when unrecognised). */
export function modelFamily(raw: string): string | null {
  const key = modelGroupKey(raw);
  if (!key) return null;

  // Longest-prefix wins; check multi-word families before short prefixes.
  const families: Array<[string, string]> = [
    ["deepseek", "DeepSeek"],
    ["glm", "z.ai"],
    ["zhipu", "z.ai"],
    ["zai", "z.ai"],
    ["moonshot", "Moonshot"],
    ["kimi", "Moonshot"],
    ["minimax", "MiniMax"],
    ["qwen", "Qwen"],
    ["claude", "Anthropic"],
    ["anthropic", "Anthropic"],
    ["gpt", "OpenAI"],
    ["openai", "OpenAI"],
    ["o1", "OpenAI"],
    ["o3", "OpenAI"],
    ["o4", "OpenAI"],
    ["gemini", "Google"],
    ["google", "Google"],
    ["mistral", "Mistral"],
    ["llama", "Meta"],
    ["auto", "Auto"],
  ];
  for (const [prefix, family] of families) {
    if (key.startsWith(prefix)) return family;
  }
  return null;
}

/** Display name for a raw model name: vendor prefixes stripped, spaces
 *  normalised, family casing preserved where known. */
export function cleanModelName(raw: string): string {
  const trimmed = raw.trim();
  const parts = trimmed.split("/");
  const body = parts.length > 1 ? parts[parts.length - 1] : trimmed;
  return body.replace(/[_\s]+/g, " ").trim();
}
