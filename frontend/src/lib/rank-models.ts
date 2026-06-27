export interface ModelUsageEntry {
  modelName: string;
  messages: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
}

export interface RankedModelEntry extends ModelUsageEntry {
  isOther: boolean;
  proportion: number;
}

function sumOrNull(values: (number | null)[]): number | null {
  let has = false;
  let sum = 0;
  for (const v of values) {
    if (v != null) {
      has = true;
      sum += v;
    }
  }
  return has ? sum : null;
}

function totalTokens(entry: ModelUsageEntry): number {
  return (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
}

/**
 * Ranks model usage entries by total tokens (input + output) descending,
 * applies a 95% cumulative-token-share cutoff, and groups remaining
 * models (2+) into a single "Other" row.  Returns a new sorted array;
 * does not mutate input.
 */
export function rankModelUsage(entries: ModelUsageEntry[]): RankedModelEntry[] {
  if (entries.length === 0) return [];

  const sorted = [...entries].sort((a, b) => totalTokens(b) - totalTokens(a));
  const totalMessages = sorted.reduce((sum, e) => sum + e.messages, 0);
  const totalTokenSum = sorted.reduce((sum, e) => sum + totalTokens(e), 0);

  if (totalTokenSum === 0) {
    return sorted.map((e) => ({
      ...e,
      isOther: false,
      proportion: totalMessages > 0 ? e.messages / totalMessages : 0,
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
    proportion: entry.messages / totalMessages,
  }));

  if (rest.length === 1) {
    result.push({
      ...rest[0],
      isOther: false,
      proportion: rest[0].messages / totalMessages,
    });
  } else if (rest.length >= 2) {
    const otherMessages = rest.reduce((sum, e) => sum + e.messages, 0);
    result.push({
      modelName: `Other (${rest.length} models)`,
      messages: otherMessages,
      inputTokens: sumOrNull(rest.map((e) => e.inputTokens)),
      outputTokens: sumOrNull(rest.map((e) => e.outputTokens)),
      cacheReadTokens: sumOrNull(rest.map((e) => e.cacheReadTokens)),
      cacheWriteTokens: sumOrNull(rest.map((e) => e.cacheWriteTokens)),
      cost: sumOrNull(rest.map((e) => e.cost)),
      isOther: true,
      proportion: otherMessages / totalMessages,
    });
  }

  return result;
}
