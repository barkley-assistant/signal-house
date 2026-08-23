import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root mount point");

// PWA head links, injected rather than declared in index.html: Bun.build
// resolves <link href> as build-time imports and these live in /public
// (copied verbatim, unhashed — the service worker addresses them by path).
for (const [rel, href] of [
  ["manifest", "/manifest.webmanifest"],
  ["apple-touch-icon", "/icons/apple-touch-icon.png"],
] as const) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}

createRoot(root).render(<App />);

// PWA: register the service worker (installable app, offline shell, instant
// hashed-asset loads). Registration is best-effort — the dashboard works
// fine as a plain website when SWs are unavailable (older browsers,
// non-secure contexts).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* no SW — website mode still fully functional */
    });
  });
}
