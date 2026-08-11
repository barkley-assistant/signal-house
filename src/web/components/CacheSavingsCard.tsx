/**
 * Cache Savings card — surfaces prompt-cache efficiency.
 *
 * Headline: window-aggregated cache hit rate (sum(cache_read) / sum(cache_read + input)),
 * total cache_read tokens, and estimated $ saved at the operator-curated
 * input rate. Per-source row breaks the savings down by OpenCode / Hermes so
 * the operator can see whether a provider change moved the needle.
 *
 * Formula and rationale: `shared/model-costs.ts` documents the deliberate
 * `cost.cache.read = 0` openference provider config (cached reads are free).
 * The savings shown here is `cacheReadTokens × costInput / 1e6` per priced
 * model, summed across the window. Unpriced models render as em-dash on the
 * $ saved cell — never $0.00, since "no price" is not the same signal as
 * "no savings".
 */

import { useDash } from "../state/store";
import { formatCompact, formatCost, formatPercent } from "../../shared/format";

export function CacheSavingsCard() {
  const { state } = useDash();
  const usage = state?.usage ?? null;
  if (!usage) return null;

  const hasCacheSignal =
    (usage.totalCacheReadTokens ?? 0) > 0 ||
    (usage.totalCacheSavingsUsd ?? 0) > 0 ||
    usage.cacheHitRate !== null;

  return (
    <section className="card cache-savings-card" aria-label="Prompt cache savings">
      <h2>Prompt Cache</h2>
      <div className="cache-savings-grid">
        <div className="cache-savings-stat">
          <div className="kpi-tile__label">Hit rate</div>
          <div className="big-number">{usage.cacheHitRate === null ? "—" : formatPercent(usage.cacheHitRate)}</div>
          <div className="kpi-caption">
            {hasCacheSignal ? `${formatCompact(usage.totalCacheReadTokens ?? 0)} cache-read tokens` : "No cache activity yet"}
          </div>
        </div>
        <div className="cache-savings-stat">
          <div className="kpi-tile__label">$ Saved (window)</div>
          <div className="big-number">{formatCost(usage.totalCacheSavingsUsd ?? 0)}</div>
          <div className="kpi-caption">cache_read × costInput / 1M</div>
        </div>
      </div>
      <div className="cache-savings-sources">
        <div className="cache-savings-sources__title">By source</div>
        <CacheSourceRow label="OpenCode" sourceKey="opencode" usage={usage} />
        <CacheSourceRow label="Hermes" sourceKey="hermes" usage={usage} />
      </div>
    </section>
  );
}

type UsageLike = NonNullable<ReturnType<typeof useDash.getState>["state"]>["usage"];

function CacheSourceRow({ label, sourceKey, usage }: { label: string; sourceKey: string; usage: UsageLike }) {
  const src = usage?.bySource[sourceKey as keyof typeof usage.bySource];
  if (!src) {
    return (
      <div className="cache-savings-source-row">
        <div className="cache-savings-source-row__info">
          <span className="kpi-tile__label heading">{label}</span>
          <span className="cache-savings-source-row__meta">No data</span>
        </div>
        <span className="big-number small">—</span>
      </div>
    );
  }
  const tokens = src.cacheReadTokens ?? 0;
  const savings = src.cacheSavingsUsd;
  return (
    <div className="cache-savings-source-row">
      <div className="cache-savings-source-row__info">
        <span className="kpi-tile__label heading">{label}</span>
        <span className="cache-savings-source-row__meta">{formatCompact(tokens)} cache-read tokens</span>
      </div>
      <span className="big-number small">{formatCost(savings ?? 0)}</span>
    </div>
  );
}