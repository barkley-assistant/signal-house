/**
 * Cache savings KPI card — mirrors HealthStrip grammar.
 *
 * Shows windowed cache hit rate, cache_read tokens, and estimated $ saved,
 * plus an expandable per-provider breakdown. All values are precomputed by
 * the server; the browser never reads opencode.jsonc.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import type { StatePayload } from "../state/store";
import { formatNumber, formatCost, formatPercent } from "../../shared/format";

const container = {
  animate: { transition: { staggerChildren: 0.08 } },
};
const item = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" as const } },
};

export function CacheSavingsCard({ state }: { state: StatePayload | null }) {
  const [expanded, setExpanded] = useState(false);
  const usage = state?.usage ?? null;
  const noCache = (usage?.cacheReadTokens ?? 0) === 0;

  return (
    <section className="card cache-card" aria-label="Cache savings">
      <h2>Cache Savings</h2>
      <motion.div className="cache-card__overview" variants={container} initial="initial" animate="animate">
        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--info" />Hit rate</div>
          <div className="big-number">{noCache ? "—" : formatPercent(usage?.cacheHitRate ?? 0)}</div>
          <div className="kpi-caption">{noCache ? "No cached reads" : `${formatNumber(usage?.cacheReadTokens ?? 0)} tokens saved`}</div>
        </motion.div>

        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--success" />Saved</div>
          <div className="big-number">{formatCost(usage?.cacheSavings ?? 0)}</div>
          <div className="kpi-caption">Estimated input cost avoided</div>
        </motion.div>
      </motion.div>

      {usage && Object.keys(usage.bySource).length > 0 && (
        <div className="cache-card__providers">
          <button
            type="button"
            className="cache-card__toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "▾ Hide provider breakdown" : "▸ Show provider breakdown"}
          </button>
          {expanded && (
            <motion.div
              className="cache-card__provider-list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.2 }}
            >
              {Object.entries(usage.bySource)
                .filter(([, s]) => (s.cacheReadTokens ?? 0) > 0)
                .map(([source, s]) => (
                  <div key={source} className="cache-card__provider-row">
                    <span className="cache-card__provider-name">{source}</span>
                    <span className="cache-card__provider-stat">{formatPercent(s.cacheHitRate ?? 0)} hit</span>
                    <span className="cache-card__provider-stat">{formatCost(s.cacheSavings ?? 0)}</span>
                  </div>
                ))}
              {Object.values(usage.bySource).every((s) => (s.cacheReadTokens ?? 0) === 0) && (
                <div className="cache-card__provider-row cache-card__provider-row--empty">No cache activity by provider</div>
              )}
            </motion.div>
          )}
        </div>
      )}
    </section>
  );
}
