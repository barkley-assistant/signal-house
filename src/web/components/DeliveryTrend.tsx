/**
 * Delivery panel — CI pass-rate (filled line, 0–100%) stacked over a
 * Throughput bar (commits + PRs merged per day). Two ECharts instances share
 * one date x-axis: the line's x-axis labels are hidden, the bar shows them;
 * both grids are anchored to the same left/right paddings so dates line up
 * column-wise. Honors the 7/30/90-day window selector from the store and
 * `prefers-reduced-motion` (no entrance animation).
 */
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDash, loadDeliveryTrend, type DeliveryPoint } from "../state/store";
import { formatNumber } from "../../shared/format";

const CI_COLOR = "#4ade80"; // var(--success)
const COMMITS_COLOR = "#94a3b8"; // var(--text-secondary) — muted slate for the "background" stack
const PR_COLOR = "#38bdf8"; // var(--info) — accent for the meaningful shipping signal
const COMMITS_COLOR_Swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${COMMITS_COLOR};margin-right:4px"></span>`;
const PR_COLOR_Swatch = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PR_COLOR};margin-right:4px"></span>`;

<<<<<<< HEAD
const TOP_HEIGHT = 320;
const BOTTOM_HEIGHT = 320;
const GRID_LEFT = 56;
const GRID_RIGHT = 18;
=======
const TOP_HEIGHT = 220;
const BOTTOM_HEIGHT = 220;
const GRID_LEFT = 44;
const GRID_RIGHT = 16;
>>>>>>> 02e5bfb (fix(web): match Delivery chart height to daily cost chart (220px))

function fmtDay(d: string): string {
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

export function DeliveryTrend() {
  const ciRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const ciChartRef = useRef<echarts.ECharts | null>(null);
  const barChartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(true);
  const days = useDash((s) => s.days);

  // Init both charts once. ResizeObserver beats window-resize: tracks the
  // container even when the grid reflows (mobile column collapse, etc).
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
      <div className="delivery-card__head">
        <h2 className="delivery-card__title">Delivery</h2>
        <p className="delivery-card__subtitle">CI health and shipping activity</p>
      </div>
      {!hasData && !loading ? (
        <p className="state-label">No delivery data yet — GitHub collector unavailable or no runs in window</p>
      ) : (
        <>
          {loading && (
            <div className="skeleton" style={{ height: TOP_HEIGHT, marginTop: 8 }} />
          )}
          <div
            className="delivery-grid"
            style={{ visibility: loading ? "hidden" : "visible", marginTop: loading ? -1 - TOP_HEIGHT : 0 }}
          >
            <div className="delivery-grid__col">
              <div className="delivery-grid__col-label">CI pass-rate</div>
              <div
                ref={ciRef}
                className="delivery-chart delivery-chart--ci"
                style={{ height: TOP_HEIGHT }}
                aria-label="CI pass-rate trend"
              />
            </div>
            <div className="delivery-grid__col">
              <div className="delivery-grid__col-label">Throughput</div>
              <div
                ref={barRef}
                className="delivery-chart delivery-chart--bar"
                style={{ height: BOTTOM_HEIGHT }}
                aria-label="Throughput — commits and PRs merged per day"
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function renderCi(chart: echarts.ECharts, points: DeliveryPoint[]): void {
  const dates = points.map((p) => p.date);
  // CI peaks at 100% by definition; that's the y-axis ceiling.
  // Days with no terminal runs become null (rendered as a gap in the line).
  // We also lay a faint placeholder marker at the bottom of the gap so the
  // "no data" segment reads as intentional rather than a sudden drop.
  const seriesData: Array<number | null> = points.map((p) =>
    p.ci ? Math.round((p.ci.passRate ?? 0) * 1000) / 10 : null,
  );
  // Tiny invisible marker at the very bottom for null days, so the gap
  // visually anchors to the baseline instead of looking like the line was
  // wiped. The marker symbol is empty so nothing renders, but it occupies
  // the slot and prevents the surrounding bars/line from drifting.
  const placeholderData: Array<number | null> = points.map((p) =>
    p.ci === null ? 0.01 : null,
  );
  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: 18, bottom: 4, containLabel: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(17, 19, 24, 0.96)",
        borderColor: "#232732",
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: "#94a3b8", fontSize: 12 },
        axisPointer: { type: "line", lineStyle: { color: "#2c3038" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; value: number | null }>;
          if (!arr.length) return "";
          const p = points.find((q) => q.date === arr[0].axisValue);
          if (!p || !p.ci) {
            return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div><div style="color:#64748b;font-style:italic">No CI runs</div>`;
          }
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div>
            <div><span style="color:${CI_COLOR}">●</span> <span style="color:#e2e8f0">CI pass-rate</span>: <b style="color:#e2e8f0">${(p.ci.passRate! * 100).toFixed(0)}%</b></div>
            <div style="color:#64748b">${formatNumber(p.ci.passCount)} pass · ${formatNumber(p.ci.failCount)} fail · ${formatNumber(p.ci.totalRuns)} total</div>`;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: fmtDay, interval: "auto", hideOverlap: true },
        axisLine: { lineStyle: { color: "#232732" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          color: "#64748b",
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
          interval: 49,
        },
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
          markPoint: computeWorstDip(seriesData, dates),
          z: 2,
        },
        {
          // Invisible baseline anchor for null days. Renders a 0.01%-tall
          // bar at y=0 (the baseline) on no-data days only, so the gap
          // visually has a floor instead of looking like the line vanished.
          // Empty symbol + transparent color = effectively invisible.
          type: "line",
          data: placeholderData,
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          silent: true,
          z: 1,
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
    symbolSize: 6,
    itemStyle: { color: "#f87171" },
    label: { show: false },
    data: [{ coord: [dates[worstIdx], worstVal] }],
  };
}

function renderBar(chart: echarts.ECharts, points: DeliveryPoint[]): void {
  const dates = points.map((p) => p.date);
  // For stacked bars: ECharts treats a single null in a stack as "skip this
  // entire stack column" (one missing segment collapses the OTHER segment
  // too), which reads as a bug. We instead emit a tiny invisible 0 for null
  // segments so the surviving segment still renders — the gap is then read
  // from the surviving series's height, not from a missing column.
  const commits = points.map((p) => (p.commits === null ? 0 : p.commits));
  const prs = points.map((p) => (p.prsMerged === null ? 0 : p.prsMerged));
  // Track which days have any real data so the tooltip can label a
  // fully-empty day as "No telemetry" (vs. a day with only one segment).
  const hasAny = points.map(
    (p) => (p.commits ?? 0) > 0 || (p.prsMerged ?? 0) > 0,
  );
  const barMax = Math.max(
    4,
    ...commits.filter((_, i) => hasAny[i]),
    ...prs.filter((_, i) => hasAny[i]),
  );
  const yMax = niceCeil(barMax);
  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: 8, bottom: 26, containLabel: false },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(17, 19, 24, 0.96)",
        borderColor: "#232732",
        borderWidth: 1,
        padding: [10, 12],
        textStyle: { color: "#94a3b8", fontSize: 12 },
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(56, 189, 248, 0.06)" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; seriesName: string; value: number; marker: string; dataIndex: number }>;
          if (!arr.length) return "";
          const idx = arr[0].dataIndex;
          const original = points[idx];
          // Build the visible rows from the original point data, not the
          // emitted zeros (we emit 0 for stack-membership reasons, but the
          // tooltip should reflect the real null-or-number truth).
          const rows: string[] = [];
          if (original.commits !== null) {
            rows.push(`${COMMITS_COLOR_Swatch} Commits: <b style="color:#e2e8f0">${formatNumber(original.commits)}</b>`);
          }
          if (original.prsMerged !== null) {
            rows.push(`${PR_COLOR_Swatch} PRs merged: <b style="color:#e2e8f0">${formatNumber(original.prsMerged)}</b>`);
          }
          const missing: string[] = [];
          if (original.commits === null) missing.push("Commits");
          if (original.prsMerged === null) missing.push("PRs merged");
          const rowsHtml = rows.length > 0
            ? rows.join("<br/>")
            : `<div style="color:#64748b;font-style:italic">No telemetry</div>`;
          const extras = missing.length > 0 && rows.length > 0
            ? `<div style="margin-top:4px;color:#64748b;font-size:11px">${missing.join(" · ")}: no telemetry</div>`
            : "";
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div>${rowsHtml}${extras}`;
        },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: "#64748b", fontSize: 10, formatter: fmtDay },
        axisLine: { lineStyle: { color: "#232732" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        axisLabel: {
          color: "#64748b",
          fontSize: 10,
          formatter: (v: number) => (v === 0 ? "0" : formatNumber(v)),
        },
        splitLine: { lineStyle: { color: "rgba(35, 39, 50, 0.6)" } },
        axisLine: { show: false },
        axisTick: { show: false },
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
      series: [
        {
          name: "Commits",
          type: "bar",
          stack: "throughput",
          data: commits,
          itemStyle: (params: { dataIndex: number }): { color: string; borderRadius: number[] } => {
            // Fully-empty day (no commits + no PRs): draw a faint dotted
            // placeholder rect at the baseline so the gap reads as
            // intentional rather than a missing render.
            if (!hasAny[params.dataIndex]) {
              return {
                color: "rgba(100, 116, 139, 0.15)",
                borderRadius: [2, 2, 0, 0],
              };
            }
            return { color: COMMITS_COLOR, borderRadius: [0, 0, 0, 0] };
          },
          barMaxWidth: 18,
        },
        {
          name: "PRs merged",
          type: "bar",
          stack: "throughput",
          data: prs,
          itemStyle: (params: { dataIndex: number }): { color: string; borderRadius: number[] } => {
            if (!hasAny[params.dataIndex]) {
              // Empty-day PR segment stays invisible — the Commits segment
              // already draws the placeholder.
              return { color: "transparent", borderRadius: [2, 2, 0, 0] };
            }
            return { color: PR_COLOR, borderRadius: [3, 3, 0, 0] };
          },
          barMaxWidth: 18,
        },
      ],
    },
    true
  );
}