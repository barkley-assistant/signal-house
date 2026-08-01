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
import { RefreshStatus } from "../components/RefreshStatus";
import { SourceDiagnostics } from "../components/SourceDiagnostics";
import { Logo } from "../components/Logo";

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
      </header>

      {error && (
        <div className="banner banner--error" role="alert">
          Could not reach the Signal House API — {error}. Retrying automatically…
        </div>
      )}

      <main className="app-main">
        <HealthStrip state={state} />

        {state && <RefreshStatus status={state.status} />}

        <AgentSpend />
        <AttentionQueue attention={state?.attention ?? []} />

        {state && <SourceDiagnostics />}
      </main>

      <footer className="app-footer">
        <span>
          <a href="https://github.com/barkley-assistant/signal-house" target="_blank" rel="noreferrer">
            Signal House v{pkg.version}
          </a>
        </span>
        {state && <span className="kpi-caption">{state.window.days} days usage</span>}
      </footer>
    </div>
  );
}
