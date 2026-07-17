"use client";

import { useMemo } from "react";
import type { DailyTokenUsageRow } from "@/types";
import { TrendEChart } from "@/components/TrendEChart";
import { useEChartsTheme } from "@/hooks/useEChartsTheme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { StatsBar } from "@/components/ui/stats-bar";
import type { StatItem } from "@/components/ui/stats-bar";
import type { EChartsOption } from "echarts-for-react";
import { formatCompactNumber } from "../../../utils/format";
import { buildDateSpine } from "@/lib/date-spine";

interface HermesTokenUsageCardProps {
  rows: DailyTokenUsageRow[];
  startDay: string;
  endDay: string;
  loading?: boolean;
  error?: string | null;
}

function formatDayLabel(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface FilledDay {
  date: string;
  row: DailyTokenUsageRow | null;
  isGap: boolean;
}

function buildSparklineOption(
  filled: FilledDay[],
): EChartsOption {
  const sorted = [...filled].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((d) => formatDayLabel(d.date));
  // Null-aware gap rendering: emit `null` for days without data so the
  // ECharts gap renderer (connectNulls: false) draws a true break rather
  // than a misleading zero. For non-gap days the per-model reduce skips
  // null token fields via `(m.inputTokens ?? 0)` only on days that have
  // data — distinct from a measured-zero token row.
  const inputTokens = sorted.map((d) =>
    d.isGap ? null : d.row!.modelUsage.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0),
  );
  const outputTokens = sorted.map((d) =>
    d.isGap ? null : d.row!.modelUsage.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0),
  );

  return {
    grid: { top: 16, right: 16, bottom: 24, left: 48, containLabel: false },
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
        formatter: (v: number) => formatCompactNumber(v),
      },
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
      axisPointer: { type: "cross", label: { backgroundColor: "#262a33" } },
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? params : [];
        const header = items[0]?.axisValueLabel ?? "";
        const body = items
          .map((p: { marker?: string; seriesName?: string; value?: number | [string | number, number | null] }) => {
            const raw = p.value;
            const num = typeof raw === "number" ? raw : Array.isArray(raw) ? raw[1] ?? 0 : 0;
            return `${p.marker ?? ""} ${p.seriesName}: ${num.toLocaleString("en-US")}`;
          })
          .join("<br/>");
        return `${header}<br/>${body}`;
      },
    },
    series: [
      {
        name: "Input",
        type: "line",
        data: inputTokens,
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#38bdf8", width: 2 },
        areaStyle: { color: "rgba(56,189,248,0.08)" },
      },
      {
        name: "Output",
        type: "line",
        data: outputTokens,
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#4ade80", width: 2 },
        areaStyle: { color: "rgba(74,222,128,0.08)" },
      },
    ],
  };
}

export function HermesTokenUsageCard({
  rows,
  startDay,
  endDay,
  loading,
  error,
}: HermesTokenUsageCardProps) {
  const theme = useEChartsTheme();

  const rowByDate = useMemo(() => {
    const map = new Map<string, DailyTokenUsageRow>();
    for (const r of rows) {
      map.set(r.date, r);
    }
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

  const totals = useMemo(() => {
    const totalInput = filled.reduce(
      (sum, d) =>
        d.isGap
          ? sum
          : sum + d.row!.modelUsage.reduce((s, m) => s + (m.inputTokens ?? 0), 0),
      0,
    );
    const totalOutput = filled.reduce(
      (sum, d) =>
        d.isGap
          ? sum
          : sum + d.row!.modelUsage.reduce((s, m) => s + (m.outputTokens ?? 0), 0),
      0,
    );
    const totalSessions = filled.reduce(
      (sum, d) => (d.isGap ? sum : sum + d.row!.totalSessions),
      0,
    );
    const totalCost = filled.reduce(
      (sum, d) => (d.isGap ? sum : sum + (d.row!.totalCost ?? 0)),
      0,
    );

    return { totalInput, totalOutput, totalSessions, totalCost };
  }, [filled]);

  const sparklineOption = useMemo<EChartsOption>(() => {
    return { ...theme, ...buildSparklineOption(filled) };
  }, [filled, theme]);

  const isEmpty = rows.length === 0 && spine.length === 0;

  return (
    <Card className="border-card-border bg-card-bg">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-text-primary text-base">
            Agent Token Usage
          </CardTitle>
          <Badge
            variant="outline"
            className="ml-1 border-purple-500/30 text-purple-400 text-[10px]"
          >
            Hermes Agent
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <div
            className="rounded-lg border border-status-error/30 px-4 py-3 text-sm text-status-error"
            role="alert"
          >
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-3">
            <Skeleton className="h-[120px] w-full bg-divider" />
            <Skeleton className="h-6 w-2/3 bg-divider" />
          </div>
        ) : (
          <>
            {isEmpty ? (
              <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-divider">
                <p className="px-2 text-center text-xs text-text-muted">
                  No agent token usage data
                </p>
              </div>
            ) : (
              <>
                {/* Sparkline */}
                <div className="h-[120px]">
                  <TrendEChart option={sparklineOption} height={120} />
                </div>

                {/* Summary row */}
                <StatsBar
                  variant="card"
                  stats={[
                    { label: "Input", value: totals.totalInput, format: "number" },
                    { label: "Output", value: totals.totalOutput, format: "number" },
                    { label: "Cost", value: totals.totalCost, format: "cost" },
                    { label: "Sessions", value: totals.totalSessions, format: "number" },
                  ]}
                />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
