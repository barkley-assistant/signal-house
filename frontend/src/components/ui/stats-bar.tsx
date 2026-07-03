import * as React from "react";

import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format-cost";
import { formatNumber } from "../../../../utils/format";

export type StatFormat = "number" | "cost" | "percentage";
export type StatsBarVariant = "compact" | "default" | "card";

export interface StatItem {
  label: string;
  value: number | string | null | undefined;
  icon?: React.ElementType;
  highlight?: boolean;
  format?: StatFormat;
}

export interface StatsBarProps {
  stats: StatItem[];
  variant?: StatsBarVariant;
  className?: string;
}

const VARIANT_STYLES: Record<StatsBarVariant, string> = {
  compact: "gap-2",
  default: "gap-4",
  card: "gap-4 rounded-lg border border-card-border bg-card-bg px-3 py-2",
};

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatValue(item: StatItem): string {
  const { value, format } = item;
  if (value == null) return "—";
  if (typeof value === "string") return value;
  switch (format) {
    case "cost":
      return formatCost(value);
    case "percentage":
      return formatPercentage(value);
    case "number":
      return formatNumber(value);
    default:
      return String(value);
  }
}

export function StatsBar({
  stats,
  variant = "default",
  className,
}: StatsBarProps) {
  if (stats.length === 0) return null;

  return (
    <dl
      data-slot="stats-bar"
      data-variant={variant}
      className={cn(
        "flex flex-col text-sm",
        "sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-1",
        VARIANT_STYLES[variant],
        className,
      )}
    >
      {stats.map((item, i) => {
        const Icon = item.icon;
        return (
          <div
            key={`${item.label}-${i}`}
            data-slot="stat-item"
            className="flex items-baseline gap-1.5"
          >
            {Icon && (
              <Icon
                className="size-4 shrink-0 text-text-muted"
                aria-hidden="true"
              />
            )}
            <dt className="text-text-muted">{item.label}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                item.highlight ? "text-accent-primary" : "text-text-primary",
              )}
            >
              {formatValue(item)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
