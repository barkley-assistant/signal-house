/**
 * Signal House service worker.
 *
 * Strategy (issue: "make it a proper progressive web app"):
 *  - hashed static assets (/assets/…) → cache-first. Filenames are
 *    content-hashed, so a cached hit is always the correct bytes; new
 *    deploys simply reference new URLs and old entries age out.
 *  - app shell (index.html, manifest, icons, sw itself) → network-first,
 *    falling back to cache offline so an installed app still BOOTS without
 *    connectivity (showing its last-deployed shell) instead of a dino page.
 *  - /api/* → NEVER cached. This is a live dashboard; stale metrics are
 *    worse than no metrics. Requests fail through to the app, which already
 *    has per-panel loading/error states.
 */

const VERSION = "v2"; // v2: chunk URLs are ./chunk-*.js, not /assets/ — cache rule updated to match
const SHELL_CACHE = `sh-shell-${VERSION}`;
const ASSET_CACHE = `sh-assets-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/offline.html"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** True for content-hashed build outputs — safe to cache forever.
 *  Vite's default output here is ./chunk-<hash>.js at the web root
 *  (not /assets/), so match the hash pattern itself. */
function isHashedAsset(url) {
  return /^\/(assets\/)?(chunk|asset)-[A-Za-z0-9_-]+\.\w+$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // live data — never intercept

  if (isHashedAsset(url)) {
    // Cache-first: hashed filenames are immutable.
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // App shell + icons: network-first with cache fallback.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(event.request);
        if (hit) return hit;
        if (event.request.mode === "navigate") {
          const offline = await caches.match("/offline.html");
          if (offline) return offline;
        }
        return Response.error();
      }),
  );
});
