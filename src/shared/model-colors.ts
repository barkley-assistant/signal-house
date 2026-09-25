/**
 * Per-family line colours for the model-share chart.
 *
 * Each family maps to a hue with 4 shades; models of the same family get
 * consecutive shades so e.g. several DeepSeek variants read as "blue
 * family" while staying distinguishable. Unknown families fall back to
 * the muted chart grey; the Others rollup gets its own distinct grey.
 */

export const FAMILY_COLORS: Record<string, readonly string[]> = {
  DeepSeek: ["#38bdf8", "#0ea5e9", "#60a5fa", "#2563eb"],
  OpenAI: ["#e2e8f0", "#94a3b8", "#cbd5e1", "#64748b"],
  Anthropic: ["#fb923c", "#f97316", "#fdba74", "#ea580c"],
  Qwen: ["#a78bfa", "#8b5cf6", "#c084fc", "#7c3aed"],
  "z.ai": ["#2dd4bf", "#14b8a6", "#5eead4", "#0d9488"],
  Google: ["#22d3ee", "#06b6d4", "#67e8f9", "#0891b2"],
  Moonshot: ["#f472b6", "#ec4899", "#f9a8d4", "#db2777"],
  Meta: ["#818cf8", "#6366f1", "#a5b4fc", "#4f46e5"],
  Xiaomi: ["#a3e635", "#84cc16", "#bef264", "#65a30d"],
  MiniMax: ["#f87171", "#ef4444", "#fca5a5", "#dc2626"],
  Mistral: ["#fbbf24", "#f59e0b", "#fcd34d", "#d97706"],
  xAI: ["#e879f9", "#d946ef", "#f0abfc", "#c026d3"],
  Tencent: ["#4ade80", "#22c55e", "#86efac", "#16a34a"],
  StepFun: ["#fb7185", "#f43f5e", "#fda4af", "#e11d48"],
  Stealth: ["#d8b4fe", "#a855f7", "#e9d5ff", "#9333ea"],
  "Agnes AI": ["#fde047", "#facc15", "#fef08a", "#eab308"],
};

/** The Others rollup — a distinct neutral, darker than the OpenAI greys. */
export const OTHERS_COLOR = "#71717a";

/** Unmatched families — muted slate. */
export const UNKNOWN_FAMILY_COLOR = "#94a3b8";

/** Pick the nth shade for a family (cycles when a family has more than 4
 *  models in the chart — rare, but never repeats the same colour). */
export function familyColor(family: string | null, index: number): string {
  const shades = family !== null ? FAMILY_COLORS[family] : undefined;
  if (!shades) return UNKNOWN_FAMILY_COLOR;
  return shades[index % shades.length];
}