/**
 * Refresh status — two surfaces:
 *  1. A compact status chip in the app header (dot + short label + refresh
 *     button) for at-a-glance currency.
 *  2. The full detail block at the bottom of the diagnostics panel: last
 *     updated, last success/failure, reset-lock, and state banners.
 *
 * Explicit states: fresh / stale / partial / missing / refresh failed /
 * in progress.
 */

import type { StatePayload } from "../state/store";
import { useDash, triggerRefresh, resetLock } from "../state/store";
import { formatRelative, formatAbsolute } from "../../shared/format";

/** Dot colour + short label for a given refresh state. */
function refreshVitals(refresh: StatePayload["status"]["refresh"], freshnessState: string, inProgress: boolean) {
  if (inProgress) return { dot: "dot--info", label: "Refreshing…" };
  if (refresh.status === "failed") return { dot: "dot--error", label: "Refresh failed" };
  if (refresh.status === "partial") return { dot: "dot--warning", label: "Partial refresh" };
  if (freshnessState === "stale") return { dot: "dot--neutral", label: "Stale" };
  if (freshnessState === "missing") return { dot: "dot--neutral", label: "No data" };
  return { dot: "dot--success", label: "Up to date" };
}

/** Compact header chip — the at-a-glance currency indicator. */
export function HeaderRefreshChip({ status }: { status: StatePayload["status"] }) {
  const { refreshing, refreshMessage, setDiagnosticsOpen } = useDash();
  const refresh = status.refresh;
  const { dot, label } = refreshVitals(refresh, status.freshness.state, refreshing || refresh.inProgress);

  return (
    <div className="header-refresh" aria-label="Refresh status">
      <button
        className="header-refresh__chip"
        onClick={() => setDiagnosticsOpen(true)}
        title="Open Source Diagnostics for details"
      >
        <span className={`dot ${dot}`} />
        {label}
      </button>
      <button
        className="primary header-refresh__btn"
        onClick={() => void triggerRefresh()}
        disabled={refreshing || refresh.inProgress}
      >
        {refreshing || refresh.inProgress ? "Refreshing…" : "Refresh now"}
      </button>
      {refreshMessage && <span className="header-refresh__msg">{refreshMessage}</span>}
    </div>
  );
}

/** Full detail block — lives at the bottom of the diagnostics panel. */
export function RefreshDetail({ status }: { status: StatePayload["status"] }) {
  const { refreshing, refreshMessage } = useDash();
  const refresh = status.refresh;

  const bannerKind = refresh.status === "failed" ? "error" : refresh.status === "partial" ? "warning" : status.freshness.state === "stale" ? "stale" : status.freshness.state === "missing" ? "neutral" : null;

  return (
    <div className="diag-section refresh-detail">
      <div className="refresh-detail__header">
        <span className={`dot ${refresh.inProgress || refreshing ? "dot--info" : refresh.status === "failed" ? "dot--error" : refresh.status === "partial" ? "dot--warning" : status.freshness.state === "stale" ? "dot--neutral" : status.freshness.state === "missing" ? "dot--neutral" : "dot--success"}`} />
        <span className="kpi-tile__label">
          {refresh.inProgress || refreshing ? "Refresh in progress…" : refresh.status === "failed" ? "Refresh failed" : refresh.status === "partial" ? "Partial refresh" : status.freshness.state === "stale" ? "Stale" : status.freshness.state === "missing" ? "No data yet" : "Up to date"}
        </span>
      </div>
      <div className="refresh-row">
        <div>
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
