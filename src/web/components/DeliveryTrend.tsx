/**
 * Delivery panel — CI pass-rate (filled line, 0–100%) paired with a Throughput
 * stacked bar (commits + PRs merged). Two ECharts instances sit side-by-side
 * on tablet/desktop and stack vertically on phones (<=700px). Styling
 * mirrors the Daily cost & tokens chart: same dark background, same muted
 * split lines, same tooltip shell, same 11px legend.
 *
 * Missing-day treatment:
 *  - CI null (no terminal runs) → line is broken (connectNulls: false). The
 *    tooltip surfaces "No CI runs" for those days.
 *  - Commits / PRs null (no telemetry that day) → ECharts bars with null
 *    values render as a clean gap. The tooltip says "No telemetry" and
 *    names which series is missing when only one is.
 */
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDash, loadDeliveryTrend, type DeliveryPoint } from "../state/store";
import { formatNumber } from "../../shared/format";

// Same accent palette as the Daily cost & tokens chart so the panels feel
// like siblings, not strangers.
const CI_COLOR = "#4ade80"; // var(--success) — green
const COMMITS_COLOR = "#94a3b8"; // var(--text-secondary) — slate
const PR_COLOR = "#38bdf8"; // var(--info) — blue

const TOP_HEIGHT = 220;
const BOTTOM_HEIGHT = 220;
const GRID_LEFT = 44;
const GRID_RIGHT = 16;

function fmtDayShort(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function fmtDayFull(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function niceCeil(v: number): number {
  if (v <= 0) return 4;
  const withHead = v * 1.2;
  const mag = Math.pow(10, Math.floor(Math.log10(withHead)));
  return Math.ceil(withHead / mag) * mag;
}

const COMMON_TOOLTIP = {
  trigger: "axis" as const,
  confine: true,
  backgroundColor: "rgba(17, 19, 24, 0.96)",
  borderColor: "#232732",
  borderWidth: 1,
  padding: [10, 12] as [number, number],
  textStyle: { color: "#94a3b8", fontSize: 12 },
};

export function DeliveryTrend() {
  const ciRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const ciChartRef = useRef<echarts.ECharts | null>(null);
  const barChartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(true);
  const days = useDash((s) => s.days);

  useEffect(() => {
    if (!ciRef.current || !barRef.current) return;
    ciChartRef.current = echarts.init(ciRef.current, "dark");
    barChartRef.current = echarts.init(barRef.current, "dark");
    const ro = new ResizeObserver(() => {
      ciChartRef.current?.resize();
      barChartRef.current?.resize();
    });
    ro.observe(ciRef.current);
    ro.observe(barRef.current);
    return () => {
      ro.disconnect();
      ciChartRef.current?.dispose();
      barChartRef.current?.dispose();
      ciChartRef.current = null;
      barChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void loadDeliveryTrend(days).then((points) => {
      if (disposed || !ciChartRef.current || !barChartRef.current) return;
      if (points.length === 0) {
        setHasData(false);
        setLoading(false);
        return;
      }
      setHasData(true);
      renderCi(ciChartRef.current, points);
      renderBar(barChartRef.current, points);
      setLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [days]);

  return (
    <section className="card delivery-card" aria-label="Delivery — CI health and shipping activity">
      <h2>Delivery</h2>
      {!hasData && !loading ? (
        <p className="state-label">No delivery data yet — GitHub collector unavailable or no runs in window</p>
      ) : (
        <div className="delivery-grid" style={{ visibility: loading ? "hidden" : "visible" }}>
          <div ref={ciRef} className="delivery-chart" style={{ height: TOP_HEIGHT }} aria-label="CI pass-rate trend" />
          <div ref={barRef} className="delivery-chart" style={{ height: BOTTOM_HEIGHT }} aria-label="Throughput — commits and PRs merged per day" />
        </div>
      )}
      {loading && <div className="skeleton" style={{ height: TOP_HEIGHT, marginTop: 8 }} />}
    </section>
  );
}

function renderCi(chart: echarts.ECharts, points: DeliveryPoint[]): void {
  const dates = points.map((p) => p.date);
  // Pass-rate as a percentage 0–100. null for days with no terminal runs so
  // the line cleanly breaks (connectNulls: false below) and the area fill
  // doesn't trail across the gap.
  const seriesData: Array<number | null> = points.map((p) =>
    p.ci ? Math.round((p.ci.passRate ?? 0) * 1000) / 10 : null,
  );
  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: 18, bottom: 22, containLabel: false },
      tooltip: {
        ...COMMON_TOOLTIP,
        axisPointer: { type: "line", lineStyle: { color: "#2c3038" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; value: number | null }>;
          if (!arr.length) return "";
          const p = points.find((q) => q.date === arr[0].axisValue);
          if (!p || !p.ci) {
            return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div><div style="color:#64748b;font-style:italic">No CI runs</div>`;
          }
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div>
            <div><span style="color:${CI_COLOR}">●</span> CI pass-rate: <b style="color:#e2e8f0">${(p.ci.passRate! * 100).toFixed(0)}%</b></div>
            <div style="color:#64748b">${formatNumber(p.ci.passCount)} pass · ${formatNumber(p.ci.failCount)} fail · ${formatNumber(p.ci.totalRuns)} total</div>`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: fmtDayShort, interval: "auto", hideOverlap: true },
        axisLine: { lineStyle: { color: "#232732" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => `${v}%`, interval: 24 },
        splitLine: { lineStyle: { color: "rgba(35, 39, 50, 0.6)" } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "line",
          data: seriesData,
          smooth: 0.3,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { color: CI_COLOR, width: 2 },
          areaStyle: { color: "rgba(74, 222, 128, 0.16)" },
          // Mark the worst-dip day in the window with a small red dot so a
          // glance surfaces the day CI was the worst. Suppressed when every
          // day is >= 95% so it doesn't shout at a green week.
          markPoint: computeWorstDip(seriesData, dates),
        },
      ],
    },
    true
  );
}

function computeWorstDip(
  seriesData: Array<number | null>,
  dates: string[]
): echarts.MarkPointComponentOption | undefined {
  let worstIdx = -1;
  let worstVal = Infinity;
  seriesData.forEach((v, i) => {
    if (v !== null && v < worstVal) {
      worstVal = v;
      worstIdx = i;
    }
  });
  if (worstIdx === -1 || worstVal >= 95) return undefined;
  return {
    symbol: "circle",
    symbolSize: 7,
    itemStyle: { color: "#f87171" },
    label: { show: false },
    data: [{ coord: [dates[worstIdx], worstVal] }],
  };
}

function renderBar(chart: echarts.ECharts, points: DeliveryPoint[]): void {
  const dates = points.map((p) => p.date);
  // ECharts: null in a bar series = no bar at that index. The legend still
  // shows "Commits" + "PRs merged" and the tooltip handles the per-day case.
  const commits = points.map((p) => p.commits);
  const prs = points.map((p) => p.prsMerged);
  const barMax = Math.max(
    4,
    ...commits.filter((v): v is number => v !== null),
    ...prs.filter((v): v is number => v !== null),
  );
  const yMax = niceCeil(barMax);
  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: 28, bottom: 22, containLabel: false },
      tooltip: {
        ...COMMON_TOOLTIP,
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(56, 189, 248, 0.06)" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; seriesName: string; value: number | null; marker: string }>;
          if (!arr.length) return "";
          const p = points.find((q) => q.date === arr[0].axisValue);
          if (!p) return "";
          const visible = arr.filter((row) => row.value !== null);
          const missing = arr
            .filter((row) => row.value === null)
            .map((row) => row.seriesName);
          const rowsHtml =
            visible.length > 0
              ? visible.map((row) => `${row.marker} ${row.seriesName}: <b style="color:#e2e8f0">${formatNumber(row.value as number)}</b>`).join("<br/>")
              : `<div style="color:#64748b;font-style:italic">No telemetry</div>`;
          const extras =
            visible.length > 0 && missing.length > 0
              ? `<div style="margin-top:4px;color:#64748b;font-size:11px">${missing.join(" · ")}: no telemetry</div>`
              : "";
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div>${rowsHtml}${extras}`;
        },
      },
      legend: {
        data: ["Commits", "PRs merged"],
        orient: "horizontal",
        top: 0,
        right: 8,
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: "#94a3b8", fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: fmtDayShort, interval: "auto", hideOverlap: true },
        axisLine: { lineStyle: { color: "#232732" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: (v: number) => (v === 0 ? "0" : formatNumber(v)) },
        splitLine: { lineStyle: { color: "rgba(35, 39, 50, 0.6)" } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: "Commits",
          type: "bar",
          stack: "throughput",
          data: commits,
          itemStyle: { color: COMMITS_COLOR, borderRadius: [0, 0, 0, 0] },
          barMaxWidth: 16,
        },
        {
          name: "PRs merged",
          type: "bar",
          stack: "throughput",
          data: prs,
          itemStyle: { color: PR_COLOR, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    },
    true
  );
}