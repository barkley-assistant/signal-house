import type { EChartsOption } from "echarts-for-react";
import type { DashboardWindowDay } from "@/types";
import { formatCycleTime } from "@/lib/format-cycle-time";
import { formatCompactNumber } from "../../../../utils/format";

export function formatDayLabel(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buildThroughputOption(
  days: DashboardWindowDay[],
): EChartsOption | null {
  const nonNull = days.filter((d) => !d.isGap && d.metrics);
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const values = days.map((d) =>
    d.isGap ? null : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0),
  );
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: {
        fontSize: 10,
        color: "#64748b",
        formatter: (value: number) => formatCompactNumber(value),
      },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#38bdf8", width: 2 },
        itemStyle: { color: "#38bdf8" },
        areaStyle: { color: "rgba(56,189,248,0.12)" },
      },
    ],
  };
}

export function buildCycleTimeOption(
  days: DashboardWindowDay[],
): EChartsOption | null {
  // Backend #152 will provide rolling 14-day medianCycleTimeSeconds per day.
  // Until then we use the per-day medianCycleTimeSeconds from DailyMetricsRow.
  const nonNull = days.filter(
    (d) => !d.isGap && d.metrics?.medianCycleTimeSeconds != null,
  );
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const values = days.map((d) =>
    d.isGap ? null : (d.metrics?.medianCycleTimeSeconds ?? null),
  );
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: { fontSize: 10, color: "#64748b" },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
      formatter: (params: { value: number | null }) => {
        const val = params.value;
        return val != null ? formatCycleTime(val) : "—";
      },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#a78bfa", width: 2 },
        itemStyle: { color: "#a78bfa" },
        areaStyle: { color: "rgba(167,139,250,0.12)" },
      },
    ],
  };
}

export function buildCIOption(
  days: DashboardWindowDay[],
): EChartsOption | null {
  const nonNull = days.filter((d) => !d.isGap && d.metrics);
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const passCounts = days.map((d) =>
    d.isGap ? null : (d.metrics?.ciPassCount ?? 0),
  );
  const failCounts = days.map((d) =>
    d.isGap ? null : (d.metrics?.ciFailCount ?? 0),
  );
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: {
        fontSize: 10,
        color: "#64748b",
        formatter: (value: number) => formatCompactNumber(value),
      },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    series: [
      {
        name: "Passed",
        type: "bar",
        stack: "ci",
        data: passCounts,
        itemStyle: { color: "#4ade80" },
        barMaxWidth: 12,
      },
      {
        name: "Failed",
        type: "bar",
        stack: "ci",
        data: failCounts,
        itemStyle: { color: "#f87171" },
        barMaxWidth: 12,
      },
    ],
  };
}

export function computeThroughputFooter(days: DashboardWindowDay[]): string {
  if (days.length < 2) return "Insufficient data";
  const mid = Math.floor(days.length / 2);
  const prev = days.slice(0, mid);
  const curr = days.slice(mid);
  const prevSum = prev.reduce(
    (s, d) =>
      s +
      (d.isGap ? 0 : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0)),
    0,
  );
  const currSum = curr.reduce(
    (s, d) =>
      s +
      (d.isGap ? 0 : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0)),
    0,
  );
  const pctChange = prevSum > 0 ? ((currSum - prevSum) / prevSum) * 100 : 0;
  const arrow = pctChange >= 0 ? "↑" : "↓";
  const pctStr = prevSum > 0 ? `${Math.abs(Math.round(pctChange))}%` : "—";
  return `${arrow}${pctStr} from last window · ${currSum} this window`;
}

export function computeCycleTimeFooter(days: DashboardWindowDay[]): string {
  const nonNull = days.filter(
    (d) => !d.isGap && d.metrics?.medianCycleTimeSeconds != null,
  );
  if (nonNull.length < 3) return "Insufficient PR data for cycle time trend";
  const latestSeconds =
    nonNull[nonNull.length - 1].metrics!.medianCycleTimeSeconds!;
  // Trend: compare first half vs second half. Down = improving for cycle time.
  const mid = Math.floor(nonNull.length / 2);
  const firstHalf = nonNull.slice(0, mid);
  const secondHalf = nonNull.slice(mid);
  const firstAvg =
    firstHalf.reduce(
      (s, d) => s + (d.metrics?.medianCycleTimeSeconds ?? 0),
      0,
    ) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce(
      (s, d) => s + (d.metrics?.medianCycleTimeSeconds ?? 0),
      0,
    ) / secondHalf.length;
  const trend =
    secondAvg < firstAvg ? "Improving" : secondAvg > firstAvg ? "Slowing" : "Steady";
  return `Daily median · ${formatCycleTime(latestSeconds)} latest · ${trend} over window`;
}

export function computeCIFooter(days: DashboardWindowDay[]): string {
  if (days.length < 2) return "Insufficient data";
  const mid = Math.floor(days.length / 2);
  const curr = days.slice(mid);
  const totalRuns = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciTotalRuns ?? 0),
    0,
  );
  const passCount = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciPassCount ?? 0),
    0,
  );
  const failCount = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciFailCount ?? 0),
    0,
  );
  // "Unknown vs measured" contract: when no CI has run in the window, do
  // not render the misleading "0% pass rate" string. Surface the
  // absence-of-data condition directly. (issue #343)
  if (totalRuns === 0) return "No runs this window";
  const passRate = Math.round((passCount / totalRuns) * 100);
  return `${passRate}% pass rate · ${failCount} failures this window`;
}
