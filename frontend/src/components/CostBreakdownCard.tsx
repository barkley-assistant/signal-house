"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { UsageBar } from "@/components/UsageBar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format-cost";
import {
  aggregateCostRows,
  computeEfficiencyFlags,
  formatCostPerMessage,
  rankByCost,
} from "@/lib/cost-efficiency";
import type { CostRow } from "@/lib/cost-efficiency";
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

function CostRowView({
  row,
  maxCost,
  avgCpm,
}: {
  row: CostRow;
  maxCost: number;
  avgCpm: number | null;
}) {
  const flags = useMemo(
    () => computeEfficiencyFlags(row, avgCpm),
    [row, avgCpm],
  );

  return (
    <div
      className="rounded-lg border border-card-border bg-card-bg p-3"
      aria-label={rowAriaLabel(row)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {row.modelName}
        </span>
        {flags.highCostLowUsage && (
          <Badge variant="destructive">High cost, low usage</Badge>
        )}
        {flags.lowerThanAverage && (
          <Badge
            variant="outline"
            className="border-status-warning text-status-warning"
          >
            Lower efficiency than average
          </Badge>
        )}
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
      </div>
      {row.cost != null && (
        <UsageBar
          value={row.cost}
          max={maxCost}
          color="bg-chart-2"
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

  if (!hasAnyCost) {
    return <EmptyCostState />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm">
        <span className="text-text-muted">
          Total{" "}
          <span className="font-semibold tabular-nums text-text-primary">
            {formatCost(totalCost)}
          </span>
        </span>
        <span className="text-text-muted">
          Messages{" "}
          <span className="font-semibold tabular-nums text-text-primary">
            {totalMessages}
          </span>
        </span>
        <span className="text-text-muted">
          Avg{" "}
          <span className="font-semibold tabular-nums text-text-primary">
            {formatCostPerMessage(avgCpm)}
          </span>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <CostRowView
            key={row.modelName}
            row={row}
            maxCost={maxCost}
            avgCpm={avgCpm}
          />
        ))}
      </div>
    </div>
  );
}
