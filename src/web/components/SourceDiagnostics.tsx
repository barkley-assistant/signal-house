/**
 * Source diagnostics — LAZY: nothing is fetched or rendered until the
 * operator expands the panel. Shows collector health + discovered repos
 * (privacy-filtered server-side).
 */

import { useRef } from "react";
import { useDash, loadDiagnostics } from "../state/store";
import { formatRelative } from "../../shared/format";

export function SourceDiagnostics() {
  const { diagnostics, diagnosticsLoading, diagnosticsOpen, setDiagnosticsOpen } = useDash();
  const requestedRef = useRef(false);

  const open = () => {
    setDiagnosticsOpen(true);
    if (!requestedRef.current) {
      requestedRef.current = true;
      void loadDiagnostics();
    }
  };

  if (!diagnosticsOpen) {
    return (
      <section className="card">
        <div className="diag-header">
          <h2>Source Diagnostics</h2>
          <button className="primary" onClick={open}>Open diagnostics</button>
        </div>
        <p className="kpi-caption">Collector health, discovered repositories, and configuration summary.</p>
      </section>
    );
  }

  if (diagnosticsLoading) {
    return (
      <section className="card">
        <h2>Source Diagnostics</h2>
        <div className="skeleton" style={{ height: 80 }} />
      </section>
    );
  }

  if (!diagnostics) {
    return (
      <section className="card">
        <h2>Source Diagnostics</h2>
        <p className="state-label">Failed to load diagnostics.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="diag-header">
        <h2>Source Diagnostics</h2>
        <button onClick={() => setDiagnosticsOpen(false)}>Collapse</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Source</th>
            <th>Status</th>
            <th>Last captured</th>
            <th>Warnings / errors</th>
          </tr>
        </thead>
        <tbody>
          {diagnostics.sources.map((s) => (
            <tr key={s.id}>
              <td>
                {s.title} <span className="kpi-caption">({s.tier})</span>
              </td>
              <td>
                <span className={`dot ${s.unavailable ? "dot--neutral" : s.ok ? "dot--success" : "dot--error"}`} />
                {s.unavailable ? "unavailable" : s.ok ? "healthy" : "failed"}
                {s.stale && <span className="kpi-caption"> · stale</span>}
              </td>
              <td>{s.capturedAt ? formatRelative(s.capturedAt) : "—"}</td>
              <td>
                {s.warnings.length === 0 && s.errors.length === 0 ? (
                  <span className="kpi-caption">—</span>
                ) : (
                  <ul className="warnings">
                    {[...s.warnings, ...s.errors.map((e) => e.message)].map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="diag-section">
        <div className="kpi-tile__label">Discovered repositories ({diagnostics.discoveredRepos.length})</div>
        {diagnostics.uncoveredPrivacyRepos > 0 && (
          <p className="kpi-caption" style={{ color: "var(--warning)" }}>
            {diagnostics.uncoveredPrivacyRepos} repo(s) with unverified privacy — treated as private
          </p>
        )}
        {diagnostics.discoveredRepos.length === 0 ? (
          <p className="state-label">None discovered yet.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Repo</th>
                <th>Source</th>
                <th>Privacy</th>
                <th>Remote</th>
              </tr>
            </thead>
            <tbody>
              {diagnostics.discoveredRepos.map((r) => (
                <tr key={r.repoKey}>
                  <td>{r.name}</td>
                  <td>{r.source}</td>
                  <td>{r.isPrivate === null ? "unknown" : r.isPrivate ? "private" : "public"}</td>
                  <td className="kpi-caption">{r.remoteUrl ?? r.localPath ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
