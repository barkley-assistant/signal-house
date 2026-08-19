/**
 * Cache economics panel — mirrors the HealthStrip kpi-tile grammar.
 *
 * Three distinct, non-overlapping metrics: net savings (the payoff), hit
 * rate (efficiency), and cache-read volume (scale). The per-model cache %
 * lives in AgentSpend's by-model table and the per-day cache-read trend in
 * the daily chart, so this card deliberately does NOT repeat them.
 *
 * All values are precomputed by the server; the browser never reads
 * opencode.jsonc.
 */

import { motion } from "framer-motion";
import type { StatePayload } from "../state/store";
import { formatCompact, formatCost, formatPercent } from "../../shared/format";

const container = {
  animate: { transition: { staggerChildren: 0.08 } },
};
const item = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

export function CacheSavingsCard({ state }: { state: StatePayload | null }) {
  const usage = state?.usage ?? null;
  const noCache = (usage?.cacheReadTokens ?? 0) === 0;

  if (!usage || noCache) {
    return (
      <section className="card cache-card" aria-label="Cache savings">
        <h2>Cache</h2>
        <p className="state-label">No cache activity in this window</p>
      </section>
    );
  }

  return (
    <section className="card cache-card" aria-label="Cache savings">
      <h2>Cache</h2>
      <motion.div className="cache-card__overview" variants={container} initial="initial" animate="animate">
        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--success" />Saved</div>
          <div className="big-number">{formatCost(usage.cacheSavings ?? 0)}</div>
          <div className="kpi-caption">estimated input cost avoided</div>
        </motion.div>

        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--info" />Hit rate</div>
          <div className="big-number">{formatPercent(usage.cacheHitRate ?? 0)}</div>
          <div className="kpi-caption">of input tokens served from cache</div>
        </motion.div>

        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--neutral" />Cache read</div>
          <div className="big-number">{formatCompact(usage.cacheReadTokens ?? 0)}</div>
          <div className="kpi-caption">tokens read from cache</div>
        </motion.div>
      </motion.div>
    </section>
  );
}
