/**
 * Agent Spend card — consolidated cost/tokens view (planning 03 §Card, decision #10).
 * A single panel: macro totals in a hero on the left, per-source breakdown
 * (OpenCode / Hermes) as a ledger on the right, then the stacked daily chart
 * and by-model table. Sources without cost telemetry render "—", never 0.
 */

import { useEffect, useRef, useState, Fragment } from "react";
import { motion } from "framer-motion";
import * as echarts from "echarts";
import { useDash, loadTrend, loadModelTrend, type ModelTrendPoint, type TrendPoint } from "../state/store";
import type { WindowDays } from "../../shared/window";
import { formatNumber, formatCost, formatCostHero, formatCompact, formatPercent, formatEffPerM } from "../../shared/format";
import { niceCeil } from "../../shared/math";
import { touchAwareTooltip } from "./chart-tooltip";

/** Cost count-up on mount — the figure ticks 0 → value over ~900ms.
 *  Plain requestAnimationFrame loop (no framer motion-value indirection) so
 *  it's deterministic. prefers-reduced-motion is honoured by the global CSS
 *  kill in base.css. Uses formatCostHero so the running tick matches the
 *  final formatting (cents suppressed when the target is ≥ $1k). */
function useCountUp(target: number | null, duration = 900) {
  const [text, setText] = useState<string>(target === null ? "—" : formatCostHero(0));
  useEffect(() => {
    if (target === null) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setText(formatCostHero(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setText(formatCostHero(target));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return text;
}

export function AgentSpend() {
  const { state } = useDash();
  const usage = state?.usage ?? null;
  const heroAmount = useCountUp(usage?.totalCost ?? null);
  const hasCacheActivity = (usage?.cacheReadTokens ?? 0) > 0;
  const savedAmount = useCountUp(hasCacheActivity && Number.isFinite(usage?.cacheSavings) ? usage?.cacheSavings ?? 0 : 0);
  const hitRateDisplay = hasCacheActivity ? formatPercent(usage?.cacheHitRate) : "—";

  return (
    <section className="card" aria-label="Agent spend">
      <h2>Agent Spend</h2>
      {!usage || usage.totalSessions === 0 && !usage.totalTokens && !usage.totalCost ? (
        <p className="state-label">No usage telemetry yet — sources unavailable or no sessions collected</p>
      ) : (
        <>
          <div className="spend-overview">
            <div className="spend-overview__total">
              <div className="kpi-tile__label">Total cost</div>
              <div className="spend-hero__amount">{heroAmount}</div>
              <div className="spend-hero__meta">
                <span>{formatNumber(usage.totalSessions)} Sessions</span>
                <span className="spend-hero__dot" aria-hidden="true">·</span>
                <span>{formatCompact(usage.totalTokens)} Tokens</span>
              </div>
            </div>
            <motion.div
              className="spend-overview__cache"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
            >
              <span className="kpi-tile__label">Cache</span>
              <span className="spend-hero__amount">{hitRateDisplay}</span>
              <span className="kpi-caption">
                saved {savedAmount} at model input rates
              </span>
            </motion.div>
            <motion.div
              className="spend-sources"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.09, delayChildren: 0.15 } },
              }}
            >
              <SpendSource label="OpenCode" source="opencode" usage={usage} />
              <SpendSource label="Hermes" source="hermes" usage={usage} />
            </motion.div>
          </div>
          <hr className="spend-divider" />
          <DailyUsageChart />
          <ModelTable />
        </>
      )}
    </section>
  );
}

type UsageLike = NonNullable<ReturnType<typeof useDash.getState>["state"]>["usage"];

/** One agent row in the right-hand ledger — title + substats stack on the
 *  left (vertically centered), cost figure anchored right (vertically
 *  centered against the stack). */
function SpendSource({ label, source, usage }: { label: string; source: string; usage: UsageLike }) {
  const src = usage?.bySource[source as keyof typeof usage.bySource];
  return (
    <motion.div
      className="spend-source-row"
      variants={{
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" as const } },
      }}
    >
      <div className="spend-source-row__info">
        <span className="kpi-tile__label heading">{label}</span>
        <span className="spend-source-row__meta">
          {src
            ? `${formatNumber(src.sessions)} sessions · ${formatCompact(src.tokens)} tokens · ${formatCompact(src.cacheReadTokens)} cached`
            : "No data"}
        </span>
      </div>
      <span className="big-number small">{src ? formatCost(src.cost) : "—"}</span>
    </motion.div>
  );
}

/** Read a persisted ECharts legend selection ({seriesName: visible}) from
 *  localStorage. Absent key, corrupt JSON, or non-object payload → undefined
 *  (ECharts then shows every series — the natural default). */
export function readLegendSelection(storageKey: string): Record<string, boolean> | undefined {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "boolean") out[k] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  } catch {
    /* corrupt or unavailable storage — default to all-visible */
  }
  return undefined;
}

/** Daily cost + token trend from /api/daily/spend, styled natively to the
 *  dashboard: card background, token palette, faint split lines matching the
 *  table borders. Dual y-axes — cost (left, blue) and tokens (right, yellow).
 *  X-axis shows day+date; the tooltip carries the full date and both metrics.
 */
function DailyUsageChart() {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const days = useDash((s) => s.days);
  // Persisted legend selection: which of Cost/Tokens/Cache read are on.
  const LEGEND_STORAGE_KEY = "signal-house:daily-usage-legend";
  // Axis peaks are computed once per window and frozen within it — they
  // define the chart's y-scale. A deliberate window change rescales to fit
  // the new data; the 30s poll within a window must not (recomputing on
  // every refresh would make the axes jump around).
  // Cache reads are included in the token-axis peak so the new series does
  // not overflow the existing tokens axis.
  const peaksRef = useRef<{ cost: number; tokens: number } | null>(null);
  // Latest requested window — lets a slow response for an older window be
  // discarded when the user switches 30 → 7 → 90 quickly.
  const requestedDaysRef = useRef(days);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current, "dark");
    // ResizeObserver beats window-resize: tracks the container even when the
    // grid reflows (mobile column collapse, diagnostics opening, etc).
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chartRef.current?.dispose(); // must dispose to avoid instance leaks
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    requestedDaysRef.current = days;
    peaksRef.current = null; // deliberate window change → rescale axes
    // No skeleton here: the previous window's data stays visible until the
    // new window's points arrive, which reads better than flashing.
  }, [days]);

  useEffect(() => {
    let disposed = false;
    void loadTrend(days).then((points) => {
      if (disposed || !chartRef.current || requestedDaysRef.current !== days) return;
      const dates = points.map((p) => p.date);
      const fmtDay = (d: string) => {
        const [y, m, day] = d.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, day));
        return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      };
      // Anchor each y-axis to a fixed [0, peak] range from the FIRST dataset
      // observed — never recomputed on filter changes (the line shape should
      // adjust, but the scale shouldn't jump).
      if (peaksRef.current === null) {
        const costPeak = points.reduce((m, p) => Math.max(m, p.cost ?? 0), 0);
        const tokensPeak = points.reduce((m, p) => Math.max(m, p.tokens ?? 0, p.cacheRead ?? 0), 0);
        peaksRef.current = {
          cost: Math.max(1, niceCeil(costPeak)),
          tokens: Math.max(1, niceCeil(tokensPeak)),
        };
      }
      const yMaxCost = peaksRef.current.cost;
      const yMaxTokens = peaksRef.current.tokens;
      // On legend toggle, keep both axes visible and re-anchor their [min,max]
      // to the full-dataset peak so the surviving series has its full context
      // — no auto-rescale to the remaining (smaller) data.
      const onLegendToggle = () => {
        // Persist which series are on so the choice survives reloads
        // (issue: "sorting and filtering settings should remember").
        try {
          const legendOpt = chartRef.current?.getOption().legend as Array<{ selected?: Record<string, boolean> }> | undefined;
          localStorage.setItem(LEGEND_STORAGE_KEY, JSON.stringify(legendOpt?.[0]?.selected ?? {}));
        } catch {
          /* storage unavailable — toggling still works this session */
        }
        chartRef.current?.setOption(
          {
            yAxis: [
              { min: 0, max: yMaxCost },
              { min: 0, max: yMaxTokens },
            ],
          },
          { lazyUpdate: true }
        );
      };
      // ECharts 5 indexes the top-level palette (not series.lineStyle.color)
      // for legend swatches, so this order MUST match the series array order.
      const SERIES_COLORS = ["#38bdf8", "#facc15", "#4ade80"] as const;
      const series: echarts.EChartsOption = {
        animation: true,
        animationDuration: 700,
        animationEasing: "cubicOut",
        backgroundColor: "transparent",
        color: [...SERIES_COLORS],
        grid: { left: 8, right: 8, top: 48, bottom: 28, containLabel: true },
        tooltip: {
          trigger: "axis",
          ...touchAwareTooltip(),
          confine: true,
          backgroundColor: "rgba(17, 19, 24, 0.96)",
          borderColor: "#232732",
          borderWidth: 1,
          padding: [10, 12],
          textStyle: { color: "#94a3b8", fontSize: 12 },
          axisPointer: { lineStyle: { color: "#2c3038" } },
          formatter: (params: unknown) => {
            const arr = params as Array<{ axisValue: string; seriesName: string; value: number | null; marker: string }>;
            if (!arr.length) return "";
            const [y, m, day] = arr[0].axisValue.split("-").map(Number);
            const full = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
              weekday: "long", day: "numeric", month: "long", year: "numeric",
            });
            const rows = arr
              .filter((p) => p.value !== null)
              .map((p) => `${p.marker} ${p.seriesName}: <b style="color:#e2e8f0">${p.seriesName.startsWith("Cost") ? formatCost(p.value as number) : formatCompact(p.value as number)}</b>`);
            return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${full}</div>${rows.join("<br/>")}`;
          },
        },
        xAxis: {
          type: "category",
          // boundaryGap defaults to true for category axes, which insets the
          // first and last points by half a band on each side. That half-band
          // slack is the trailing whitespace at the latest date — set it false
          // so the line's first/last points sit flush to both plot edges.
          boundaryGap: false,
          data: dates,
          axisLabel: { color: "#64748b", fontSize: 10, formatter: fmtDay },
          axisLine: { lineStyle: { color: "#232732" } },
          axisTick: { show: false },
        },
        yAxis: [
          {
            type: "value",
            min: 0,
            max: yMaxCost,
            axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `$${Math.round(v)}` },
            splitLine: { lineStyle: { color: "rgba(35, 39, 50, 0.6)" } },
          },
          {
            type: "value",
            min: 0,
            max: yMaxTokens,
            axisLabel: {
              color: "#64748b",
              fontSize: 10,
              formatter: (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v),
            },
            splitLine: { show: false },
          },
        ],
        legend: {
          data: ["Cost ($)", "Tokens", "Cache read"],
          // Restore the operator's last legend toggles (persisted in
          // onLegendToggle). Unknown/absent keys default to visible.
          selected: readLegendSelection(LEGEND_STORAGE_KEY),
          orient: "horizontal",
          top: 0,
          right: 8,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          itemGap: 18,
          textStyle: { color: "#94a3b8", fontSize: 11 },
        },
        // Media queries: on narrow screens, shrink the label gutters so the
        // dual-axis plot keeps as much width as possible (ECharts responsive
        // pattern — see handbook "Responsive Mobile-End").
        media: [
          {
            query: { maxWidth: 480 },
            option: {
              grid: { left: 8, right: 8, top: 48, bottom: 28, containLabel: true },
              legend: { textStyle: { fontSize: 10 } },
            },
          },
        ],
        series: [
          {
            name: "Cost ($)",
            type: "line",
            data: points.map((p) => (p.cost === null ? null : Number(p.cost.toFixed(2)))),
            smooth: 0.3,
            showSymbol: false,
            lineStyle: { color: SERIES_COLORS[0], width: 2 },
            areaStyle: { color: "rgba(56, 189, 248, 0.12)" },
          },
          {
            name: "Tokens",
            type: "line",
            yAxisIndex: 1,
            data: points.map((p) => p.tokens),
            smooth: 0.3,
            showSymbol: false,
            lineStyle: { color: SERIES_COLORS[1], width: 2 },
            areaStyle: { color: "rgba(250, 204, 21, 0.08)" },
          },
          {
            name: "Cache read",
            type: "line",
            yAxisIndex: 1,
            data: points.map((p) => p.cacheRead),
            smooth: 0.3,
            showSymbol: false,
            lineStyle: { color: SERIES_COLORS[2], width: 2 },
            areaStyle: { color: "rgba(74, 222, 128, 0.08)" },
          },
        ],
      };
      chartRef.current?.setOption(series, true);
      chartRef.current?.on("legendselectchanged", onLegendToggle);
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [days]);

  return (
    <div style={{ marginTop: 16, marginLeft: "-1%", marginRight: "-1%" }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8, paddingLeft: "1%", paddingRight: "1%" }}>Daily cost &amp; tokens</div>
      {loading && <div className="skeleton" style={{ height: 220 }} />}
      <div ref={ref} style={{ width: "98%", margin: "0 auto", height: 220 }} aria-label="Daily cost and token trend chart" />
    </div>
  );
}

type SortKey = "model" | "sessions" | "tokens" | "cost" | "cachePct" | "eff" | null;
type SortState = { key: SortKey; asc: boolean };

/** Mini daily cost+tokens chart for ONE model, shown inside the expanded
 *  by-model row. Deliberately the main DailyUsageChart's visual language at
 *  reduced size: same palette (#38bdf8 cost / #facc15 tokens), same smooth
 *  lines with flush edges (boundaryGap: false), same tooltip shell, same
 *  peak-anchoring rule (niceCeil once per open).
 *
 *  Series: this model's cost (left axis) + this model's tokens (right
 *  axis) + BOTH window totals as dotted comparison lines — all-models
 *  tokens on the token axis, all-models cost on the cost axis. Visual
 *  grammar: SOLID = this model, DOTTED = all models, HUE = metric
 *  (blue cost / yellow tokens), so each dotted line is directly
 *  comparable to its solid sibling on a shared axis. For tokens the
 *  model line is a subset of the total (dotted always at-or-above
 *  yellow). For cost the total dwarfs the model at 30d scale (8.6x at
 *  current peaks) — the model line hugging the floor IS the truth, and
 *  the operator explicitly chose this after seeing both (2026-08-26):
 *  "the graph will give a better representation of the model vs the
 *  totals on both aspects". */
function ModelRowDetail({ modelKey, modelLabel }: { modelKey: string; modelLabel: string }) {
  const days = useDash((s) => s.days);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // Loading is derived, not stored: results for the CURRENT (days, key) pair.
  // A window switch renders the previous result as stale until the new one
  // lands (undefined for this pair = skeleton), so no setState-in-effect.
  // The model trend and the all-models comparison land together (single
  // Promise.all) so the chart initialises once, with both scales known.
  const [loaded, setLoaded] = useState<Array<{ windowDays: WindowDays; key: string; points: ModelTrendPoint[]; overall: TrendPoint[] }>>([]);
  const entry = loaded.find((e) => e.windowDays === days && e.key === modelKey);
  const points = entry?.points;
  const overall = entry?.overall;

  useEffect(() => {
    if (entry) return; // already have this window's data
    let disposed = false;
    void Promise.all([loadModelTrend(days, modelKey), loadTrend(days)]).then(([pts, allPts]) => {
      if (!disposed) setLoaded((prev) => [...prev, { windowDays: days, key: modelKey, points: pts, overall: allPts }]);
    });
    return () => {
      disposed = true;
    };
  }, [days, modelKey, entry]);

  useEffect(() => {
    if (!ref.current || !points || points.length === 0 || !overall) return;
    const pts = points;
    // Window totals per day (cost + tokens), aligned to the model series'
    // x-axis. Both dotted comparisons read against their solid sibling.
    const totalTokensByDate = new Map(overall.map((p) => [p.date, p.tokens]));
    const totalCostByDate = new Map(overall.map((p) => [p.date, p.cost]));
    const totalTokensSeries = pts.map((p) => totalTokensByDate.get(p.date) ?? null);
    const totalCostSeries = pts.map((p) => {
      const c = totalCostByDate.get(p.date);
      return c === undefined || c === null ? null : Number(c.toFixed(2));
    });
    chartRef.current = echarts.init(ref.current, "dark");
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(ref.current);
    const dates = pts.map((p) => p.date);
    const fmtDay = (d: string) => {
      const [y, m, day] = d.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    };
    // Same peak-anchor contract as the main chart: computed once per mount,
    // never rescaled by polls within the same open. Each axis peak is the
    // max of (model, all-models) so the dotted total always fits.
    const costPeak = Math.max(
      1,
      niceCeil(pts.reduce((m, p) => Math.max(m, p.cost ?? 0), 0)),
      niceCeil(totalCostSeries.reduce((m: number, v: number | null) => Math.max(m, v ?? 0), 0)),
    );
    const tokenPeak = Math.max(
      1,
      niceCeil(pts.reduce((m, p) => Math.max(m, p.tokens ?? 0), 0)),
      niceCeil(totalTokensSeries.reduce((m: number, v: number | null) => Math.max(m, v ?? 0), 0)),
    );
    const option: echarts.EChartsOption = {
      animationDuration: 400,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      // Top-level palette indexes by series order — ECharts uses THESE for
      // the tooltip markers. Both dotted totals stay grey (#94a3b8) per
      // operator preference; hue stays owned by the solid model lines.
      color: ["#94a3b8", "#94a3b8", "#38bdf8", "#facc15"],
      grid: { left: 2, right: 2, top: 14, bottom: 22, containLabel: true },
      tooltip: {
        trigger: "axis",
        ...touchAwareTooltip(),
        confine: true,
        backgroundColor: "rgba(17, 19, 24, 0.96)",
        borderColor: "#232732",
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: "#94a3b8", fontSize: 11 },
        axisPointer: { lineStyle: { color: "#2c3038" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; seriesName: string; value: number | null; marker: string }>;
          if (!arr.length) return "";
          const [y, m, day] = arr[0].axisValue.split("-").map(Number);
          const full = new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
            weekday: "short", day: "numeric", month: "long",
          });
          const rows = arr
            .filter((p) => p.value !== null)
            // Model's numbers first, dotted totals after as context.
            .sort((a, b) => (a.seriesName.startsWith("All models") ? 1 : b.seriesName.startsWith("All models") ? -1 : 0))
            .map((p) => `${p.marker} ${p.seriesName}: <b style="color:#e2e8f0">${p.seriesName.includes("Cost") ? formatCost(p.value as number) : formatCompact(p.value as number)}</b>`);
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${full}</div>${rows.join("<br/>")}`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 9, formatter: fmtDay },
        axisLine: { lineStyle: { color: "#232732" } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          max: costPeak,
          axisLabel: { color: "#64748b", fontSize: 9, formatter: (v: number) => `$${Math.round(v * 100) / 100}` },
          splitLine: { lineStyle: { color: "rgba(35, 39, 50, 0.6)" } },
        },
        {
          type: "value",
          min: 0,
          max: tokenPeak,
          axisLabel: {
            color: "#64748b",
            fontSize: 9,
            formatter: (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        // Dotted totals FIRST in the array (z-painting: earlier series
        // paint below) so the model's own solid lines stay on top.
        // Grammar: dotted + metric hue = all-models total for that metric,
        // always on the same axis as its solid sibling.
        {
          name: "All models cost",
          type: "line",
          data: totalCostSeries,
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: "#94a3b8", width: 1.5, type: [2, 4] },
          emphasis: { lineStyle: { width: 1.5 } },
        },
        {
          name: "All models tokens",
          type: "line",
          yAxisIndex: 1,
          data: totalTokensSeries,
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: "#94a3b8", width: 1.5, type: [2, 4] },
          emphasis: { lineStyle: { width: 1.5 } },
        },
        {
          name: "Cost ($)",
          type: "line",
          data: pts.map((p) => (p.cost === null ? null : Number(p.cost.toFixed(2)))),
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: "#38bdf8", width: 2 },
          areaStyle: { color: "rgba(56, 189, 248, 0.12)" },
        },
        {
          name: "Tokens",
          type: "line",
          yAxisIndex: 1,
          data: pts.map((p) => p.tokens),
          smooth: 0.3,
          showSymbol: false,
          lineStyle: { color: "#facc15", width: 2 },
          areaStyle: { color: "rgba(250, 204, 21, 0.08)" },
        },
      ],
    };
    chartRef.current.setOption(option, true);
    return () => {
      ro.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [points]);

  return (
    <div className="model-row__detail-trend">
      <div className="model-row__detail-trend-head">
        <span className="model-row__detail-label">{modelLabel} · daily trend</span>
        <span className="model-row__detail-caption">
          <span className="model-row__legend-dot model-row__legend-dot--cost" aria-hidden="true" /> cost
          <span className="model-row__legend-dot model-row__legend-dot--tokens" aria-hidden="true" /> tokens
          <span className="model-row__legend-dot model-row__legend-dot--overall-cost" aria-hidden="true" /> all cost
          <span className="model-row__legend-dot model-row__legend-dot--overall" aria-hidden="true" /> all tokens
        </span>
      </div>
      {points === undefined ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : points.length === 0 ? (
        <p className="state-label">No daily history for this model in the selected window</p>
      ) : (
        <div ref={ref} style={{ width: "100%", height: 130 }} aria-label={`Daily spend trend for ${modelLabel}`} />
      )}
    </div>
  );
}


/**
 * Default by-model order: sessions descending (2026-08-24 operator
 * preference — readable at-a-glance and the most direct "which model
 * is being used" signal; tokens/cost can be sorted via the pill strip).
 * The storage key is versioned per default — bumping it makes a new
 * default apply ONCE to browsers that already stored the old one,
 * without stomping an explicitly chosen sort afterwards.
 */
const DEFAULT_SORT: SortState = { key: "sessions", asc: false };
const SORT_STORAGE_KEY = "signal-house:agent-spend-sort:cachePct:v3-sessions-desc";

function readSortState(): SortState {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SortState;
      if (parsed && (parsed.key === null || ["model", "sessions", "tokens", "cost", "cachePct", "eff"].includes(parsed.key)) && typeof parsed.asc === "boolean") {
        return { key: parsed.key, asc: parsed.asc };
      }
    }
  } catch {
    /* storage unavailable or corrupt — fall through to default */
  }
  return DEFAULT_SORT;
}

/** By-model table spanning all sources; unknown cost renders "—".
 *  Default order: tokens descending. Click a column header to sort:
 *  sessions/tokens/cost sort descending, model sorts alphabetically.
 *  Clicking the active column again cycles (desc → asc → back to the
 *  tokens-descending default). Sort state persists across page loads
 *  via localStorage. */
function ModelTable() {
  const { state } = useDash();
  const usage = state?.usage ?? null;
  const models = usage?.byModel ?? [];
  const [sort, setSort] = useState<SortState>(readSortState);
  const { key: sortKey, asc } = sort;
  // Mobile-only expand state: clicking a row toggles a detail panel below
  // it showing the full breakdown (Cache %, $/1M + the cost-efficiency
  // breakdown). Single-expand: tapping a different row collapses the
  // previous one. Desktop hides the chevron + detail via @media <640px.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Persist every change; survives reloads (and the default is a no-op).
  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
    } catch {
      /* storage unavailable — sorting still works for this session */
    }
  }, [sort]);

  const sorted = [...models];
  if (sortKey) {
    sorted.sort((a, b) => {
      if (sortKey === "model") {
        return asc ? b.model.localeCompare(a.model) : a.model.localeCompare(b.model);
      }
      if (sortKey === "cachePct") {
        const av = a.cacheHitRate ?? 0;
        const bv = b.cacheHitRate ?? 0;
        return asc ? av - bv : bv - av;
      }
      if (sortKey === "eff") {
        // Cheapest-first ascending; null ratios (no telemetry / free / tiny
        // sample) always sink to the bottom regardless of direction.
        const av = a.effPerM ?? null;
        const bv = b.effPerM ?? null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return asc ? av - bv : bv - av;
      }
      const genericKey = (["sessions", "tokens", "cost"].includes(sortKey) ? sortKey : "cost") as "sessions" | "tokens" | "cost";
      const av = a[genericKey] ?? -1;
      const bv = b[genericKey] ?? -1;
      return asc ? av - bv : bv - av;
    });
  }

  const cycle = (key: Exclude<SortKey, null>) => {
    if (sortKey !== key) {
      // Efficiency reads best cheapest-first: $0.02 Flash before $1.58 GLM.
      // Other columns default to $/count descending; eff flips the default.
      setSort({ key, asc: key === "eff" });
    } else if (sortKey === key && asc === (key === "eff")) {
      // Clicking the active column on its DEFAULT direction flips it:
      // eff asc→desc, other columns desc→asc. The third click resets.
      setSort({ key, asc: !asc });
    } else {
      setSort({ ...DEFAULT_SORT }); // back to the default tokens-descending order
    }
  };

  const arrow = (key: Exclude<SortKey, null>) =>
    sortKey === key ? <span className="sort-arrow">{asc ? "↑" : "↓"}</span> : null;

  const sortBtnClass = (key: Exclude<SortKey, null>) =>
    `sort-btn${sortKey === key ? " is-active" : ""}`;

  return (
    <div className="model-table" style={{ marginTop: 16 }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8 }}>By model</div>
      {models.length === 0 ? (
        <p className="state-label">No model-level data available</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th><button type="button" className={sortBtnClass("model")} onClick={() => cycle("model")}>Model{arrow("model")}</button></th>
              <th className="num"><button type="button" className={sortBtnClass("sessions")} onClick={() => cycle("sessions")}>Sessions{arrow("sessions")}</button></th>
              <th className="num"><button type="button" className={sortBtnClass("tokens")} onClick={() => cycle("tokens")}>Tokens{arrow("tokens")}</button></th>
              <th className="num"><button type="button" className={sortBtnClass("cost")} onClick={() => cycle("cost")}>Cost{arrow("cost")}</button></th>
              <th className="num"><button type="button" className={sortBtnClass("cachePct")} onClick={() => cycle("cachePct")}>Cache %{arrow("cachePct")}</button></th>
              <th className="num"><button type="button" className={sortBtnClass("eff")} onClick={() => cycle("eff")}>$/1M{arrow("eff")}</button></th>
              {/* Chevron column header — empty cell on desktop (hidden by css); mobile shows the chevron col header carrying aria-sort="none" semantically. We don't render a visible <th> at desktop because the column is collapsed — but at mobile the chevron is the affordance hint, no header is needed. Hidden via css. */}
              <th className="model-row__chevron-cell" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const rowKey = m.model;
              const isExpanded = expandedKey === rowKey;
              return (
              <Fragment key={rowKey}>
                <tr
                  className={`model-row${isExpanded ? " model-row--expanded" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={`model-row-detail-${rowKey}`}
                  onClick={() => setExpandedKey(isExpanded ? null : rowKey)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedKey(isExpanded ? null : rowKey);
                    }
                  }}
                >
                  <td className="model-name-cell">
                    <span className="model-name">{m.model}</span>
                    {m.family && m.family !== m.model && (
                      <span className="model-family">{m.family}</span>
                    )}
                  </td>
                  <td className={`num${sortKey === "sessions" || sortKey === "model" || sortKey === null ? " model-row__stat-primary" : ""}`} data-label="Sessions">{formatNumber(m.sessions)}</td>
                  <td className={`num${sortKey === "tokens" ? " model-row__stat-primary" : ""}`} data-label="Tokens">{formatCompact(m.tokens ?? 0)}</td>
                  <td className={`num${sortKey === "cost" ? " model-row__stat-primary" : ""}`} data-label="Cost">{m.costSource === "unknown" ? "—" : formatCost(m.cost)}</td>
                  <td className={`num model-row__cache${sortKey === "cachePct" ? " model-row__stat-primary" : ""}`} data-label="Cache %">{formatPercent(m.cacheHitRate ?? 0)}</td>
                  <td className={`num eff-cell model-row__eff${sortKey === "eff" ? " model-row__stat-primary" : ""}`} data-label="$/1M">{m.costSource === "unknown" ? "—" : m.effPerM != null ? formatEffPerM(m.effPerM) : "—"}</td>
                  {/* Chevron column — desktop hides it via css; mobile shows it as the affordance hint. */}
                  <td className="model-row__chevron-cell" aria-hidden="true">
                    <span className="model-row__chevron">▾</span>
                  </td>
                </tr>
                {isExpanded && (
                  <tr
                    id={`model-row-detail-${rowKey}`}
                    className="model-row__detail"
                    role="region"
                    aria-label={`Details for ${m.model}`}
                  >
                    <td colSpan={7}>
                      {typeof m.machineKey === "string" && m.machineKey !== "" ? (
                        <ModelRowDetail modelKey={m.machineKey} modelLabel={m.model} />
                      ) : null}
                      <div className="model-row__detail-grid">
                        <div className="model-row__detail-stat">
                          <span className="model-row__detail-label">Sessions</span>
                          <span className="model-row__detail-value">{formatNumber(m.sessions)}</span>
                        </div>
                        <div className="model-row__detail-stat">
                          <span className="model-row__detail-label">Tokens</span>
                          <span className="model-row__detail-value">{formatCompact(m.tokens ?? 0)}</span>
                        </div>
                        <div className="model-row__detail-stat">
                          <span className="model-row__detail-label">Cost</span>
                          <span className="model-row__detail-value">{m.costSource === "unknown" ? "—" : formatCost(m.cost)}</span>
                        </div>
                        <div className="model-row__detail-stat">
                          <span className="model-row__detail-label">Cache %</span>
                          <span className="model-row__detail-value">{formatPercent(m.cacheHitRate ?? 0)}</span>
                        </div>
                        <div className="model-row__detail-stat model-row__detail-stat--eff">
                          <span className="model-row__detail-label">$/1M</span>
                          <span className="model-row__detail-value eff-cell">{m.costSource === "unknown" ? "—" : m.effPerM != null ? formatEffPerM(m.effPerM) : "—"}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
