"use client";

import { useMemo, useState } from "react";
import type { DailyTokenUsageRow } from "@/types";
import { TrendEChart } from "@/components/TrendEChart";
import { useEChartsTheme } from "@/hooks/useEChartsTheme";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { EChartsOption } from "echarts-for-react";
import { formatCost } from "@/lib/format-cost";
import { formatCompactNumber, formatNumber } from "../../../utils/format";
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
  const inputTokens = sorted.map((d) =>
    d.isGap ? 0 : d.row!.modelUsage.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0),
  );
  const outputTokens = sorted.map((d) =>
    d.isGap ? 0 : d.row!.modelUsage.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0),
  );

  return {
    grid: { top: 4, right: 4, bottom: 4, left: 4, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      show: false,
    },
    yAxis: {
      type: "value",
      show: false,
    },
    tooltip: { show: false },
    series: [
      {
        name: "Input",
        type: "line",
        data: inputTokens,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#38bdf8", width: 1.5 },
        areaStyle: { color: "rgba(56,189,248,0.08)" },
      },
      {
        name: "Output",
        type: "line",
        data: outputTokens,
        smooth: true,
        symbol: "none",
        lineStyle: { color: "#4ade80", width: 1.5 },
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
  const [expanded, setExpanded] = useState(false);

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

    // Find dominant model across all days (only non-gap)
    const modelSessions = new Map<string, number>();
    for (const d of filled) {
      if (d.isGap || !d.row) continue;
      for (const m of d.row.modelUsage) {
        modelSessions.set(
          m.modelName,
          (modelSessions.get(m.modelName) ?? 0) + m.messages,
        );
      }
    }
    let dominantModel = "—";
    let maxSessions = 0;
    for (const [name, sessions] of modelSessions) {
      if (sessions > maxSessions) {
        maxSessions = sessions;
        dominantModel = name;
      }
    }

    return { totalInput, totalOutput, totalSessions, totalCost, dominantModel };
  }, [filled]);

  const sparklineOption = useMemo<EChartsOption>(() => {
    return { ...theme, ...buildSparklineOption(filled) };
  }, [filled, theme]);

  const isEmpty = rows.length === 0 && spine.length === 0;

  // Per-day rows sorted by date desc for expanded table (iterate filled)
  const effectiveRows = useMemo(
    () => [...filled].sort((a, b) => b.date.localeCompare(a.date)),
    [filled],
  );

  return (
    <Card className="border-card-border bg-card-bg">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-text-primary text-base">
            Hermes Token Usage
          </CardTitle>
          <span aria-hidden="true" className="text-sm">⚡</span>
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
            <Skeleton className="h-[100px] w-full bg-divider" />
            <Skeleton className="h-6 w-2/3 bg-divider" />
          </div>
        ) : (
          <>
            {isEmpty ? (
              <div className="flex h-[100px] items-center justify-center rounded-lg border border-dashed border-divider">
                <p className="px-2 text-center text-xs text-text-muted">
                  No Hermes token usage data
                </p>
              </div>
            ) : (
              <>
                {/* Sparkline */}
                <div className="h-[100px]">
                  <TrendEChart option={sparklineOption} height={100} />
                </div>

                {/* Summary row */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-text-secondary">
                  <span>
                    <span className="text-text-muted">Input: </span>
                    <span className="font-mono tabular-nums text-text-primary">
                      {formatCompactNumber(totals.totalInput)}
                    </span>
                  </span>
                  <span>
                    <span className="text-text-muted">Output: </span>
                    <span className="font-mono tabular-nums text-text-primary">
                      {formatCompactNumber(totals.totalOutput)}
                    </span>
                  </span>
                  <span>
                    <span className="text-text-muted">Cost: </span>
                    <span className="font-mono tabular-nums text-accent-primary">
                      {formatCost(totals.totalCost)}
                    </span>
                  </span>
                  <span>
                    <span className="text-text-muted">Sessions: </span>
                    <span className="font-mono tabular-nums text-text-primary">
                      {formatNumber(totals.totalSessions)}
                    </span>
                  </span>
                  <span className="truncate max-w-[180px]">
                    <span className="text-text-muted">Top model: </span>
                    <span className="text-text-primary">
                      {totals.dominantModel}
                    </span>
                  </span>
                </div>

                {/* Expand/Collapse */}
                <div>
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => !prev)}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                  >
                    {expanded ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                    {expanded ? "Collapse" : "Expand"} details
                  </button>

                  {expanded && (
                    <div className="mt-2">
                      {/* Desktop table */}
                      <div className="hidden sm:block">
                        <div role="table" className="w-full">
                          <div
                            role="row"
                            className="grid grid-cols-[1.2fr_repeat(4,1fr)_0.8fr] gap-x-3 px-3 py-1.5 text-[10px] uppercase tracking-[0.06em] text-text-muted"
                          >
                            <div role="columnheader">Day</div>
                            <div role="columnheader" className="text-right">
                              Input
                            </div>
                            <div role="columnheader" className="text-right">
                              Output
                            </div>
                            <div role="columnheader" className="text-right">
                              Cost
                            </div>
                            <div role="columnheader" className="text-right">
                              Sessions
                            </div>
                            <div role="columnheader" className="text-right">
                              Top Model
                            </div>
                          </div>
                          {effectiveRows.map((d) => {
                            const dayInput = d.isGap
                              ? 0
                              : d.row!.modelUsage.reduce(
                                  (sum, m) => sum + (m.inputTokens ?? 0),
                                  0,
                                );
                            const dayOutput = d.isGap
                              ? 0
                              : d.row!.modelUsage.reduce(
                                  (sum, m) => sum + (m.outputTokens ?? 0),
                                  0,
                                );
                            const topModel = d.isGap
                              ? null
                              : [...d.row!.modelUsage].sort(
                                  (a, b) => (b.messages ?? 0) - (a.messages ?? 0),
                                )[0];

                            return (
                              <div
                                key={d.date}
                                role="row"
                                className="grid grid-cols-[1.2fr_repeat(4,1fr)_0.8fr] gap-x-3 border-t border-card-border px-3 py-2"
                              >
                                <div
                                  role="cell"
                                  className="text-xs font-medium text-text-primary self-center"
                                >
                                  {formatDayLabel(d.date)}
                                </div>
                                <div
                                  role="cell"
                                  className="text-right text-xs font-mono tabular-nums text-text-secondary self-center"
                                >
                                  {formatCompactNumber(dayInput)}
                                </div>
                                <div
                                  role="cell"
                                  className="text-right text-xs font-mono tabular-nums text-text-secondary self-center"
                                >
                                  {formatCompactNumber(dayOutput)}
                                </div>
                                <div
                                  role="cell"
                                  className="text-right text-xs font-mono tabular-nums text-accent-primary self-center"
                                >
                                  {d.isGap ? "—" : formatCost(d.row!.totalCost)}
                                </div>
                                <div
                                  role="cell"
                                  className="text-right text-xs font-mono tabular-nums text-text-secondary self-center"
                                >
                                  {d.isGap ? "—" : formatNumber(d.row!.totalSessions)}
                                </div>
                                <div
                                  role="cell"
                                  className="text-right text-xs text-text-muted truncate self-center"
                                >
                                  {topModel?.modelName ?? "—"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Mobile cards */}
                      <div className="space-y-2 sm:hidden">
                        {effectiveRows.map((d) => (
                          <div
                            key={d.date}
                            className="rounded-lg border border-card-border bg-card-bg p-3"
                          >
                            <div className="text-xs font-semibold text-text-primary mb-1.5">
                              {formatDayLabel(d.date)}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                              <span className="text-text-muted">Input</span>
                              <span className="font-mono tabular-nums text-text-secondary text-right">
                                {formatCompactNumber(
                                  d.isGap
                                    ? 0
                                    : d.row!.modelUsage.reduce(
                                        (s, m) => s + (m.inputTokens ?? 0),
                                        0,
                                      ),
                                )}
                              </span>
                              <span className="text-text-muted">Output</span>
                              <span className="font-mono tabular-nums text-text-secondary text-right">
                                {formatCompactNumber(
                                  d.isGap
                                    ? 0
                                    : d.row!.modelUsage.reduce(
                                        (s, m) => s + (m.outputTokens ?? 0),
                                        0,
                                      ),
                                )}
                              </span>
                              <span className="text-text-muted">Cost</span>
                              <span className="font-mono tabular-nums text-accent-primary text-right">
                                {d.isGap ? "—" : formatCost(d.row!.totalCost)}
                              </span>
                              <span className="text-text-muted">Sessions</span>
                              <span className="font-mono tabular-nums text-text-secondary text-right">
                                {d.isGap ? "—" : formatNumber(d.row!.totalSessions)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
