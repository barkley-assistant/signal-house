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
    // The refresh action lives in the diagnostics panel — open it first.
    const open = page.getByRole("button", { name: /open diagnostics/i });
    await expect(open).toBeVisible();
    await open.click();
    const button = page.getByRole("button", { name: /refresh now/i });
    await expect(button).toBeVisible();
    await button.click();
    // "Refresh complete" appears in the header message and the diagnostics detail.
    await expect(page.getByText(/refresh complete/i).first()).toBeVisible({ timeout: 15_000 });
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

  test("by-model table becomes stacked cards on mobile with all stats visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText("By model")).toBeVisible();
    await page.waitForTimeout(800);

    // Rows render as cards (not the 480px scroll table), so every stat is
    // on-screen without horizontal scrolling.
    const rowDisplay = await page.locator(".model-table tbody tr").first().evaluate((el) => getComputedStyle(el).display);
    expect(rowDisplay).toBe("grid");
    const wrapperScrolls = await page.locator(".model-table").evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(wrapperScrolls).toBe(false);

    // Every stat cell carries its label (Sessions / Tokens / Cost) and none
    // pokes out of the card bounds.
    const labels = await page.locator(".model-table tbody tr").first().evaluate((tr) =>
      [...tr.querySelectorAll("td.num")].map((td) => getComputedStyle(td, "::before").content),
    );
    expect(labels.join(",")).toContain("Sessions");
    expect(labels.join(",")).toContain("Tokens");
    expect(labels.join(",")).toContain("Cost");

    // Sorting survives the card reflow: tap the Cost pill.
    await page.locator(".model-table .sort-btn", { hasText: "Cost" }).click();
    await expect(page.locator(".model-table .sort-btn.is-active")).toContainText("Cost");
  });

  test("time-range filter switches the whole dashboard window", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("group", { name: "Time range" })).toBeVisible();
    // Default window is 30 days.
    await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "90 days" }).click();
    await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "false");
    // The sliding thumb settles exactly over the newly active button (poll:
    // the 220ms glide finishes after aria-pressed flips).
    await expect(page.locator(".time-filter__thumb")).toBeVisible();
    await expect
      .poll(async () => {
        const thumbX = await page.locator(".time-filter__thumb").evaluate((el) => {
          const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
          return m ? Math.round(parseFloat(m[1].split(",")[4])) : null;
        });
        const btnX = await page
          .locator(".time-filter__btn.is-active")
          .evaluate((el) => Math.round(el.getBoundingClientRect().left - el.parentElement!.getBoundingClientRect().left - 1));
        return thumbX === btnX;
      })
      .toBe(true);
    // The window survives a reload (localStorage).
    await page.reload();
    await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
    // Back to 30 days for a clean state.
    await page.getByRole("button", { name: "30 days" }).click();
    await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
  });

  test("cache savings card is temporarily hidden from dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cache Savings" })).toHaveCount(0);
  });

  test("cache savings API surfaces additive cache fields", async ({ request }) => {
    const res = await request.get("/api/state");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { usage: Record<string, unknown> | null };
    expect(body.usage).not.toBeNull();
    expect(body.usage).toHaveProperty("cacheReadTokens");
    expect(body.usage).toHaveProperty("cacheHitRate");
    expect(body.usage).toHaveProperty("cacheSavings");
  });
});
