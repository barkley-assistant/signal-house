import type { RankedModelEntry } from "@/lib/rank-models";

export function totalTokens(s: RankedModelEntry): number | null {
  const fields = [s.inputTokens, s.outputTokens, s.tokensReasoning, s.cacheReadTokens, s.cacheWriteTokens];
  let has = false;
  let sum = 0;
  for (const f of fields) {
    if (f != null) {
      has = true;
      sum += f;
    }
  }
  return has ? sum : null;
}

export function averageCostPerMessage(entry: RankedModelEntry): number | null {
  if (!entry.messages || entry.cost == null) return null;
  return entry.cost / entry.messages;
}

export function hasDetailData(entry: RankedModelEntry): boolean {
  return [entry.inputTokens, entry.outputTokens, entry.tokensReasoning, entry.cacheReadTokens, entry.cacheWriteTokens, entry.cost].some((value) => value != null && value !== 0);
}
