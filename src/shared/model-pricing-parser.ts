/**
 * Model pricing-table parsers (litellm + OpenRouter).
 *
 * Pure: no I/O. Takes the raw JSON response from a pricing source and
 * returns a normalised { input, output, cacheRead } per 1M tokens for
 * every entry that has usable rates. Entries with missing or non-finite
 * rates are skipped with a debug log line so future "why isn't model X
 * showing up?" investigations have a starting point.
 *
 * Two parsers share one output shape (PricingMap) and the same
 * per-1M convention:
 *   - parseLitellmPricing — litellm's model_prices_and_context_window.json
 *     (historical source; kept for tests + fallback).
 *   - parseOpenRouterPricing — OpenRouter's /api/v1/models (the current
 *     source since 2026-08-26; free + keyless, covers every dashboard
 *     model by machine-key).
 *   - parseOpenferencePricing — openference's /v1/models (the preferred
 *     source since 2026-09-04; authenticated, dated ids kept verbatim).
 *
 * Date-snapshot variants: entries with a trailing date suffix
 * ("…-0731", "…-20250815") keep their own machine key so the resolver
 * can price each variant with its own rates. Two-pass base-claim rule:
 * a dated-only listing (no base listing for its stripped key) ALSO lands
 * under the stripped base key, keeping stripped-key fallback lookups
 * working; a base listing always wins its own key.
 *
 * Litellm stores per-token rates; signal-house displays per-1M. We
 * multiply by 1_000_000 here so the rest of the codebase never has
 * to think about the unit difference.
 *
 * Cache-read rates: litellm exposes the discount under two field
 * names depending on provider — `cache_read_input_token_cost`
 * (Anthropic-style) and `input_cost_per_token_cache_hit`
 * (DeepSeek-style). Both are read; when neither exists the entry
 * has no discounted cache tier, and `cacheRead` falls back to
 * `input` (locked decision #2) — charging cached tokens at the
 * fresh-input rate rather than inventing a discount. OpenRouter
 * exposes the discount directly as `pricing.input_cache_read`; absent
 * that, the same input fallback applies.
 *
 * Collision policy (why "last writer wins" is not enough): litellm
 * lists the same model under many provider routes
 * (azure_ai/x, dashscope/x, fireworks_ai/x, provider-native/x, …).
 * machineKey() collapses those to one key, and their prices differ
 * by 2-3x. The resolver wants the price of the *provider you
 * actually use*. Signal-house can't know that from the pricing file
 * alone, so the parser keeps the **provider-native** entry when one
 * exists (its key has no "/" route prefix and its litellm_provider
 * matches the model's own vendor family), and falls back to the
 * cheapest routed entry otherwise — the price a cost-conscious
 * operator would actually pay. Collisions are logged at debug so
 * "why is model X priced at $Y?" always has an answer in the log.
 */

import { log } from "../shared/logger";
import { machineKey, stripDateSnapshot } from "../shared/models";

/** Per-1M-token rates for one model. All values are USD per 1M tokens. */
export interface LitellmPricing {
  input: number;
  output: number;
  cacheRead: number;
  /** The litellm key this entry was built from (e.g.
   *  "deepseek/deepseek-v4-flash"). Kept so collision debugging can
   *  answer "which upstream row won?" without re-fetching. */
  sourceKey: string;
  /** The winning entry's provider route kind: "native" when the key
   *  had no "/" prefix (provider-native listing), "routed" when it
   *  came from a provider-prefixed route. */
  route: "native" | "routed";
}

/** Map from machine key to per-1M-token rates. */
export type PricingMap = Record<string, LitellmPricing>;

/**
 * Parse the raw litellm JSON into our cache shape.
 *
 * @param json - The result of JSON.parse on the litellm response.
 *               Accepts `unknown` so callers don't have to assert.
 * @returns A map of machine key → per-1M-token rates. Empty `{}` on
 *          any parse failure, malformed input, or filter-out-everything
 *          case — never throws.
 */
export function parseLitellmPricing(json: unknown): PricingMap {
  if (!isPlainObject(json)) return {};

  // First pass: build every candidate entry, grouped by machine key.
  const candidates = new Map<string, Candidate[]>();
  let skippedNoRates = 0;
  let skippedEmptyKey = 0;
  for (const [rawKey, value] of Object.entries(json)) {
    if (!isPlainObject(value)) continue;

    const inputPerToken = numberOr(value.input_cost_per_token, NaN);
    const outputPerToken = numberOr(value.output_cost_per_token, NaN);
    if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
      skippedNoRates++;
      continue;
    }

    // Cache-read discount: two litellm field spellings, provider-dependent.
    // When both are absent the model has no discounted cache tier — fall
    // back to the input rate rather than inventing a number.
    let cacheReadPerToken = inputPerToken;
    const anthropicStyle = value.cache_read_input_token_cost;
    const deepseekStyle = value.input_cost_per_token_cache_hit;
    if (typeof anthropicStyle === "number" && Number.isFinite(anthropicStyle)) {
      cacheReadPerToken = anthropicStyle;
    } else if (typeof deepseekStyle === "number" && Number.isFinite(deepseekStyle)) {
      cacheReadPerToken = deepseekStyle;
    }

    // Keep date-snapshot variants ("…-0731", "…-20250815") under their own
    // machine key so the resolver can price each variant with its own rates.
    // A dated entry whose stripped base key has no base listing additionally
    // claims the base key (base-claim pass below) so stripped-key fallback
    // lookups still resolve — see the module doc for the two-pass rule.
    const key = machineKey(rawKey);
    if (!key) {
      skippedEmptyKey++;
      continue;
    }

    const route: "native" | "routed" = rawKey.includes("/") ? "routed" : "native";
    const entry: Candidate = {
      key,
      rawKey,
      route,
      input: inputPerToken * 1_000_000,
      output: outputPerToken * 1_000_000,
      cacheRead: cacheReadPerToken * 1_000_000,
    };
    const list = candidates.get(key);
    if (list) list.push(entry);
    else candidates.set(key, [entry]);
  }

  // Second pass: resolve each key's winner. Provider-native beats routed
  // (the vendor's own price sheet is what the operator is actually billed
  // against when they configure the provider directly). Within a route
  // kind, cheapest input wins — the operator can always route to the
  // cheapest reseller, so that's the defensible default. Per-entry detail
  // lives in the cache (sourceKey + route); the log carries only counts,
  // because one full-table parse used to produce megabytes of debug lines.
  let collisions = 0;
  const out: PricingMap = {};
  for (const [key, list] of candidates) {
    const natives = list.filter((c) => c.route === "native");
    const pool = natives.length > 0 ? natives : list;
    const winner = pool.reduce((a, b) => (b.input < a.input ? b : a));
    if (list.length > 1) collisions++;
    out[key] = {
      input: winner.input,
      output: winner.output,
      cacheRead: winner.cacheRead,
      sourceKey: winner.rawKey,
      route: winner.route,
    };
  }

  // Dated-only listings also claim their stripped base key (two-pass rule).
  applyBaseClaimFallback(out);

  log.debug(
    "model-pricing-parser",
    `parsed ${out.length} entries` +
      (collisions > 0 ? `, ${collisions} machine-key collisions resolved (winner recorded per entry)` : "") +
      (skippedNoRates > 0 || skippedEmptyKey > 0
        ? `, skipped ${skippedNoRates} without finite rates + ${skippedEmptyKey} with empty keys`
        : ""),
  );
  return out;
}

interface Candidate {
  key: string;
  rawKey: string;
  route: "native" | "routed";
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Base-claim fallback (two-pass rule, D2): after the main parse pass every
 * dated entry lives under its full machine key. A dated entry whose stripped
 * base key was NOT claimed by a base listing also lands under the stripped
 * base key, so the resolver's stripped-key fallback still resolves for
 * models with no base listing (e.g. "gpt-56-luna-20250815" with no
 * "gpt-56-luna"). Base listings always win their own key. When multiple
 * dated variants share a base with no base listing, the cheapest-input one
 * claims it — the same tie-break rule the litellm collision resolver uses.
 */
function applyBaseClaimFallback(out: PricingMap): void {
  const baseKeys = new Set<string>();
  const datedByBase = new Map<string, Array<[string, LitellmPricing]>>();
  for (const [key, entry] of Object.entries(out)) {
    const base = stripDateSnapshot(key);
    if (base === key) {
      baseKeys.add(key);
    } else {
      const list = datedByBase.get(base) ?? [];
      list.push([key, entry]);
      datedByBase.set(base, list);
    }
  }
  for (const [base, variants] of datedByBase) {
    if (baseKeys.has(base)) continue;
    const [, winner] = variants.reduce((a, b) => (b[1].input < a[1].input ? b : a));
    out[base] = { ...winner };
  }
}

/** Returns value if it's a finite number, else fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Returns a finite number from a number OR a numeric string ("0.000000132"),
 *  else fallback. OpenRouter's /api/v1/models ships pricing values as
 *  strings; litellm ships numbers. */
function rateOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Resolve a field's PEAK per-token rate from an OpenRouter pricing object:
 *  the max of the base value and every override's value for that field.
 *  OpenRouter's base is the currently-active tier (peak or off-peak,
 *  time-varying); overrides carry the other tier, so the max is the stable
 *  listed/peak rate regardless of when we fetch. */
function peakRate(pricing: Record<string, unknown>, field: string): number {
  let peak = rateOr(pricing[field], NaN);
  if (Array.isArray(pricing.overrides)) {
    for (const o of pricing.overrides) {
      if (!isPlainObject(o)) continue;
      const r = rateOr(o[field], NaN);
      if (Number.isFinite(r)) peak = Math.max(peak, r);
    }
  }
  return peak;
}

/**
 * Parse the raw OpenRouter /api/v1/models JSON into our cache shape.
 *
 * OpenRouter returns a flat array under `data`, each entry shaped like:
 *   { id: "tencent/hy3", name: "Tencent: Hy3", pricing: { prompt, completion,
 *     input_cache_read, request, ... } }
 * Pricing values are USD **per token** (0.000000132 = $0.132/M), so the
 * same ×1_000_000 normalization applies as in parseLitellmPricing.
 *
 * Field mapping:
 *   pricing.prompt           → input
 *   pricing.completion       → output
 *   pricing.input_cache_read → cacheRead  (fallback: input, no discount listed)
 *
 * Peak/off-peak: OpenRouter's `pricing` base is TIME-VARYING — the base
 * fields already reflect whichever tier is active at fetch time (verified
 * 2026-08-26: tencent/hy3 served peak $0.132 before 16:00 UTC and off-peak
 * $0.0825 after), with `pricing.overrides[]` carrying the other tier. A
 * naive base-only parse would make the dashboard's estimate drift with the
 * refresh hour. We resolve the PEAK tier (max of base + all overrides):
 * stable regardless of fetch time, and the conservative listed rate for a
 * cost guardrail (over-estimate beats under-estimate; day-granular metrics
 * can't attribute tokens to a discount window anyway).
 *
 * Ids are already vendor-prefixed ("vendor/model"); machineKey() strips the
 * prefix + dots, so "tencent/hy3" → "hy3" — matching the dashboard's
 * machine-key lookups with no extra alias table.
 *
 * @param json - The result of JSON.parse on the OpenRouter response.
 * @returns A map of machine key → per-1M-token rates. Empty `{}` on any
 *          parse failure or malformed input — never throws.
 */
export function parseOpenRouterPricing(json: unknown): PricingMap {
  if (!isPlainObject(json) || !Array.isArray(json.data)) return {};

  const out: PricingMap = {};
  let skippedNoRates = 0;
  let skippedEmptyKey = 0;

  for (const entry of json.data) {
    if (!isPlainObject(entry)) continue;
    const rawKey = typeof entry.id === "string" ? entry.id : "";
    if (!rawKey) {
      skippedEmptyKey++;
      continue;
    }
    // Keep date-snapshot variants under their own machine key (same rule
    // as litellm); the base-claim pass below restores the stripped fallback
    // for dated-only listings.
    const key = machineKey(rawKey);
    if (!key) {
      skippedEmptyKey++;
      continue;
    }
    if (!isPlainObject(entry.pricing)) {
      skippedNoRates++;
      continue;
    }
    // OpenRouter's base pricing is time-varying (peak vs off-peak active
    // tier); overrides[] carries the OTHER tier. Resolve the PEAK tier so
    // the cache is stable across fetch hours — see module doc.
    const inputPerToken = peakRate(entry.pricing, "prompt");
    const outputPerToken = peakRate(entry.pricing, "completion");
    if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
      skippedNoRates++;
      continue;
    }
    // OpenRouter's discounted cache-read rate; absent → charge cached
    // tokens at the fresh-input rate (locked decision #2 convention).
    const cacheReadPerToken = peakRate(entry.pricing, "input_cache_read");
    const cacheReadFinal = Number.isFinite(cacheReadPerToken) ? cacheReadPerToken : inputPerToken;

    out[key] = {
      input: inputPerToken * 1_000_000,
      output: outputPerToken * 1_000_000,
      cacheRead: cacheReadFinal * 1_000_000,
      // OpenRouter entries are always "vendor/model" routed listings — there
      // is no provider-native/native vs routed collision to resolve, so mark
      // them routed for parity with the litellm cache shape.
      sourceKey: rawKey,
      route: "routed",
    };
  }

  // Dated-only listings also claim their stripped base key (two-pass rule).
  applyBaseClaimFallback(out);

  log.debug(
    "model-pricing-parser",
    `openrouter parsed ${Object.keys(out).length} entries` +
      (skippedNoRates > 0 || skippedEmptyKey > 0
        ? `, skipped ${skippedNoRates} without finite rates + ${skippedEmptyKey} with empty keys`
        : ""),
  );
  return out;
}

/**
 * Parse the raw openference /v1/models JSON into our cache shape.
 *
 * openference returns a flat array under `data`, each entry shaped like:
 *   { id: "DeepSeek-V4-Flash-0731", pricing: { prompt, completion, cache_read } }
 * Pricing values are USD **per token** strings, so the same ×1_000_000
 * normalization applies as in the other parsers.
 *
 * Field mapping:
 *   pricing.prompt      → input
 *   pricing.completion  → output
 *   pricing.cache_read  → cacheRead  (fallback: prompt, no discount listed)
 *
 * Ids are NOT vendor-prefixed; machineKey() normalises them verbatim, so
 * dated variants like "DeepSeek-V4-Flash-0731" keep their own key — no
 * strip, no base aliasing (aliasing would wrongly price the bare model at
 * the dated rate, violating the resolution-order decision D1). Zero rates
 * are kept (free models; the resolver's nonZero gate falls through to
 * OpenRouter anyway). quota_multiplier / promo fields are ignored —
 * pricing.prompt is already the billed per-token rate.
 *
 * @param json - The result of JSON.parse on the openference response.
 * @returns A map of machine key → per-1M-token rates. Empty `{}` on any
 *          parse failure or malformed input — never throws.
 */
export function parseOpenferencePricing(json: unknown): PricingMap {
  if (!isPlainObject(json) || !Array.isArray(json.data)) return {};

  const out: PricingMap = {};
  let skippedNoRates = 0;
  let skippedEmptyKey = 0;

  for (const entry of json.data) {
    if (!isPlainObject(entry)) continue;
    const rawKey = typeof entry.id === "string" ? entry.id : "";
    if (!rawKey) {
      skippedEmptyKey++;
      continue;
    }
    // Verbatim machine key — dated variants keep their own key (D2).
    const key = machineKey(rawKey);
    if (!key) {
      skippedEmptyKey++;
      continue;
    }
    if (!isPlainObject(entry.pricing)) {
      skippedNoRates++;
      continue;
    }
    const inputPerToken = rateOr(entry.pricing.prompt, NaN);
    const outputPerToken = rateOr(entry.pricing.completion, NaN);
    if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
      skippedNoRates++;
      continue;
    }
    // Discounted cache-read rate; absent → charge cached tokens at the
    // fresh-input rate (locked decision #2 convention).
    const cacheReadPerToken = rateOr(entry.pricing.cache_read, inputPerToken);

    out[key] = {
      input: inputPerToken * 1_000_000,
      output: outputPerToken * 1_000_000,
      cacheRead: cacheReadPerToken * 1_000_000,
      // openference ids carry no vendor prefix — native by construction.
      sourceKey: rawKey,
      route: "native",
    };
  }

  log.debug(
    "model-pricing-parser",
    `openference parsed ${Object.keys(out).length} entries` +
      (skippedNoRates > 0 || skippedEmptyKey > 0
        ? `, skipped ${skippedNoRates} without finite rates + ${skippedEmptyKey} with empty keys`
        : ""),
  );
  return out;
}

/** Narrow `unknown` to a plain object record. Returns false for
 *  arrays, null, primitives, and objects with non-own properties. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
