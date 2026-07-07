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
import { formatCompactNumber, formatNumber } from "../../../utils/format";

interface DailyTokenUsageCardProps {
  rows: DailyTokenUsageRow[];
  startDay: string;
  endDay: string;
  loading?: boolean;
  error?: string | null;
}

type ChartTooltipValue = number | null;

interface ChartTooltipParam {
  marker?: string;
  seriesName?: string;
  value?: ChartTooltipValue | [string | number, ChartTooltipValue];
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
): EChartsOption {
  const labels = filled.map((d) => formatDayLabel(d.date));
  const tokens = filled.map((d) => (d.isGap ? 0 : d.row!.totalTokens));
  const cost = filled.map((d) =>
    d.isGap ? 0 : d.row!.totalCost,
  );
  const sessions = filled.map((d) =>
    d.isGap ? 0 : d.row!.totalSessions,
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
      formatter: (params: ChartTooltipParam[]) => {
        return params
          .map((p) => {
            const rawValue = Array.isArray(p.value) ? p.value[1] : p.value;
            const value =
              p.seriesName === "Cost"
                ? formatCost(rawValue)
                : formatNumber(rawValue);
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

  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const effectiveSelectedDay =
    selectedDay ?? spine[spine.length - 1] ?? null;
  const selectedRow =
    effectiveSelectedDay != null ? rowByDate.get(effectiveSelectedDay) ?? null : null;

  const option = useMemo<EChartsOption>(() => {
    return { ...theme, ...buildDailyTokenUsageOption(filled) };
  }, [filled, theme]);

  const isEmpty = rows.length === 0;

  const sortedModelUsage = useMemo(() => {
    if (!selectedRow) return [];
    return [...selectedRow.modelUsage].sort((a, b) => {
      const costA = a.cost ?? -1;
      const costB = b.cost ?? -1;
      return costB - costA;
    });
  }, [selectedRow]);

  const maxCost = useMemo(
    () => Math.max(...sortedModelUsage.map((m) => m.cost ?? 0), 0),
    [sortedModelUsage],
  );

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
        ) : (
          <>
            {isEmpty ? (
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
              </>
            )}

            {spine.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {spine.map((day) => {
                    const active = effectiveSelectedDay === day;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        aria-pressed={active}
                        className={cn(
                          "cursor-pointer rounded px-2 py-1 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

                <div>
                  {!effectiveSelectedDay || !selectedRow ? (
                    <p className="text-xs text-text-muted">
                      No session data collected for this day.
                    </p>
                  ) : sortedModelUsage.length > 0 ? (
                    <div>
                      <div className="hidden sm:block">
                        <div role="table" className="w-full">
                          <div
                            role="row"
                            className="grid grid-cols-[2fr_repeat(5,1fr)_minmax(100px,1fr)] gap-x-3 px-3 py-1.5 text-[10px] uppercase tracking-[0.06em] text-text-muted"
                          >
                            <div role="columnheader">Model</div>
                            <div role="columnheader" className="text-right">Input</div>
                            <div role="columnheader" className="text-right">Output</div>
                            <div role="columnheader" className="text-right">Cache R</div>
                            <div role="columnheader" className="text-right">Cache W</div>
                            <div role="columnheader" className="text-right">Msgs</div>
                            <div role="columnheader" className="text-right">Cost</div>
                          </div>
                          {sortedModelUsage.map((m) => (
                            <div
                              key={m.modelName}
                              role="row"
                              className="grid grid-cols-[2fr_repeat(5,1fr)_minmax(100px,1fr)] gap-x-3 border-t border-card-border px-3 py-2.5"
                            >
                              <div
                                role="cell"
                                className="truncate text-sm font-medium text-text-primary self-center"
                              >
                                {m.modelName}
                              </div>
                              {([m.inputTokens, m.outputTokens, m.cacheReadTokens, m.cacheWriteTokens, m.messages] as const).map(
                                (val, i) => (
                                  <div
                                    key={i}
                                    role="cell"
                                    className="text-right text-xs font-mono tabular-nums text-text-secondary self-center"
                                  >
                                    {formatNumber(val)}
                                  </div>
                                ),
                              )}
                              <div
                                role="cell"
                                className="text-right self-center"
                              >
                                <div className="flex items-center justify-end gap-1.5">
                                  {maxCost > 0 && m.cost != null && (
                                    <span
                                      className="block h-1.5 rounded-full bg-accent-primary/40"
                                      style={{ width: `${Math.max(2, (m.cost / maxCost) * 40)}px` }}
                                    />
                                  )}
                                  <span className="text-xs font-mono tabular-nums text-accent-primary">
                                    {formatCost(m.cost)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2 sm:hidden">
                        {sortedModelUsage.map((m) => (
                          <div
                            key={m.modelName}
                            className="rounded-lg border border-card-border bg-card-bg p-3"
                          >
                            <div className="mb-2">
                              <span className="truncate text-sm font-semibold text-text-primary">
                                {m.modelName}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Input</span>
                                <span className="font-mono tabular-nums text-text-secondary">{formatNumber(m.inputTokens)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Output</span>
                                <span className="font-mono tabular-nums text-text-secondary">{formatNumber(m.outputTokens)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Cache R</span>
                                <span className="font-mono tabular-nums text-text-secondary">{formatNumber(m.cacheReadTokens)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Cache W</span>
                                <span className="font-mono tabular-nums text-text-secondary">{formatNumber(m.cacheWriteTokens)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Msgs</span>
                                <span className="font-mono tabular-nums text-text-secondary">{formatNumber(m.messages)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Cost</span>
                                <span className="font-mono tabular-nums text-accent-primary">{formatCost(m.cost)}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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
