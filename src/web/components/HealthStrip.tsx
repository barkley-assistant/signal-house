/**
 * Health summary strip — the one memorable animated element.
 * Staggered entrance (80ms), 300ms ease-out, once per page load,
 * respects prefers-reduced-motion (via the CSS base layer).
 */

import { motion } from "framer-motion";
import type { StatePayload } from "../state/store";
import { formatNumber, formatCost, formatCompact } from "../../shared/format";

const container = {
  animate: { transition: { staggerChildren: 0.08 } },
};
const item = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

export function HealthStrip({ state }: { state: StatePayload | null }) {
  if (!state) {
    return (
      <div className="health-strip" aria-label="Loading health summary">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className={`kpi-tile${i === 4 ? " kpi-tile--cost-tokens" : ""}`} key={i}>
            <div className="skeleton" style={{ height: 14, width: "60%" }} />
            <div className="skeleton" style={{ height: 28, width: "80%", marginTop: 8 }} />
          </div>
        ))}
      </div>
    );
  }

  const s = state.summary;
  const throughput = s.throughput;
  const cycleTime = s.cycleTime;
  const ci = s.ci;
  const stale = s.staleWork;
  const ct = s.costAndTokens;
  const none = (v: unknown) => v === null || v === undefined;

  return (
    <motion.div className="health-strip" variants={container} initial="initial" animate="animate" aria-label="Health summary">
      <motion.div className="kpi-tile" variants={item}>
        <div className="kpi-tile__label"><span className="dot dot--success" />Throughput</div>
        <div className="big-number">{throughput ? formatNumber(throughput.prsMerged) : "—"}</div>
        <div className="kpi-caption">{throughput ? `${formatNumber(throughput.totalCommits)} commits · ${formatNumber(throughput.prsCreated)} PRs` : "No GitHub data"}</div>
      </motion.div>

      <motion.div className="kpi-tile" variants={item}>
        <div className="kpi-tile__label"><span className="dot dot--info" />Cycle Time</div>
        <div className="big-number">{cycleTime ? formatDuration(cycleTime.medianSeconds) : "—"}</div>
        <div className="kpi-caption">{cycleTime ? `P95 ${formatDuration(cycleTime.p95Seconds)} · ${cycleTime.sampleSize} PRs` : "No merged PRs"}</div>
      </motion.div>

      <motion.div className="kpi-tile" variants={item}>
        <div className="kpi-tile__label">
          <span className={`dot ${ci ? (ci.passRate !== null && ci.passRate >= 0.9 ? "dot--success" : ci.passRate !== null && ci.passRate >= 0.6 ? "dot--warning" : "dot--error") : "dot--neutral"}`} />
          CI Health
        </div>
        <div className="big-number">{ci ? (ci.passRate !== null ? `${Math.round(ci.passRate * 100)}%` : "—") : "—"}</div>
        <div className="kpi-caption">{ci ? `${ci.passCount} pass · ${ci.failCount} fail · ${ci.totalRuns} runs` : "No CI runs"}</div>
      </motion.div>

      <motion.div className="kpi-tile" variants={item}>
        <div className="kpi-tile__label"><span className={`dot ${(!stale || (stale.staleIssues === 0 && stale.stalePrs === 0)) ? "dot--success" : "dot--warning"}`} />Stale Work</div>
        <div className="big-number">{stale ? formatNumber(stale.staleIssues + stale.stalePrs) : "—"}</div>
        <div className="kpi-caption">{stale ? `${stale.staleIssues} issues · ${stale.stalePrs} PRs (${stale.thresholdDays}d)` : "No GitHub data"}</div>
      </motion.div>

      <motion.div className="kpi-tile kpi-tile--cost-tokens" variants={item}>
        <div className="kpi-tile__label">Cost &amp; Tokens</div>
        <div className="big-number">{none(ct?.costPerHour) ? "—" : formatCost(ct!.costPerHour!)}</div>
        <div className="kpi-caption">{none(ct?.tokensPerHour) ? "No usage telemetry" : `${formatCompact(ct!.tokensPerHour!)} tok/hr`}</div>
        {!none(ct?.costPerHour) && (
          <div className="kpi-caption kpi-caption--disclosure">
            Estimated from public list pricing. Set <code>SIGNAL_HOUSE_ESTIMATE_COSTS=false</code> to use upstream-reported values.
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function formatDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m`;
}
