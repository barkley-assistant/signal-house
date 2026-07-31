/**
 * Attention Queue — open issues/PRs that need the operator's eyes.
 * Server-side privacy-filtered; this component only renders what the API sent.
 */

import type { StatePayload } from "../state/store";
import { formatRelative } from "../../shared/format";

export function AttentionQueue({ attention }: { attention: StatePayload["attention"] }) {
  if (attention.length === 0) {
    return (
      <section className="card" aria-label="Attention queue">
        <h2>Attention Queue</h2>
        <p className="state-label">No open issues or PRs — queue is clear</p>
      </section>
    );
  }

  return (
    <section className="card" aria-label="Attention queue">
      <h2>Attention Queue</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {attention.map((item) => (
          <li key={item.id} className="att-row">
            <div className="att-row__meta">
              <span className={`dot ${item.stale ? "dot--warning" : "dot--info"}`} />
              <span className="mono">{item.type === "pr" ? "PR" : "issue"}</span>
              <span>{item.repo}</span>
              {item.ciStatus && <span className={`mono ${item.ciStatus === "success" ? "state-ok" : item.ciStatus === "failure" ? "state-bad" : ""}`}>CI {item.ciStatus}</span>}
              <span>· {formatRelative(Date.parse(item.updatedAt))}</span>
            </div>
            <div className="att-row__title">
              <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
            </div>
            {item.stale && <div className="kpi-caption">Stale · {item.ageDays}d old</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
