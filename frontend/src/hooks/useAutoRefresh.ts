import { useEffect, useState } from "react";

export interface AutoRefreshState {
  now: number;
}

/**
 * Relocation of the two polling intervals from the dashboard `Home()`
 * component. The 30s interval drives `triggerAutoRefresh` (state refresh from
 * the store); the 1s interval advances `now` for relative-time labels.
 * Dependencies mirror the original effects exactly: the refresh effect tracks
 * `triggerAutoRefresh`, the tick effect is mount-only.
 */
export function useAutoRefresh(triggerAutoRefresh: () => void): AutoRefreshState {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const interval = setInterval(() => {
      triggerAutoRefresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [triggerAutoRefresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return { now };
}
