/**
 * Model pricing resolver — priority chain litellm → local → empty.
 *
 * Public surface for the rest of signal-house. Single async function,
 * `getModelPricing(model)`, that resolves to per-1M-token rates.
 *
 * Priority chain (locked decision):
 *   1. litellm cache (in-memory, populated by the fetcher on startup +
 *      per refresh). Filtered to litellm_provider === "openai" at fetch time.
 *   2. Operator's local rates from ~/.config/opencode/opencode.jsonc,
 *      read via the existing `getInputCostPerMillion()` / `getCacheReadCostPerMillion()`
 *      helpers in `src/server/cost-input.ts`. Output rate is NOT exposed
 *      by those helpers — locked decision #7 says fall back to input × 4
 *      when output is missing.
 *   3. Empty result `{ input: 0, output: 0, cacheRead: 0 }`. Never NaN.
 *
 * The chain is fixed and explicit. machineKey normalisation runs first
 * (lowercase + dot-stripping + non-alphanumeric collapse), then a trailing
 * date-snapshot suffix is stripped (`gpt-5.6-luna-20250815` →
 * `gpt-5.6-luna`) before the lookup — mirrors the existing pattern in
 * `cost-input.ts:69-72`.
 *
 * Used by `src/orchestrator/aggregates.ts` to compute per-row cost when
 * `SIGNAL_HOUSE_ESTIMATE_COSTS=true` (default).
 */

import { getModelPricing as getModelPricingFromCache } from "./model-pricing-fetcher";
import {
  getInputCostPerMillion,
  getCacheReadCostPerMillion,
} from "./cost-input";
import { machineKey, stripDateSnapshot } from "../shared/models";

export interface ModelRates {
  input: number;
  output: number;
  cacheRead: number;
}

/** Default output-rate multiplier when the local source has no output rate
 *  but does have an input rate. Locked decision #7: a defensible default
 *  for chat-completions models where output tokens cost more than input. */
const OUTPUT_DEFAULT_MULTIPLIER = 4;

/**
 /** Pre-fetch rates for a batch of model keys. Returns a Map keyed by
  *  machine key (lowercase + dot-stripped). Use this in callers that need
  *  sync access to rates — the aggregator runs sync, calls this once per
  *  refresh, then looks up per-row without awaiting.
  *
  * Dedupes by machine key before calling the resolver (so "GPT-5" and
  * "gpt-5" count as the same lookup). Empty input returns an empty map.
  * Never throws.
  */
 export async function fetchAllRates(modelKeys: readonly string[]): Promise<Map<string, ModelRates>> {
   const uniq = new Set<string>();
   for (const raw of modelKeys) {
     const k = stripDateSnapshot(machineKey(raw));
     if (k) uniq.add(k);
   }
   const entries = await Promise.all(
     [...uniq].map(async (key) => [key, await getModelPricing(key)] as const),
   );
   return buildRatesMap(entries);
 }

/** Synchronous variant: build a rates map from pre-fetched rates. Useful
 *  in tests that want to inject a pre-built map. */
export function buildRatesMap(entries: Iterable<readonly [string, ModelRates]>): Map<string, ModelRates> {
  return new Map(entries);
}

/**
 * Resolve per-1M-token rates for `model` (any human-readable form — the
 * resolver normalises). Tries litellm first, then operator's local
 * opencode.jsonc, then returns all zeros.
 *
 * The dashboard doesn't distinguish litellm-source from local-source rows
 * visually (one shared footnote covers both). For v1 the resolver returns
 * only the rates; if a future UI wants per-row provenance we can extend
 * the return type to include the hit-source.
 *
 * Never throws, never returns NaN. Caller can treat `{0,0,0}` as
 * "we don't know the price for this model."
 */
export async function getModelPricing(model: string): Promise<ModelRates> {
  const key = stripDateSnapshot(machineKey(model));
  if (!key) return zero();

  // 1. litellm cache — query with the stripped key so date-snapshot variants
  //    ("gpt-5.6-luna-20250815") resolve to the same row as the base model.
  const cacheRow = await getModelPricingFromCache(key);
  if (nonZero(cacheRow)) {
    return {
      input: cacheRow.input,
      output: cacheRow.output,
      cacheRead: cacheRow.cacheRead,
    };
  }

  // 2. operator's local rates (opencode.jsonc via cost-input.ts) — also
  //    query with the stripped key for the same reason.
  const localInput = getInputCostPerMillion(key);
  const localCacheRead = getCacheReadCostPerMillion(key);
  if (localInput > 0 || localCacheRead > 0) {
    // Locked decision #7: output defaults to input × 4 when the local source
    // doesn't expose an output rate. cost-input.ts today doesn't expose
    // output at all, so this path always uses the multiplier.
    return {
      input: localInput,
      output: localInput * OUTPUT_DEFAULT_MULTIPLIER,
      cacheRead: localCacheRead,
    };
  }

  // 3. empty result — signal-house renders cost as $0 (per locked decision
  // #3) and flags this row as costSource: "unknown" upstream.
  return zero();
}

function zero(): ModelRates {
  return { input: 0, output: 0, cacheRead: 0 };
}

function nonZero(rates: ModelRates): boolean {
  return rates.input > 0 || rates.output > 0 || rates.cacheRead > 0;
}