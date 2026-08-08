/**
 * TimeRangeFilter tests — the dashboard window segmented control.
 *
 * Covers the required behaviours: three presets render with the active one
 * marked, clicking a preset switches the store window AND refetches /api/state
 * immediately (not waiting for the 30s poll), the selection persists to
 * localStorage, and the store restores it on init (corrupt values fall back).
 */

import { beforeEach, describe, expect, test, afterEach, vi } from "bun:test";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TimeRangeFilter } from "../../../src/web/components/TimeRangeFilter";
import { useDash, WINDOW_STORAGE_KEY, readStoredDays, storeWindowDays } from "../../../src/web/state/store";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useDash.setState({ days: 30 });
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const pressed = (el: HTMLElement): string | null => el.getAttribute("aria-pressed");

describe("TimeRangeFilter", () => {
  test("renders the three window presets with the current one active", () => {
    useDash.setState({ days: 30 });
    render(<TimeRangeFilter />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["7 days", "30 days", "90 days"]);
    expect(pressed(buttons[1])).toBe("true");
    expect(pressed(buttons[0])).toBe("false");
    expect(pressed(buttons[2])).toBe("false");
  });

  test("clicking a preset switches the window, refetches state, and persists", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ window: { start: "x", end: "y", days: 7 } }),
    } as Response);
    useDash.setState({ days: 30 });
    render(<TimeRangeFilter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    });

    expect(useDash.getState().days).toBe(7);
    expect(localStorage.getItem(WINDOW_STORAGE_KEY)).toBe("7");
    // The click must refetch immediately with the new window — polling would
    // otherwise serve the old window's data for up to 30s.
    expect(fetchSpy).toHaveBeenCalledWith("/api/state?days=7", undefined);
    // Active marker moves.
    expect(pressed(screen.getByRole("button", { name: "7 days" }))).toBe("true");
    expect(pressed(screen.getByRole("button", { name: "30 days" }))).toBe("false");
  });

  test("clicking the already-active window does not refetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    useDash.setState({ days: 30 });
    render(<TimeRangeFilter />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("window persistence", () => {
  test("readStoredDays restores a stored window and falls back on corrupt values", () => {
    storeWindowDays(90);
    expect(readStoredDays()).toBe(90);

    localStorage.setItem(WINDOW_STORAGE_KEY, "45"); // not a preset
    expect(readStoredDays()).toBe(30);

    localStorage.setItem(WINDOW_STORAGE_KEY, "banana");
    expect(readStoredDays()).toBe(30);

    localStorage.removeItem(WINDOW_STORAGE_KEY);
    expect(readStoredDays()).toBe(30);
  });
});
