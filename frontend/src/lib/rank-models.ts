export interface ModelUsageEntry {
  modelName: string;
  messages: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensReasoning: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
  provider?: string | null;
}

export interface RankedModelEntry extends ModelUsageEntry {
  isOther: boolean;
  proportion: number;
}

import { sumOrNull } from "../../../utils/null-math";
export { sumOrNull };

export function totalTokens(entry: ModelUsageEntry): number {
  return (entry.inputTokens ?? 0)
    + (entry.outputTokens ?? 0)
    + (entry.tokensReasoning ?? 0)
    + (entry.cacheReadTokens ?? 0)
    + (entry.cacheWriteTokens ?? 0);
}

/**
 * Ranks model usage entries by total tokens (input + output) descending,
 * applies a 95% cumulative-token-share cutoff, and groups remaining
 * models (2+) into a single "Other" row.  The returned `proportion` is
 * each row's share of total tokens.  Returns a new sorted array; does not
 * mutate input.
 */
export function rankModelUsage(entries: ModelUsageEntry[]): RankedModelEntry[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => {
    const diff = totalTokens(b) - totalTokens(a);
    if (diff !== 0) return diff;
    return a.modelName.localeCompare(b.modelName);
  });
  const totalTokenSum = sorted.reduce((sum, e) => sum + totalTokens(e), 0);

  if (totalTokenSum === 0) {
    return sorted.map((e) => ({
      ...e,
      isOther: false,
      proportion: 0,
    }));
  }

  let cumulative = 0;
  let topEnd = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += totalTokens(sorted[i]) / totalTokenSum;
    topEnd = i + 1;
    if (cumulative >= 0.95) break;
  }

  const top = sorted.slice(0, topEnd);
  const rest = sorted.slice(topEnd);

  const result: RankedModelEntry[] = top.map((entry) => ({
    ...entry,
    isOther: false,
    proportion: totalTokens(entry) / totalTokenSum,
  }));

  if (rest.length === 1) {
    result.push({
      ...rest[0],
      isOther: false,
      proportion: totalTokens(rest[0]) / totalTokenSum,
    });
  } else if (rest.length >= 2) {
    const otherMessages = rest.reduce((sum, e) => sum + e.messages, 0);
    const otherTokens = rest.reduce((sum, e) => sum + totalTokens(e), 0);
    result.push({
      modelName: `Other (${rest.length} models)`,
      messages: otherMessages,
      inputTokens: sumOrNull(rest.map((e) => e.inputTokens)),
      outputTokens: sumOrNull(rest.map((e) => e.outputTokens)),
      tokensReasoning: sumOrNull(rest.map((e) => e.tokensReasoning)),
      cacheReadTokens: sumOrNull(rest.map((e) => e.cacheReadTokens)),
      cacheWriteTokens: sumOrNull(rest.map((e) => e.cacheWriteTokens)),
      cost: sumOrNull(rest.map((e) => e.cost)),
      isOther: true,
      proportion: otherTokens / totalTokenSum,
    });
  }

  return result;
}
