/**
 * happy-dom global installation for frontend tests.
 * Preloaded via bunfig.toml [test] so globals exist BEFORE test modules
 * (and their @testing-library imports) evaluate.
 */

import { Window } from "happy-dom";

const win = new Window();

const keys = [
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "getComputedStyle",
  "SVGElement",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "CustomEvent",
  "Event",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "NodeList",
  "HTMLCollection",
  "localStorage",
  "sessionStorage",
  "CSS",
] as const;

for (const key of keys) {
  Object.defineProperty(globalThis, key, { value: win[key as keyof Window], configurable: true, writable: true });
}
// ResizeObserver is used by the spend chart; happy-dom doesn't ship it, so
// provide a no-op class that fires nothing (the chart re-measures on window
// resize, which is not exercised in unit tests anyway).
class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserver, configurable: true, writable: true });
Object.defineProperty(globalThis, "window", { value: win, configurable: true, writable: true });
Object.defineProperty(globalThis, "matchMedia", {
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }),
  configurable: true,
  writable: true,
});
