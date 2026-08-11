/**
 * Model pricing lookup + cache-savings formula.
 *
 * The operator's deliberate `cost.cache.read = 0` config (cached reads are
 * free in the openference provider) means a cache hit is a direct discount
 * equal to `cacheReadTokens × costInput / 1e6`. We deliberately do not look
 * up a separate cache-discount rate — the savings formula IS the input rate
 * × cached tokens. Documenting this here so the next reader doesn't think
 * we missed a separate cache-discount rate.
 *
 * `costInput` (USD per 1M input tokens) lives in `model-map.json` per model.
 * Unpriced models return null, which the UI renders as em-dash (not $0).
 */

import modelMap from "./model-map.json";
import { machineKey } from "./models";

type ModelEntry = {
  machine: string;
  label: string;
  family?: string;
  /** USD per 1M input tokens. undefined = unpriced (renders as em-dash). */
  costInput?: number;
};

const MODELS = modelMap.models as ModelEntry[];
const BY_MACHINE = new Map<string, ModelEntry>(MODELS.map((m) => [m.machine, m]));

/** Lookup the USD/1M-input rate for a model, by label, raw name, or machine
 *  key. Returns null when the model has no entry in `costInput` — the UI
 *  renders this as em-dash, never $0.00. */
export function costInputForModel(raw: string): number | null {
  const entry = BY_MACHINE.get(machineKey(raw));
  if (!entry || typeof entry.costInput !== "number") return null;
  return entry.costInput;
}

/** Compute the dollar value of cache_read tokens at the model's input rate.
 *  `cacheReadTokens` is the count of cached input tokens (not cache_write).
 *  Returns null when the model is unpriced (UI → em-dash).
 *  Returns 0 when there are no cached tokens (UI → $0.00). Never NaN. */
export function cacheSavingsUsdForModel(raw: string, cacheReadTokens: number | null): number | null {
  if (cacheReadTokens === null || cacheReadTokens === 0) return cacheReadTokens ?? 0;
  const rate = costInputForModel(raw);
  if (rate === null) return null;
  return (cacheReadTokens * rate) / 1_000_000;
}