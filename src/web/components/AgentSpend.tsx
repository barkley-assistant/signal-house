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
          <div className="big-number">{formatCost(usage.totalCost)}</div>
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

/** Stacked/area daily cost trend read from /api/daily/spend. */
function DailyUsageChart() {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ref.current) return;
    chartRef.current = echarts.init(ref.current, "dark");
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chartRef.current?.dispose(); // must dispose to avoid instance leaks
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadTrend().then((points) => {
      if (disposed || !chartRef.current) return;
      const dates = points.map((p) => p.date);
      const series: echarts.EChartsOption = {
        animation: false,
        grid: { left: 48, right: 12, top: 16, bottom: 24 },
        tooltip: { trigger: "axis" },
        xAxis: { type: "category", data: dates, axisLabel: { color: "#64748b", fontSize: 10 } },
        yAxis: { type: "value", axisLabel: { color: "#64748b", fontSize: 10 }, splitLine: { lineStyle: { color: "#1e2128" } } },
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
        ],
      };
      chartRef.current?.setOption(series, true);
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, []);

  return (
    <div style={{ marginTop: 16 }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8 }}>Daily cost</div>
      {loading && <div className="skeleton" style={{ height: 220 }} />}
      <div ref={ref} style={{ width: "100%", height: 220 }} aria-label="Daily cost trend chart" />
    </div>
  );
}

/** By-model table spanning all sources; unknown cost renders "—". */
function ModelTable() {
  const { state } = useDash();
  const usage = state?.usage ?? null;
  const models = usage?.byModel ?? [];

  return (
    <div className="model-table" style={{ marginTop: 16 }}>
      <div className="kpi-tile__label" style={{ marginBottom: 8 }}>By model</div>
      {models.length === 0 ? (
        <p className="state-label">No model-level data available</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Model</th>
              <th className="num">Sessions</th>
              <th className="num">Tokens</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={`${m.provider ?? ""}/${m.model}`}>
                <td>
                  {m.model}
                  {m.provider && <span className="kpi-caption"> · {m.provider}</span>}
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
