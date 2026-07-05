import { formatCost } from "@/lib/format-cost";

export interface CostRow {
  modelName: string;
  cost: number | null;
  messages: number;
  costPerMessage: number | null;
}

export type EfficiencyTier =
  | "efficient"
  | "normal"
  | "below-average"
  | "inefficient";

interface ModelUsageLike {
  modelName: string;
  messages: number;
  cost: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  tokensReasoning?: number | null;
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

export function getCheapestCpm(rows: CostRow[]): number | null {
  const cpms = rows
    .map((r) => r.costPerMessage)
    .filter((v): v is number => v != null);
  return cpms.length === 0 ? null : Math.min(...cpms);
}

export function computeEfficiencyMultiplier(
  row: CostRow,
  cheapestCpm: number | null,
): number | null {
  if (row.costPerMessage == null || cheapestCpm == null || cheapestCpm === 0) {
    return null;
  }
  return Math.round((row.costPerMessage / cheapestCpm) * 10) / 10;
}

export function getEfficiencyTier(
  costPerMessage: number | null,
  cheapestCpm: number | null,
): EfficiencyTier {
  if (costPerMessage == null || cheapestCpm == null || cheapestCpm === 0) {
    return "normal";
  }
  const ratio = costPerMessage / cheapestCpm;
  if (ratio <= 3.0) return "efficient";
  if (ratio <= 12.0) return "normal";
  if (ratio <= 25.0) return "below-average";
  return "inefficient";
}
