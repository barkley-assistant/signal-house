/**
 * Agent Spend card — consolidated cost/tokens view (planning 03 §Card, decision #10).
 * Headline combined cost + OpenCode/Hermes sub-tiles + stacked daily chart + by-model table.
 * Sources without cost telemetry render "—", never 0.
 */

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDash, loadTrend } from "../state/store";
import { formatNumber, formatCost, formatCompact } from "../../shared/format";

export function AgentSpend() {
  const { state } = useDash();
  const usage = state?.usage ?? null;

  return (
    <section className="card" aria-label="Agent spend">
      <h2>Agent Spend</h2>
      {!usage || usage.totalSessions === 0 && !usage.totalTokens && !usage.totalCost ? (
        <p className="state-label">No usage telemetry yet — sources unavailable or no sessions collected</p>
      ) : (
        <>
          <div className="big-number total">{formatCost(usage.totalCost)}</div>
          <div className="kpi-caption">Total cost · {formatNumber(usage.totalSessions)} sessions · {formatCompact(usage.totalTokens ?? 0)} tokens</div>
          <div className="spend-subtiles">
            <SpendSource label="OpenCode" source="opencode" usage={usage} />
            <SpendSource label="Hermes" source="hermes" usage={usage} />
            <SpendCombined usage={usage} />
          </div>
          <DailyUsageChart />
          <ModelTable />
        </>
      )}
    </section>
  );
}

type UsageLike = NonNullable<ReturnType<typeof useDash.getState>["state"]>["usage"];

function SpendSource({ label, source, usage }: { label: string; source: string; usage: UsageLike }) {
  const src = usage?.bySource[source as keyof typeof usage.bySource];
  return (
    <div className="card spend-tile">
      <div className="kpi-tile__label heading">{label}</div>
      <div className="big-number small">{src ? formatCost(src.cost) : "—"}</div>
      <div className="kpi-caption">{src ? `${formatNumber(src.sessions)} sessions · ${formatCompact(src.tokens ?? 0)} tokens` : "No data"}</div>
    </div>
  );
}

function SpendCombined({ usage }: { usage: UsageLike }) {
  return (
    <div className="card spend-tile">
      <div className="kpi-tile__label heading">Combined</div>
      <div className="big-number small">{formatCost(usage?.totalCost)}</div>
      <div className="kpi-caption">{formatNumber(usage?.totalSessions ?? 0)} sessions across sources</div>
    </div>
  );
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
  // Axis peaks are computed once on first data load and frozen — they
  // define the chart's y-scale. Recomputing them on every filter change
  // would rescale the axes to the filtered subset, which is jarring.
  const peaksRef = useRef<{ cost: number; tokens: number } | null>(null);

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
    let disposed = false;
    void loadTrend().then((points) => {
      if (disposed || !chartRef.current) return;
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
        const tokensPeak = points.reduce((m, p) => Math.max(m, p.tokens ?? 0), 0);
        // Round up to a "nice" number with 20% headroom so the top label
        // and the top of the line don't collide.
        const niceCeil = (v: number) => {
          if (v <= 0) return 1;
          const withHead = v * 1.2;
          const mag = Math.pow(10, Math.floor(Math.log10(withHead)));
          return Math.ceil(withHead / mag) * mag;
        };
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
      const series: echarts.EChartsOption = {
        animation: true,
        animationDuration: 700,
        animationEasing: "cubicOut",
        backgroundColor: "transparent",
        grid: { left: 8, right: 8, top: 48, bottom: 28, containLabel: true },
        tooltip: {
          trigger: "axis",
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
          data: ["Cost ($)", "Tokens"],
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
            lineStyle: { color: "#38bdf8", width: 2 },
            areaStyle: { color: "rgba(56, 189, 248, 0.12)" },
          },
          {
            name: "Tokens",
            type: "line",
            yAxisIndex: 1,
            data: points.map((p) => p.tokens),
            smooth: 0.3,
            showSymbol: false,
            lineStyle: { color: "#facc15", width: 2 },
            areaStyle: { color: "rgba(250, 204, 21, 0.08)" },
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
  }, []);

  return (
    <div style={{ marginTop: 16, marginLeft: "-1%", marginRight: "-1%" }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8, paddingLeft: "1%", paddingRight: "1%" }}>Daily cost &amp; tokens</div>
      {loading && <div className="skeleton" style={{ height: 220 }} />}
      <div ref={ref} style={{ width: "98%", margin: "0 auto", height: 220 }} aria-label="Daily cost and token trend chart" />
    </div>
  );
}

type SortKey = "model" | "sessions" | "tokens" | "cost" | null;
type SortState = { key: SortKey; asc: boolean };

const SORT_STORAGE_KEY = "signal-house:model-sort";

function readSortState(): SortState {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SortState;
      if (parsed && (parsed.key === null || ["model", "sessions", "tokens", "cost"].includes(parsed.key)) && typeof parsed.asc === "boolean") {
        return { key: parsed.key, asc: parsed.asc };
      }
    }
  } catch {
    /* storage unavailable or corrupt — fall through to default */
  }
  return { key: null, asc: false };
}

/** By-model table spanning all sources; unknown cost renders "—".
 *  Click a column header to sort: sessions/tokens/cost sort descending,
 *  model sorts alphabetically. Clicking the active column again cycles
 *  (desc → asc → back to default session order). Sort state persists
 *  across page loads via localStorage. */
function ModelTable() {
  const { state } = useDash();
  const usage = state?.usage ?? null;
  const models = usage?.byModel ?? [];
  const [sort, setSort] = useState<SortState>(readSortState);
  const { key: sortKey, asc } = sort;

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
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return asc ? av - bv : bv - av;
    });
  }

  const cycle = (key: Exclude<SortKey, null>) => {
    if (sortKey !== key) {
      setSort({ key, asc: false });
    } else if (!asc) {
      setSort({ key, asc: true });
    } else {
      setSort({ key: null, asc: false }); // back to default session order
    }
  };

  const arrow = (key: Exclude<SortKey, null>) =>
    sortKey === key ? <span className="sort-arrow">{asc ? "↑" : "↓"}</span> : null;

  return (
    <div className="model-table" style={{ marginTop: 16 }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8 }}>By model</div>
      {models.length === 0 ? (
        <p className="state-label">No model-level data available</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th><button type="button" className="sort-btn" onClick={() => cycle("model")}>Model{arrow("model")}</button></th>
              <th className="num"><button type="button" className="sort-btn" onClick={() => cycle("sessions")}>Sessions{arrow("sessions")}</button></th>
              <th className="num"><button type="button" className="sort-btn" onClick={() => cycle("tokens")}>Tokens{arrow("tokens")}</button></th>
              <th className="num"><button type="button" className="sort-btn" onClick={() => cycle("cost")}>Cost{arrow("cost")}</button></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr key={m.model}>
                <td>
                  <span className="model-name">{m.model}</span>
                  {m.family && m.family !== m.model && <span className="model-family">{m.family}</span>}
                </td>
                <td className="num">{formatNumber(m.sessions)}</td>
                <td className="num">{formatCompact(m.tokens ?? 0)}</td>
                <td className="num">{formatCost(m.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
