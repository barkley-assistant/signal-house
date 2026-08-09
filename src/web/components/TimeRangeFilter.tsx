/**
 * Time-range filter — segmented control for the dashboard window (7/30/90 days).
 *
 * A global filter: it scopes every windowed metric on the page (health strip,
 * Agent Spend totals, chart, by-model table), so it lives above the health
 * strip and applies instantly on click. The selection persists across page
 * loads via localStorage (same pattern as the by-model sort state).
 *
 * The active option is a sliding thumb (`.time-filter__thumb`) that glides to
 * the selected button — measured with getBoundingClientRect so it stays glued
 * even when the buttons reflow (media-query padding, font load, window
 * resize; a ResizeObserver keeps it honest). The first paint snaps to the
 * restored window without animating; subsequent changes slide.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { useDash, loadState, storeWindowDays } from "../state/store";
import { WINDOW_PRESETS, type WindowDays } from "../../shared/window";

export function TimeRangeFilter() {
  const days = useDash((s) => s.days);
  const setDays = useDash((s) => s.setDays);
  const groupRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  // The thumb's transition stays off until the first position has painted,
  // so restoring the stored window never animates from "7 days".
  const [ready, setReady] = useState(false);

  const select = (d: WindowDays) => {
    if (d === days) return;
    setDays(d);
    storeWindowDays(d);
    // Refetch immediately — don't wait for the 30s poll to pick up the window.
    void loadState();
  };

  const positionThumb = () => {
    const group = groupRef.current;
    const thumb = thumbRef.current;
    const active = group?.querySelector<HTMLButtonElement>(".time-filter__btn.is-active");
    if (!group || !thumb || !active) return;
    const g = group.getBoundingClientRect();
    const b = active.getBoundingClientRect();
    // The thumb's containing block is the group's padding box, so subtract
    // the group border when converting viewport coords to group coords.
    const border = parseFloat(getComputedStyle(group).borderLeftWidth) || 0;
    thumb.style.width = `${b.width}px`;
    thumb.style.transform = `translateX(${b.left - g.left - border}px)`;
  };

  // Initial snap + keep the thumb glued across reflows (resize, font load,
  // media-query padding changes).
  useLayoutEffect(() => {
    positionThumb();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => positionThumb());
      ro.observe(groupRef.current!);
      return () => ro.disconnect();
    }
  }, []);

  // Slide the thumb when the active window changes (runs after the DOM has
  // the new .is-active, so it queries the right button).
  useLayoutEffect(() => {
    positionThumb();
  }, [days]);

  // Enable the transition only after the initial position has painted.
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={groupRef} className="time-filter" role="group" aria-label="Time range">
      <span
        ref={thumbRef}
        className={`time-filter__thumb${ready ? "" : " time-filter__thumb--no-anim"}`}
        aria-hidden="true"
      />
      {WINDOW_PRESETS.map((d) => (
        <button
          key={d}
          type="button"
          className={`time-filter__btn${days === d ? " is-active" : ""}`}
          aria-pressed={days === d}
          onClick={() => select(d)}
        >
          {d} days
        </button>
      ))}
    </div>
  );
}
