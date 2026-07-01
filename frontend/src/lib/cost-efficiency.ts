import { formatCost } from "@/lib/format-cost";

export interface CostRow {
  modelName: string;
  cost: number | null;
  messages: number;
  costPerMessage: number | null;
}

export interface EfficiencyFlags {
  highCostLowUsage: boolean;
  lowerThanAverage: boolean;
}

export const EFFICIENCY_THRESHOLDS = {
  highCost: 5.0,
  lowUsageMessages: 100,
  cpmMultiplier: 2,
} as const;

interface ModelUsageLike {
  modelName: string;
  messages: number;
  cost: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

function sumNullable(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0);
}

export function aggregateCostRows(entries: ModelUsageLike[]): CostRow[] {
  const grouped = new Map<string, { messages: number; costValues: number[] }>();

  for (const entry of entries) {
    const existing = grouped.get(entry.modelName);
    if (existing) {
      existing.messages += entry.messages;
      if (entry.cost != null) existing.costValues.push(entry.cost);
    } else {
      grouped.set(entry.modelName, {
        messages: entry.messages,
        costValues: entry.cost == null ? [] : [entry.cost],
      });
    }
  }

  return Array.from(grouped.entries()).map(([modelName, { messages, costValues }]) => {
    const cost = sumNullable(costValues);
    const costPerMessage = cost != null && messages > 0 ? cost / messages : null;
    return { modelName, cost, messages, costPerMessage };
  });
}

export function rankByCost(rows: CostRow[]): CostRow[] {
  return [...rows].sort((a, b) => {
    const aCost = a.cost ?? 0;
    const bCost = b.cost ?? 0;
    if (aCost !== bCost) return bCost - aCost;
    return a.modelName.localeCompare(b.modelName);
  });
}

export function formatCostPerMessage(cpm: number | null): string {
  if (cpm == null) return "—";
  if (cpm < 0.01) return `${(cpm * 100).toFixed(1)}¢/msg`;
  return `${formatCost(cpm)}/msg`;
}

export function computeEfficiencyFlags(
  row: CostRow,
  avgCostPerMessage: number | null,
): EfficiencyFlags {
  if (row.cost == null) {
    return { highCostLowUsage: false, lowerThanAverage: false };
  }

  const highCostLowUsage =
    row.cost > EFFICIENCY_THRESHOLDS.highCost &&
    row.messages < EFFICIENCY_THRESHOLDS.lowUsageMessages;

  const lowerThanAverage =
    row.costPerMessage != null &&
    avgCostPerMessage != null &&
    avgCostPerMessage > 0 &&
    row.costPerMessage > EFFICIENCY_THRESHOLDS.cpmMultiplier * avgCostPerMessage;

  return { highCostLowUsage, lowerThanAverage };
}
