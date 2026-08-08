/**
 * Time-range filter — segmented control for the dashboard window (7/30/90 days).
 *
 * A global filter: it scopes every windowed metric on the page (health strip,
 * Agent Spend totals, chart, by-model table), so it lives above the health
 * strip and applies instantly on click. The selection persists across page
 * loads via localStorage (same pattern as the by-model sort state).
 */

import { useDash, loadState, storeWindowDays } from "../state/store";
import { WINDOW_PRESETS, type WindowDays } from "../../shared/window";

export function TimeRangeFilter() {
  const days = useDash((s) => s.days);
  const setDays = useDash((s) => s.setDays);

  const select = (d: WindowDays) => {
    if (d === days) return;
    setDays(d);
    storeWindowDays(d);
    // Refetch immediately — don't wait for the 30s poll to pick up the window.
    void loadState();
  };

  return (
    <div className="time-filter" role="group" aria-label="Time range">
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
