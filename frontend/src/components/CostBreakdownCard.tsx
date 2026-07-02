"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { UsageBar } from "@/components/UsageBar";
import { StatsBar } from "@/components/ui/stats-bar";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format-cost";
import {
  aggregateCostRows,
  computeEfficiencyMultiplier,
  formatCostPerMessage,
  getCheapestCpm,
  getEfficiencyTier,
  rankByCost,
} from "@/lib/cost-efficiency";
import type { CostRow, EfficiencyTier } from "@/lib/cost-efficiency";
import type { TokenUsageRow } from "@/types";

export interface CostBreakdownCardProps {
  tokenUsage: TokenUsageRow | null;
}

function EmptyCostState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <BarChart3 className="size-6 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text-secondary">
        No cost data available
      </p>
      <p className="text-xs text-text-muted">
        Cost data appears once model usage includes cost information
      </p>
    </div>
  );
}

function rowAriaLabel(row: CostRow): string {
  const cpmText = formatCostPerMessage(row.costPerMessage);
  return `${row.modelName}: ${formatCost(row.cost)} total, ${cpmText} per message, ${row.messages} messages`;
}

function barAriaLabel(row: CostRow, maxCost: number): string {
  if (row.cost == null) return `${row.modelName}: no cost data`;
  const percent = maxCost > 0 ? Math.round((row.cost / maxCost) * 100) : 0;
  return `${row.modelName}: ${percent}% of total cost`;
}

type BarColorTier = EfficiencyTier;

const BAR_COLORS: Record<BarColorTier, string> = {
  efficient: "bg-status-success",
  normal: "bg-chart-2",
  "below-average": "bg-status-warning",
  inefficient: "bg-status-error",
};

function CostRowView({
  row,
  maxCost,
  cheapestCpm,
  isSingle,
}: {
  row: CostRow;
  maxCost: number;
  cheapestCpm: number | null;
  isSingle: boolean;
}) {
  const tier: BarColorTier = isSingle
    ? "normal"
    : getEfficiencyTier(row.costPerMessage, cheapestCpm);
  const multiplier = isSingle
    ? null
    : computeEfficiencyMultiplier(row, cheapestCpm);

  return (
    <div
      className="rounded-lg border border-card-border bg-card-bg p-3"
      aria-label={rowAriaLabel(row)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {row.modelName}
        </span>
        <span
          className={cn(
            "font-mono text-sm tabular-nums",
            row.cost != null && row.cost > 0
              ? "text-accent-primary"
              : "text-text-secondary",
          )}
        >
          {formatCost(row.cost)}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {formatCostPerMessage(row.costPerMessage)}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {row.messages} msgs
        </span>
        {multiplier != null && (
          <span className="text-xs text-text-muted tabular-nums">
            {multiplier.toFixed(1)}×
          </span>
        )}
      </div>
      {row.cost != null && (
        <UsageBar
          value={row.cost}
          max={maxCost}
          color={BAR_COLORS[tier]}
          label={barAriaLabel(row, maxCost)}
          className="mt-2"
        />
      )}
    </div>
  );
}

export function CostBreakdownCard({ tokenUsage }: CostBreakdownCardProps) {
  const modelUsage = useMemo(
    () => tokenUsage?.modelUsage ?? [],
    [tokenUsage?.modelUsage],
  );

  const rows = useMemo(() => rankByCost(aggregateCostRows(modelUsage)), [modelUsage]);

  const hasAnyCost = useMemo(
    () => rows.some((r) => r.cost != null),
    [rows],
  );

  const maxCost = useMemo(
    () => rows.reduce((max, r) => (r.cost != null && r.cost > max ? r.cost : max), 0),
    [rows],
  );

  const totalCost = useMemo(
    () => rows.reduce((sum, r) => sum + (r.cost ?? 0), 0),
    [rows],
  );

  const totalMessages = useMemo(
    () => rows.reduce((sum, r) => sum + r.messages, 0),
    [rows],
  );

  const avgCpm = useMemo(
    () => (totalMessages > 0 ? totalCost / totalMessages : null),
    [totalCost, totalMessages],
  );

  const cheapestCpm = useMemo(() => getCheapestCpm(rows), [rows]);

  const isSingle = rows.length === 1;

  if (!hasAnyCost) {
    return <EmptyCostState />;
  }

  return (
    <div className="space-y-3">
      <StatsBar
        variant="card"
        stats={[
          { label: "Total", value: totalCost, format: "cost" },
          { label: "Messages", value: totalMessages, format: "number" },
          { label: "Avg", value: formatCostPerMessage(avgCpm) },
        ]}
      />
      <div className="space-y-2">
        {rows.map((row) => (
          <CostRowView
            key={row.modelName}
            row={row}
            maxCost={maxCost}
            cheapestCpm={cheapestCpm}
            isSingle={isSingle}
          />
        ))}
      </div>
    </div>
  );
}
