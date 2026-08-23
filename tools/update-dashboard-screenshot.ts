/**
 * update-dashboard-screenshot.ts — refresh docs/screenshots/dashboard.webp
 * from the live deployment.
 *
 * Loads the production dashboard headless, waits until real data has arrived
 * (the header's "Up to date" pill) and the ECharts canvases have painted,
 * then screenshots the page at exactly 1475x1200 — the dimensions of the
 * existing documentation screenshot — encoded straight to WebP. The previous
 * file is replaced atomically.
 *
 * Usage:
 *   bun tools/update-dashboard-screenshot.ts
 *
 * Environment overrides:
 *   SIGNALHOUSE_SCREENSHOT_URL       target page (default production URL)
 *   SIGNALHOUSE_SCREENSHOT_OUT       output path (default docs/screenshots/dashboard.webp)
 *   SECRET_HOUSE_AUTH_USERNAME/_PASSWORD  Basic-auth credentials, when the
 *                                    target deployment has auth enabled
 *
 * Requires: Playwright browsers (`bunx playwright install chromium` once).
 */

import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const URL = process.env.SIGNALHOUSE_SCREENSHOT_URL ?? "https://signalhouse.barkleyassistant.dev/";
const OUT = resolve(REPO_ROOT, process.env.SIGNALHOUSE_SCREENSHOT_OUT ?? "docs/screenshots/dashboard.webp");
// Matches the committed screenshot this tool replaces — change both together.
const WIDTH = 1475;
const HEIGHT = 1200;
const QUALITY = 88;

async function main(): Promise<void> {
  const hasAuth = Boolean(process.env.SECRET_HOUSE_AUTH_USERNAME && process.env.SECRET_HOUSE_AUTH_PASSWORD);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    ...(hasAuth
      ? { httpCredentials: { username: process.env.SECRET_HOUSE_AUTH_USERNAME!, password: process.env.SECRET_HOUSE_AUTH_PASSWORD! } }
      : {}),
  });
  const page = await context.newPage();

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });

    // Readiness = data, not just markup: the header pill flips to
    // "Up to date" once /api/state reports fresh telemetry.
    await page.getByText("Up to date").first().waitFor({ state: "visible", timeout: 30_000 });

    // Charts are ECharts canvases; wait until they exist AND have been sized
    // by their layout container (width > 0 means init() succeeded).
    await page.waitForFunction(
      () => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        return canvases.length > 0 && canvases.every((c) => c.width > 50);
      },
      { timeout: 30_000 },
    );

    // Settle: let ECharts' entrance animations (~700ms) finish so the capture
    // is the resting frame, not a midpoint tween.
    await page.waitForTimeout(1_500);

    mkdirSync(dirname(OUT), { recursive: true });
    const tmp = `${OUT}.tmp.png`;
    try {
      await page.screenshot({ path: tmp, type: "webp", quality: QUALITY });
      // Playwright appends the extension per type; normalize to our target.
      renameSync(`${tmp}`, OUT);
    } catch {
      // Older Playwright builds lack native WebP: fall back to PNG + ImageMagick.
      const pngTmp = `${OUT}.tmp.png`;
      await page.screenshot({ path: pngTmp, type: "png" });
      const proc = Bun.spawn(["magick", pngTmp, "-quality", String(QUALITY), OUT]);
      const code = await proc.exited;
      rmSync(pngTmp, { force: true });
      if (code !== 0) throw new Error(`ImageMagick conversion failed (exit ${code})`);
    }

    console.log(`screenshot updated: ${OUT}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error("screenshot failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
