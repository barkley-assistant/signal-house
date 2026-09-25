/**
 * Per-model line colours for the model-share chart.
 *
 * The FIRST model of each family takes the family's signature colour
 * (DeepSeek blue, OpenAI white/grey, Anthropic orange, Qwen purple, …).
 * Additional models of the same family take the next available colour
 * from a high-contrast fallback ring — three DeepSeek variants must not
 * read as three barely-different blues, they read as blue + pink + yellow
 * while the legend still tells you which is which. The Others rollup gets
 * its own distinct neutral.
 */

/** Signature colour per family — one per family, chosen to be mutually
 *  distinguishable (the ring avoids these where possible). */
export const FAMILY_FIRST_COLORS: Record<string, string> = {
  DeepSeek: "#38bdf8",
  OpenAI: "#e2e8f0",
  Anthropic: "#fb923c",
  Qwen: "#a78bfa",
  // z.ai deliberately NOT teal: DeepSeek owns cyan-blue, and the two
  // families regularly sit adjacent in the stack — teal read as a second blue.
  "z.ai": "#22c55e",
  Google: "#22d3ee",
  Moonshot: "#f472b6",
  Meta: "#818cf8",
  Xiaomi: "#a3e635",
  MiniMax: "#f87171",
  Mistral: "#fbbf24",
  xAI: "#e879f9",
  Tencent: "#4ade80",
  StepFun: "#fb7185",
  Stealth: "#d8b4fe",
  "Agnes AI": "#fde047",
};

/** High-contrast ring for same-family repeats. Order matters: earlier
 *  entries are picked first, skipping anything already used in the chart.
 *  Greens/teals are pushed late — with DeepSeek (cyan) and z.ai (teal)
 *  often both on screen, an early green repeat reads as a third blue-green. */
export const FALLBACK_RING: readonly string[] = [
  "#f472b6", // pink
  "#818cf8", // indigo
  "#facc15", // yellow
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#a3e635", // lime
  "#f87171", // red
  "#e879f9", // fuchsia
  "#c084fc", // violet
  "#fbbf24", // amber
  "#4ade80", // green
  "#2dd4bf", // teal
];

/** The Others rollup — a distinct neutral, darker than the OpenAI greys. */
export const OTHERS_COLOR = "#71717a";

/** Unmatched families — muted slate (only when even the ring is exhausted). */
export const UNKNOWN_FAMILY_COLOR = "#94a3b8";

/** Assign one colour per model in series order. `family` null (Others)
 *  always gets OTHERS_COLOR; the first model of a family gets the family
 *  colour; repeats get the next unused ring colour. */
export function modelChartColors(models: ReadonlyArray<{ key: string; family: string | null }>): string[] {
  const used = new Set<string>();
  const familySeen = new Set<string | null>();
  const colors: string[] = [];
  for (const m of models) {
    if (m.key === "__others__") {
      colors.push(OTHERS_COLOR);
      used.add(OTHERS_COLOR);
      continue;
    }
    const familyFirst = m.family !== null ? FAMILY_FIRST_COLORS[m.family] : undefined;
    if (familyFirst !== undefined && !familySeen.has(m.family) && !used.has(familyFirst)) {
      familySeen.add(m.family);
      colors.push(familyFirst);
      used.add(familyFirst);
      continue;
    }
    familySeen.add(m.family);
    const ring = FALLBACK_RING.find((c) => !used.has(c));
    const color = ring ?? UNKNOWN_FAMILY_COLOR;
    colors.push(color);
    used.add(color);
  }
  return colors;
}