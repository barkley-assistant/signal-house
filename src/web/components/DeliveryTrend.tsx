/**
 * Delivery panel — optional host-resource line chart (memory / swap / CPU %),
 * CI pass-rate (per-day bar chart, 0–100%), and a Throughput stacked bar
 * (commits + PRs merged).
 *
 * Layout has two shapes, chosen by data rather than props:
 *  - Default: CI ∥ Throughput side-by-side (.delivery-grid), stacked
 *    vertically on phones (<=700px).
 *  - When /api/daily/resource reports host metrics enabled WITH data, the
 *    grid gains a third column (Resource | CI | Throughput, one row on
 *    desktop; still collapses to a vertical stack on phones). Both charts'
 *    DOM nodes live in ONE container whose class switches — moving refs
 *    between different containers would unmount the nodes and orphan their
 *    ECharts instances.
 *
 * The resource chart is fully opt-in server-side (SIGNAL_HOUSE_HOST_METRICS_
 * ENABLED). Disabled or dataless responses render zero artifact: the chart
 * div simply stays display:none and the grid layout never changes.
 *
 * Styling mirrors the Daily cost & tokens chart: same dark background, same
 * muted split lines, same tooltip shell, same 11px legend.
 *
 * Missing-day treatment:
 *  - Resource percentages null → connectNulls:false line gaps; the tooltip
 *    surfaces "No data" (or names which series are missing when partial).
 *  - CI null (no terminal runs) → tiny baseline marker (CI_BAR_FAINT) so the
 *    x-axis is dense but quiet. The tooltip surfaces "No CI runs".
 *  - Commits / PRs null (no telemetry that day) → ECharts bars with null
 *    values render as a clean gap. The tooltip says "No telemetry" and
 *    names which series is missing when only one is.
 */
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDash, loadDeliveryTrend, loadResourceTrend, type DeliveryPoint, type ResourcePoint } from "../state/store";
import { formatNumber } from "../../shared/format";
import { niceCeil } from "../../shared/math";
import { touchAwareTooltip } from "./chart-tooltip";

// Same accent palette as the Daily cost & tokens chart so the panels feel
// like siblings, not strangers.
const CI_COLOR = "#4ade80"; // var(--success) — green
const COMMITS_COLOR = "#94a3b8"; // var(--text-secondary) — slate
const PR_COLOR = "#38bdf8"; // var(--info) — blue

// Host-resource series colours — the shared chart palette from the panel
// design rules (blue/yellow/green), matching Agent Spend's accents.
const MEM_COLOR = "#38bdf8";
const SWAP_COLOR = "#facc15";
const CPU_COLOR = "#4ade80";

// Rate-band colours for the CI bar chart. The visual cue is a more honest
// read of the line-chart's area-fill: green says "we're clean", amber
// says "we have noise", red says "we're broken". Below the bars is a small
// total-runs annotation so the user can tell apart "100% from 1 run" and
// "100% from 50 runs" at a glance.
const CI_BAR_GREEN = CI_COLOR; // pass-rate >= 95%
const CI_BAR_AMBER = "#fbbf24"; // 70% <= pass-rate < 95%
const CI_BAR_RED = "#f87171"; // pass-rate < 70%
const CI_BAR_FAINT = "rgba(74, 222, 128, 0.18)"; // days with no CI data — quiet marker so the user can see "nothing today"

const TOP_HEIGHT = 110;
const BOTTOM_HEIGHT = 110;
const GRID_LEFT = 44;
const GRID_RIGHT = 16;
// Legend sits at the top of every delivery chart; this reserves breathing
// room between the legend row and the plot (Agent Spend uses 48 at ~2x size).
const GRID_TOP_LEGEND = 30;

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
  const resRef = useRef<HTMLDivElement>(null);
  const ciRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const resChartRef = useRef<echarts.ECharts | null>(null);
  const ciChartRef = useRef<echarts.ECharts | null>(null);
  const barChartRef = useRef<echarts.ECharts | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasData, setHasData] = useState(true);
  // Resource chart visibility comes from the API's enabled flag — no local
  // config surface, so a disabled server renders zero extra chrome.
  const [resPoints, setResPoints] = useState<ResourcePoint[] | null>(null);
  const days = useDash((s) => s.days);

  useEffect(() => {
    if (!ciRef.current || !barRef.current) return;
    if (resRef.current) resChartRef.current = echarts.init(resRef.current, "dark");
    ciChartRef.current = echarts.init(ciRef.current, "dark");
    barChartRef.current = echarts.init(barRef.current, "dark");
    const ro = new ResizeObserver(() => {
      resChartRef.current?.resize();
      ciChartRef.current?.resize();
      barChartRef.current?.resize();
    });
    ro.observe(ciRef.current);
    ro.observe(barRef.current);
    if (resRef.current) ro.observe(resRef.current);
    return () => {
      ro.disconnect();
      resChartRef.current?.dispose();
      ciChartRef.current?.dispose();
      barChartRef.current?.dispose();
      resChartRef.current = null;
      ciChartRef.current = null;
      barChartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void Promise.all([loadDeliveryTrend(days), loadResourceTrend(days)]).then(([points, resource]) => {
      if (disposed || !ciChartRef.current || !barChartRef.current) return;
      setResPoints(resource.points.length > 0 ? resource.points : null);
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

  useEffect(() => {
    if (!resChartRef.current || !resPoints || resPoints.length === 0) return;
    renderResource(resChartRef.current, resPoints);
  }, [resPoints]);

  // One stable container; the class chooses the two-column grid (CI ∥
  // Throughput) or the three-column grid (Resource | CI | Throughput).
  // Chart nodes never remount on toggle.
  const showRes = resPoints !== null && !loading && hasData;

  return (
    <section className="card delivery-card" aria-label="Delivery — host resources, CI health and shipping activity">
      <h2>Delivery</h2>
      {!hasData && !loading ? (
        <p className="state-label">No delivery data yet — GitHub collector unavailable or no runs in window</p>
      ) : (
        <div className={showRes ? "delivery-grid three" : "delivery-grid"} aria-busy={loading || undefined}>
          {loading ? (
            <>
              <div className="skeleton" style={{ height: TOP_HEIGHT }} />
              <div className="skeleton" style={{ height: BOTTOM_HEIGHT }} />
            </>
          ) : null}
          <div
            ref={resRef}
            className="delivery-chart"
            style={{ height: TOP_HEIGHT, display: showRes ? "block" : "none" }}
            aria-label="Host resources — memory, swap and CPU utilization per day"
            aria-hidden={!showRes || undefined}
          />
          <div
            ref={ciRef}
            className="delivery-chart"
            style={{ height: TOP_HEIGHT, display: loading ? "none" : "block" }}
            aria-label="CI pass-rate trend"
          />
          <div
            ref={barRef}
            className="delivery-chart"
            style={{ height: BOTTOM_HEIGHT, display: loading ? "none" : "block" }}
            aria-label="Throughput — commits and PRs merged per day"
          />
        </div>
      )}
    </section>
  );
}

/** Render the per-day host-resource percentages as a 3-series line chart.
 *
 *  Memory / swap / CPU are all 0–100% on one axis, so a single shared
 *  y-scale is honest — no per-series normalization to misread. Days with
 *  no archive data stay null and connectNulls:false breaks the line there:
 *  gaps mean "no data", never zero. The tooltip names the missing series
 *  when a day is only partially covered (e.g. swap added later). */
function renderResource(chart: echarts.ECharts, points: ResourcePoint[]): void {
  const dates = points.map((p) => p.date);

  // Same area-fill treatment as the Agent Spend chart: each series washes
  // its own colour under the line (blue 0.12, yellow/green 0.08).
  const withAlpha = (hex: string, alpha: number): string => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };

  const seriesOf = (name: string, key: "memPct" | "swapPct" | "cpuPct", color: string, areaAlpha: number) => ({
    name,
    type: "line" as const,
    data: points.map((p) => p[key]),
    smooth: 0.3,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { color, width: 2 },
    itemStyle: { color },
    areaStyle: { color: withAlpha(color, areaAlpha) },
    emphasis: { focus: "series" as const },
  });

  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: GRID_TOP_LEGEND, bottom: 18, containLabel: false },
      tooltip: {
        ...COMMON_TOOLTIP,
        ...touchAwareTooltip(),
        axisPointer: { type: "line", lineStyle: { color: "#232732" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; seriesName: string; value: number | null; marker: string }>;
          if (!arr.length) return "";
          const p = points.find((q) => q.date === arr[0].axisValue);
          if (!p) return "";
          const visible = arr.filter((row) => row.value !== null);
          const missing = arr.filter((row) => row.value === null).map((row) => row.seriesName);
          const rowsHtml =
            visible.length > 0
              ? visible
                  .map((row) => `${row.marker} ${row.seriesName}: <b style="color:#e2e8f0">${(row.value as number).toFixed(1)}%</b>`)
                  .join("<br/>")
              : `<div style="color:#64748b;font-style:italic">No data</div>`;
          const extras =
            visible.length > 0 && missing.length > 0
              ? `<div style="margin-top:4px;color:#64748b;font-size:11px">${missing.join(" · ")}: no data</div>`
              : "";
          return `<div style="margin-bottom:4px;color:#e2e8f0;font-weight:600">${fmtDayFull(arr[0].axisValue)}</div>${rowsHtml}${extras}`;
        },
      },
      legend: {
        // CPU leads the legend (operator preference). Legend display order
        // is independent of series paint order below.
        data: ["CPU", "Memory", "Swap"],
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
        // Anchor the line to the plot edges: default category axes pad half
        // a band on each side, which reads as the trend "floating" short of
        // the chart bounds next to the bar charts, which fill their bands.
        boundaryGap: false,
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
        // Paint order (last = topmost): Memory and Swap render first so CPU
        // — the line that matters most for spotting load spikes — is never
        // hidden behind them. Area alphas match Agent Spend: 0.12 lead blue,
        // 0.08 for the rest.
        seriesOf("Memory", "memPct", MEM_COLOR, 0.12),
        seriesOf("Swap", "swapPct", SWAP_COLOR, 0.08),
        seriesOf("CPU", "cpuPct", CPU_COLOR, 0.08),
      ],
    },
    true
  );
}

/** Render the per-day CI pass-rate as a per-day bar chart.
 *
 *  Each bar is the day's pass-rate (0–100%). The bar's *colour* is the rate
 *  band (green ≥95, amber 70–95, red <70). The bar's *width* encodes total
 *  run count (the day's surface area = rate × volume). Days with no CI
 *  data get a faint baseline marker so the x-axis is dense but quiet — the
 *  visual difference between "1 run, 100% pass" and "0 runs" is preserved
 *  without faking a continuous trend across gaps.
 *
 *  This replaces the earlier line-chart, which had two problems:
 *  - connectNulls:false made single isolated days invisible (the line
 *    broke at null on both sides and showSymbol:false hid the dot).
 *  - the line's area-fill implied continuity that wasn't there — a CI
 *    rate of 95% for 30 days solid was visually distinct from a CI rate
 *    of 95% on day 7 + 0 runs the other 29 days, but the line chart
 *    smoothed both into the same flat green ribbon.
 *
 *  Bar chart makes the per-day reality visible. No "isolated slither"
 *  hack required. */
function renderCi(chart: echarts.ECharts, points: DeliveryPoint[]): void {
  const dates = points.map((p) => p.date);

  // Per-day data: pass-rate (0-100), the band color, and the surface area
  // multiplier that scales bar width by total runs. Width saturates at a
  // cap so a day with 100 runs doesn't crowd the chart — the height stays
  // meaningful (rate), the width only signals "lots of runs today".
  type BarDatum = {
    value: [string, number]; // [date, rate]
    itemStyle: { color: string; borderRadius: [number, number, number, number] };
    runCount: number;
  };
  const data: BarDatum[] = points.map((p) => {
    if (!p.ci) {
      // No CI runs that day — emit a tiny baseline marker so the user can
      // see "nothing today" without breaking the x-axis density.
      return {
        value: [p.date, 0.5],
        itemStyle: { color: CI_BAR_FAINT, borderRadius: [2, 2, 0, 0] },
        runCount: 0,
      };
    }
    const ratePct = (p.ci.passRate ?? 0) * 100;
    const color = ratePct >= 95 ? CI_BAR_GREEN : ratePct >= 70 ? CI_BAR_AMBER : CI_BAR_RED;
    return {
      value: [p.date, ratePct],
      itemStyle: { color, borderRadius: [3, 3, 0, 0] },
      runCount: p.ci.totalRuns,
    };
  });

  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      // CI has no legend but shares the same plot top so all three rows align.
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: GRID_TOP_LEGEND, bottom: 18, containLabel: false },
      tooltip: {
        ...COMMON_TOOLTIP,
        ...touchAwareTooltip(),
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(56, 189, 248, 0.06)" } },
        formatter: (params: unknown) => {
          const arr = params as Array<{ axisValue: string; data: { value: [string, number]; runCount?: number } }>;
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
          type: "bar",
          data,
          // Responsive bar sizing — the bar fills 70% of its category slot,
          // and the remaining 30% is the gap between days. As the window
          // grows (30-day → 90-day) or the viewport narrows (desktop →
          // mobile), the category slot shrinks proportionally, so the bars
          // shrink with it. The 70% fill keeps adjacent bars distinct
          // without crowding, regardless of how many days the user asks
          // for. Pixel values would either look fine on 30-day / desktop
          // (current behaviour) and cramped on 90-day / mobile, or vice
          // versa — the percentage approach is the single shape that
          // works everywhere.
          barWidth: "70%",
          barGap: 0,
          barCategoryGap: "30%",
          emphasis: {
            focus: "series",
            itemStyle: { color: "#f8fafc" }, // brighter accent on hover — the band color is the resting state
          },
        },
      ],
    },
    true
  );
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
  // Shared ladder: a 93-commit day now yields max 120, not 200.
  const yMax = Math.max(4, niceCeil(barMax));
  chart.setOption(
    {
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",
      backgroundColor: "transparent",
      grid: { left: GRID_LEFT, right: GRID_RIGHT, top: GRID_TOP_LEGEND, bottom: 18, containLabel: false },
      tooltip: {
        ...COMMON_TOOLTIP,
        ...touchAwareTooltip(),
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
          // Same percentage-based sizing as the CI chart above — the bar
          // fills 70% of its category slot, the rest is gap. Scales cleanly
          // across 30-day / 90-day windows and desktop / mobile viewports
          // without any per-shape conditional. barMaxWidth is dropped — the
          // percentage already handles the upper bound (90-day × 70% slot
          // is narrower than the old 16px cap, mobile × 70% is narrower
          // again, both readable).
          barWidth: "70%",
          barGap: 0,
          barCategoryGap: "30%",
        },
        {
          name: "PRs merged",
          type: "bar",
          stack: "throughput",
          data: prs,
          itemStyle: { color: PR_COLOR, borderRadius: [3, 3, 0, 0] },
          barWidth: "70%",
          barGap: 0,
          barCategoryGap: "30%",
        },
      ],
    },
    true
  );
}