/**
 * Touch-aware tooltip trigger for the ECharts instances.
 *
 * Desktop: default `mousemove`-driven tooltips feel instant and correct.
 * Touch: `mousemove` is synthesized from finger drags, so a scroll swipe
 * flicks tooltips open and they chase the finger across the chart. Coarse
 * pointers therefore flip to `click` — the tooltip only opens on a
 * deliberate tap, never while scrolling.
 */
export function touchAwareTooltip(): { triggerOn: "mousemove" | "click" } {
  const coarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return { triggerOn: coarse ? "click" : "mousemove" };
}