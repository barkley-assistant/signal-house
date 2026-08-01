/**
 * Playwright end-to-end tests — desktop AND mobile viewports against the
 * running LAN dev server.
 *
 * Requires: the dev server running (bun run dev). Run: bunx playwright test
 */

import { expect, test } from "@playwright/test";

test.describe("dashboard (desktop)", () => {
  test("loads and shows the health strip with live data", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Signal House/);
    await expect(page.getByRole("heading", { name: "Signal House" })).toBeVisible();
    // Health strip tiles animate into view
    await expect(page.getByText("THROUGHPUT")).toBeVisible();
    await expect(page.getByText("CYCLE TIME")).toBeVisible();
    await expect(page.getByText("COST & TOKENS").first()).toBeVisible();
    // Data arrives from the real API (dev server collects hermes + opencode)
    await expect(page.getByText("AGENT SPEND")).toBeVisible();
  });

  test("api endpoints return correct shapes", async ({ request }) => {
    const state = await request.get("/api/state");
    expect(state.ok()).toBeTruthy();
    const body = (await state.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["attention", "status", "summary", "usage", "window"]);

    const health = await request.get("/api/health");
    expect((await health.json())).toHaveProperty("status", "ok");
  });

  test("manual refresh works from the button", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /refresh now/i });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByText(/refresh complete/i)).toBeVisible({ timeout: 15_000 });
  });

  test("diagnostics panel is lazy and opens on demand", async ({ page }) => {
    await page.goto("/");
    // not fetched until opened
    await expect(page.getByRole("button", { name: "Open diagnostics" })).toBeVisible();
    await page.getByRole("button", { name: "Open diagnostics" }).click();
    await expect(page.getByText(/source diagnostics/i).first()).toBeVisible();
    // the per-source table appears (collector titles, not repo names)
    await expect(page.getByText("Hermes Agent")).toBeVisible();
    await expect(page.getByText("Local Git")).toBeVisible();
  });

  test("attention queue renders (or shows clear state)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/attention queue/i)).toBeVisible();
  });

  test("mobile viewport renders without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 13
    await page.goto("/");
    await expect(page.getByText("THROUGHPUT")).toBeVisible();
    // Let ECharts + ResizeObserver settle before measuring.
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
