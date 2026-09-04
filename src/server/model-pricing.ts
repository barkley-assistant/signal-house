/**
 * Model pricing resolver — priority chain openference → openrouter → local → empty.
 *
 * Public surface for the rest of signal-house. Single async function,
 * `getModelPricing(model)`, that resolves to per-1M-token rates.
 *
 * Priority chain (2026-09-04 — openference added as the PREFERRED source:
 * the operator bills through openference, so its authenticated /v1/models
 * rates win over OpenRouter's):
 *   1. Pricing cache (in-memory, populated by the fetcher on startup + per
 *      refresh). Two sources — openference first, OpenRouter second; the
 *      source priority lives inside the fetcher's getModelPricing.
 *   2. Operator's local rates from ~/.config/opencode/opencode.jsonc,
 *      read via the existing `getInputCostPerMillion()` / `getCacheReadCostPerMillion()`
 *      helpers in `src/server/cost-input.ts`. Output rate is NOT exposed
 *      by those helpers — locked decision #7 says fall back to input × 4
 *      when output is missing.
 *   3. Empty result `{ input: 0, output: 0, cacheRead: 0 }`. Never NaN.
 *
 * Lookup order per model (D1): machineKey normalisation runs first, then the
 * resolver tries the FULL (possibly dated) key — "deepseek-v4-flash-0731" —
 * before the stripped base key ("deepseek-v4-flash"). A dated variant that
 * exists in a source is authoritative for itself; the stripped key is a
 * fallback only (dated-only listings land under both keys at parse time).
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
 * Pre-fetch rates for a batch of model keys. Returns a Map keyed by
 * machine key (lowercase + dot-stripped). Use this in callers that need
 * sync access to rates — the aggregator runs sync, calls this once per
 * refresh, then looks up per-row without awaiting.
 *
 * Dedupes by FULL machine key — dated variants keep their own key, so a
 * dated spelling and its base resolve as separate entries when both exist
 * (the variant split; the resolver prices each with its own rates). Empty
 * input returns an empty map. Never throws.
 */
export async function fetchAllRates(modelKeys: readonly string[]): Promise<Map<string, ModelRates>> {
  const uniq = new Set<string>();
  for (const raw of modelKeys) {
    const k = machineKey(raw);
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
 * resolver normalises). Tries OpenRouter first, then operator's local
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
  const full = machineKey(model);
  const stripped = stripDateSnapshot(full);
  if (!full) return zero();

  // 1. Pricing cache — try the FULL (possibly dated) key first, then the
  //    stripped base key as a fallback. A dated variant that exists in a
  //    source is authoritative for itself; the stripped key is consulted
  //    only when the dated lookup missed everywhere (D1).
  const cacheRow = await getModelPricingFromCache(full);
  if (nonZero(cacheRow)) {
    return {
      input: cacheRow.input,
      output: cacheRow.output,
      cacheRead: cacheRow.cacheRead,
    };
  }
  if (stripped !== full) {
    const strippedRow = await getModelPricingFromCache(stripped);
    if (nonZero(strippedRow)) {
      return {
        input: strippedRow.input,
        output: strippedRow.output,
        cacheRead: strippedRow.cacheRead,
      };
    }
  }

  // 2. operator's local rates (opencode.jsonc via cost-input.ts) — query
  //    with the FULL key; cost-input strips a date suffix internally as its
  //    own fallback, so a dated model still resolves to the base entry when
  //    the config has no explicit dated block.
  const localInput = getInputCostPerMillion(full);
  const localCacheRead = getCacheReadCostPerMillion(full);
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