"use client";

import { useMemo, useState } from "react";
import type { DailyTokenUsageRow } from "@/types";
import { TrendEChart } from "@/components/TrendEChart";
import { useEChartsTheme } from "@/hooks/useEChartsTheme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EChartsOption } from "echarts-for-react";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format-cost";
import { formatCompactNumber } from "../../../utils/format";

interface DailyTokenUsageCardProps {
  rows: DailyTokenUsageRow[];
  startDay: string;
  endDay: string;
  loading?: boolean;
  error?: string | null;
}

type ModelEntry = DailyTokenUsageRow["modelUsage"][number];

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatDayLabel(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildDateSpine(startDay: string, endDay: string): string[] {
  const start = new Date(startDay + "T00:00:00Z");
  const end = new Date(endDay + "T00:00:00Z");
  const days: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

interface FilledDay {
  date: string;
  row: DailyTokenUsageRow | null;
  isGap: boolean;
}

function buildDailyTokenUsageOption(
  filled: FilledDay[],
): EChartsOption | null {
  const nonNull = filled.filter((d) => !d.isGap && d.row);
  if (nonNull.length === 0) return null;
  const labels = filled.map((d) => formatDayLabel(d.date));
  const tokens = filled.map((d) => (d.isGap ? null : d.row!.totalTokens));
  const cost = filled.map((d) =>
    d.isGap ? null : d.row!.totalCost,
  );
  const sessions = filled.map((d) =>
    d.isGap ? null : d.row!.totalSessions,
  );
  return {
    grid: { top: 16, right: 52, bottom: 24, left: 40, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: "value",
        splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
        axisLabel: {
          fontSize: 10,
          color: "#64748b",
          formatter: (value: number) => formatCompactNumber(value),
        },
      },
      {
        type: "value",
        splitLine: { show: false },
        axisLabel: {
          fontSize: 10,
          color: "#64748b",
          formatter: (value: number) => formatCost(value),
        },
      },
    ],
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
      axisPointer: { type: "cross", label: { backgroundColor: "#262a33" } },
      formatter: (params: any[]) => {
        return params
          .map((p) => {
            const rawValue = Array.isArray(p.value) ? p.value[1] : p.value;
            const value =
              p.seriesName === "Cost"
                ? formatCost(rawValue)
                : rawValue ?? "—";
            return `${p.marker ?? ""} ${p.seriesName}: ${value}`;
          })
          .join("<br/>");
      },
    },
    series: [
      {
        name: "Tokens",
        type: "line",
        data: tokens,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#38bdf8", width: 2 },
        itemStyle: { color: "#38bdf8" },
        areaStyle: { color: "rgba(56,189,248,0.12)" },
      },
      {
        name: "Cost",
        type: "line",
        yAxisIndex: 1,
        data: cost,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#fbbf24", width: 2 },
        itemStyle: { color: "#fbbf24" },
        areaStyle: { color: "rgba(251,191,36,0.12)" },
      },
      {
        name: "Sessions",
        type: "bar",
        data: sessions,
        itemStyle: { color: "#4ade80" },
        barMaxWidth: 12,
      },
    ],
  };
}

const LEGEND = [
  { label: "Tokens", color: "#38bdf8" },
  { label: "Cost", color: "#fbbf24" },
  { label: "Sessions", color: "#4ade80" },
];

export function DailyTokenUsageCard({
  rows,
  startDay,
  endDay,
  loading,
  error,
}: DailyTokenUsageCardProps) {
  const theme = useEChartsTheme();

  const rowByDate = useMemo(() => {
    const map = new Map<string, DailyTokenUsageRow>();
    for (const r of rows) map.set(r.date, r);
    return map;
  }, [rows]);

  const spine = useMemo(
    () => buildDateSpine(startDay, endDay),
    [startDay, endDay],
  );

  const filled = useMemo<FilledDay[]>(
    () =>
      spine.map((date) => {
        const row = rowByDate.get(date) ?? null;
        return { date, row, isGap: row === null };
      }),
    [spine, rowByDate],
  );

  const availableDays = useMemo(
    () => rows.map((r) => r.date).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [rows],
  );

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const effectiveSelectedDay =
    selectedDay ?? availableDays[availableDays.length - 1] ?? null;
  const selectedRow =
    effectiveSelectedDay != null ? rowByDate.get(effectiveSelectedDay) ?? null : null;

  const option = useMemo<EChartsOption | null>(() => {
    const base = buildDailyTokenUsageOption(filled);
    if (!base) return null;
    return { ...theme, ...base };
  }, [filled, theme]);

  const isEmpty = rows.length === 0;

  return (
    <Card className="border-card-border bg-card-bg">
      <CardHeader>
        <CardTitle className="text-text-primary">Daily Token Usage</CardTitle>
        <p className="text-sm text-text-secondary">
          Tokens, cost, and sessions per day with model breakdown
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div
            className="rounded-lg border border-status-error/30 px-4 py-3 text-sm text-status-error"
            role="alert"
          >
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[220px] w-full bg-divider" />
            <Skeleton className="h-8 w-2/3 bg-divider" />
          </div>
        ) : isEmpty || !option ? (
          <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-divider">
            <p className="px-2 text-center text-xs text-text-muted">
              No daily token usage data in this window
            </p>
          </div>
        ) : (
          <>
            <div className="h-[220px]">
              <TrendEChart option={option} height={220} />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              {LEGEND.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-1.5 text-xs text-text-muted"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {item.label}
                </div>
              ))}
            </div>

            {availableDays.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {availableDays.map((day) => {
                    const active = effectiveSelectedDay === day;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        aria-pressed={active}
                        className={cn(
                          "rounded px-2 py-1 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-accent-primary text-primary-foreground"
                            : "border border-card-border text-text-muted hover:bg-card-hover",
                        )}
                      >
                        {formatDayLabel(day)}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {selectedRow && selectedRow.modelUsage.length > 0 ? (
                    selectedRow.modelUsage.map((m: ModelEntry) => (
                      <div
                        key={m.modelName}
                        className="rounded-lg border border-card-border bg-card-bg p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate text-sm font-semibold text-text-primary">
                            {m.modelName}
                          </span>
                          <span className="shrink-0 text-xs font-mono tabular-nums text-accent-primary">
                            {formatCost(m.cost)}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-5 gap-1 text-center">
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                              In
                            </span>
                            <span className="text-xs font-mono tabular-nums text-text-secondary">
                              {formatNumber(m.inputTokens)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                              Out
                            </span>
                            <span className="text-xs font-mono tabular-nums text-text-secondary">
                              {formatNumber(m.outputTokens)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                              Cache R
                            </span>
                            <span className="text-xs font-mono tabular-nums text-text-secondary">
                              {formatNumber(m.cacheReadTokens)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                              Cache W
                            </span>
                            <span className="text-xs font-mono tabular-nums text-text-secondary">
                              {formatNumber(m.cacheWriteTokens)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">
                              Msgs
                            </span>
                            <span className="text-xs font-mono tabular-nums text-text-secondary">
                              {formatNumber(m.messages)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-text-muted">
                      No model breakdown for this day
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
