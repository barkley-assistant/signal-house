/**
 * Cache savings card — three tiles (hit rate / cache read / saved) plus a
 * compact by-provider breakdown below. Mirrors the kpi-tile grammar used by
 * HealthStrip and the .card chrome of AgentSpend.
 *
 * "No cache activity" is explicit: tiles render "—", "0", "$0.00" (NOT zero-
 * cost confusables). The by-provider list collapses to empty in that case.
 */

import { motion } from "framer-motion";
import { useDash } from "../state/store";
import { formatCompact, formatCost, formatPercent } from "../../shared/format";

const container = {
  initial: {},
  animate: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const item = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" as const } },
};

const SOURCE_LABEL: Record<string, string> = {
  opencode: "OpenCode",
  hermes: "Hermes",
};

/** Title-case a snake/camel id into a friendlier label. Falls back to the
 *  first letter-uppercased raw id when no map entry exists. */
function sourceLabel(id: string): string {
  if (SOURCE_LABEL[id]) return SOURCE_LABEL[id];
  return id.length > 0 ? id[0].toUpperCase() + id.slice(1) : id;
}

/** "$0.00" rather than "—" when the source has activity but no rate — the
 *  acceptance calls for explicit zero rather than unknown so the operator
 *  sees "the cache read happened; we just don't know the dollar value". */
function renderSaved(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$0.00";
  return formatCost(value);
}

export function CacheSavings() {
  const { state } = useDash();
  const usage = state?.usage ?? null;

  // "No cache activity" (per the issue acceptance): usage absent OR
  // totalCacheReadTokens is null/zero. Tiles render "—", "0", "$0.00"
  // — the explicit-zero contract from the issue. "0" (not "—") for tokens
  // because we want the operator to see "no cache was used", not "unknown".
  const noCacheActivity = usage === null || usage.totalCacheReadTokens === null || usage.totalCacheReadTokens === 0;

  const hitRate = noCacheActivity ? null : usage!.cacheHitRate;
  // Coerce null → 0 in the empty state so the tile shows "0" (per spec),
  // not "—". The underlying value is still null when usage is absent —
  // we just choose a stable display for the empty case.
  const readTokens = noCacheActivity ? 0 : usage!.totalCacheReadTokens;
  // Same coercion for $ saved: 0 in the empty state renders as "$0.00"
  // (not "—") via renderSaved.
  const savedUsd = noCacheActivity ? 0 : usage!.totalCacheSavingsUsd;

  const bySource = usage ? Object.entries(usage.bySource) : [];
  const providersWithData = bySource.filter(
    ([, row]) => (row.cacheReadTokens !== null && row.cacheReadTokens !== 0) || (row.cacheSavingsUsd !== null && row.cacheSavingsUsd !== 0),
  );

  return (
    <motion.section
      className="card cache-savings"
      aria-label="Cache savings"
      variants={container}
      initial="initial"
      animate="animate"
    >
      <h2>Cache savings</h2>
      <motion.div className="cache-savings__tiles" variants={item}>
        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--success" />Hit rate</div>
          <div className="big-number">{formatPercent(hitRate)}</div>
          <div className="kpi-caption">of input tokens served from cache</div>
        </motion.div>
        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--info" />Cache read</div>
          <div className="big-number">{formatCompact(readTokens)}</div>
          <div className="kpi-caption">tokens served from cache over the window</div>
        </motion.div>
        <motion.div className="kpi-tile" variants={item}>
          <div className="kpi-tile__label"><span className="dot dot--success" />Saved</div>
          <div className="big-number">{renderSaved(savedUsd)}</div>
          <div className="kpi-caption">estimated input-cost equivalent avoided</div>
        </motion.div>
      </motion.div>

      {providersWithData.length > 0 && (
        <motion.div className="cache-savings__providers" variants={item}>
          <div className="kpi-tile__label" style={{ marginBottom: 8 }}>By provider</div>
          {providersWithData.map(([src, row]) => (
            <div key={src} className="cache-savings__provider-row">
              <span className="cache-savings__provider-name">{sourceLabel(src)}</span>
              <span className="cache-savings__provider-meta">
                {row.cacheReadTokens !== null && row.cacheReadTokens !== 0 ? formatCompact(row.cacheReadTokens) : "—"}{" "}
                tokens · {renderSaved(row.cacheSavingsUsd)}
              </span>
            </div>
          ))}
        </motion.div>
      )}
    </motion.section>
  );
}