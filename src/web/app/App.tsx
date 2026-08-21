/**
 * Signal House dashboard shell.
 * Health strip on top, then refresh status, then the work cards.
 */

import { useEffect } from "react";
import { useDash, startPolling } from "../state/store";
import pkg from "../../../package.json";
import { HealthStrip } from "../components/HealthStrip";
import { AttentionQueue } from "../components/AttentionQueue";
import { AgentSpend } from "../components/AgentSpend";
import { DeliveryTrend } from "../components/DeliveryTrend";
import { TimeRangeFilter } from "../components/TimeRangeFilter";
import { HeaderRefreshChip } from "../components/RefreshStatus";
import { SourceDiagnostics } from "../components/SourceDiagnostics";
import { Logo } from "../components/Logo";
import { formatRelative } from "../../shared/format";

export function App() {
  const { state, error } = useDash();

  useEffect(() => startPolling(), []);

  return (
    <div>
      <header className="app-header">
        <div className="app-header__brand">
          <Logo size={64} />
          <div className="app-header__text">
            <h1>Signal House</h1>
            <p className="app-header__tagline">Know whether work is moving — and where it's stuck</p>
          </div>
        </div>
        {/* On tablet/mobile the chip relocates above the brand via CSS
            order — see .app-header media query in base.css. Keeps a single
            mounted instance (one useDash subscription) while giving the
            lozenge its own row instead of crowding the logo. */}
        <div className="app-header__actions">{state && <HeaderRefreshChip status={state.status} />}</div>
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          Could not reach the Signal House API — {error}. Retrying automatically…
        </div>
      )}

      <main className="app-main">
        <div className="app-filter-row">
          <TimeRangeFilter />
        </div>

        <HealthStrip state={state} />

        <AgentSpend />
        <DeliveryTrend />
        <AttentionQueue attention={state?.attention ?? []} />

        {state && <SourceDiagnostics status={state.status} />}
      </main>

      <footer className="app-footer">
        <div className="app-footer__left">
          <a className="app-footer__brand" href="https://github.com/barkley-assistant/signal-house" target="_blank" rel="noreferrer">
            Signal House <span className="app-footer__version">v{pkg.version}</span>
          </a>
          <span className="app-footer__sep">·</span>
          <a href="https://github.com/barkley-assistant/signal-house/blob/main/LICENSE" target="_blank" rel="noreferrer">
            MIT
          </a>
        </div>
        <div className="app-footer__bun">
          Made with <span className="app-footer__heart">♥</span> in{" "}
          <a href="https://bun.sh" target="_blank" rel="noreferrer">Bun</a>
        </div>
        {state && <span className="app-footer__right">{state.status.refresh.lastSuccessAt ? `Last successful refresh ${formatRelative(Date.parse(state.status.refresh.lastSuccessAt))}` : ""}</span>}
      </footer>
    </div>
  );
}
