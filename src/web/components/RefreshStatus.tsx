/**
 * Refresh status + freshness banner — the operator's honest picture of
 * data currency. Explicit states: fresh / stale / partial / missing /
 * refresh failed / in progress.
 */

import type { StatePayload } from "../state/store";
import { useDash, triggerRefresh, resetLock } from "../state/store";
import { formatRelative, formatAbsolute } from "../../shared/format";

export function RefreshStatus({ status }: { status: StatePayload["status"] }) {
  const { refreshing, refreshMessage, setRefreshing, setRefreshMessage } = useDash();
  const refresh = status.refresh;

  const bannerKind = refresh.status === "failed" ? "error" : refresh.status === "partial" ? "warning" : status.freshness.state === "stale" ? "stale" : status.freshness.state === "missing" ? "neutral" : null;

  return (
    <div className="card" aria-label="Refresh status">
      <div className="refresh-row">
        <div>
          <div className="kpi-tile__label">
            <span className={`dot ${refresh.inProgress ? "dot--info" : refresh.status === "failed" ? "dot--error" : refresh.status === "partial" ? "dot--warning" : "dot--success"}`} />
            {refresh.inProgress ? "Refresh in progress…" : refresh.status === "failed" ? "Refresh failed" : refresh.status === "partial" ? "Partial refresh" : "Up to date"}
          </div>
          <div className="kpi-caption">
            {status.freshness.state === "missing"
              ? "No data yet — waiting for the first refresh"
              : `Last updated ${formatRelative(status.freshness.lastUpdatedAt)} · ${formatAbsolute(status.freshness.lastUpdatedAt)}`}
          </div>
          {refresh.lastSuccessAt && <div className="kpi-caption">Last successful refresh {formatRelative(Date.parse(refresh.lastSuccessAt))}</div>}
          {(refresh.status === "failed" || refresh.status === "partial") && refresh.lastFailureAt && (
            <div className="kpi-caption" style={{ color: "var(--error)" }}>
              Last failed refresh {formatRelative(Date.parse(refresh.lastFailureAt))}
              {refresh.lastFailureMessage ? ` — ${refresh.lastFailureMessage}` : ""}
            </div>
          )}
          {refreshMessage && <div className="kpi-caption" style={{ color: "var(--info)" }}>{refreshMessage}</div>}
        </div>
        <div className="refresh-actions">
          <button className="primary" onClick={() => void triggerRefresh()} disabled={refreshing || refresh.inProgress}>
            {refreshing || refresh.inProgress ? "Refreshing…" : "Refresh now"}
          </button>
          {refresh.inProgress && (
            <button onClick={() => void resetLock()} title="Clear a stuck refresh lock (does not delete any data)">
              Reset stuck lock
            </button>
          )}
        </div>
      </div>
      {bannerKind === "error" && <div className="banner banner--error">Last refresh failed — showing last good data. Check the diagnostics panel.</div>}
      {bannerKind === "warning" && <div className="banner banner--warning">Last refresh was partial — some sources failed. See diagnostics.</div>}
      {bannerKind === "stale" && <div className="banner banner--stale">Data is stale — no successful refresh within the threshold.</div>}
      {status.coverageWarnings.length > 0 && (
        <ul className="warnings">
          {status.coverageWarnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
