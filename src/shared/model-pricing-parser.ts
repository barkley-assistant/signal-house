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

    // Collapse date-snapshot variants ("…-0731", "…-20250815") into their
    // base key at parse time, matching the resolver's lookup key exactly.
    // Without this the cache grows dead entries (a dated variant with no
    // base listing keeps a reseller's sheet under a key nothing ever
    // looks up) and the cache file misleads audits. A dated variant that
    // is the ONLY listing still lands under its base key — which is the
    // key the dashboard queries.
    const key = stripDateSnapshot(machineKey(rawKey));
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
 * Peak/off-peak: OpenRouter's `pricing.overrides[]` encodes a cheaper
 * off-peak window (e.g. tencent/hy3 at 16:00–00:00 UTC). Intentionally
 * ignored — the dashboard's daily_metrics are day-granular, so we can't
 * know which tokens fell in the discount window; using the peak/listed
 * rate is the conservative, stable baseline (over-estimate beats
 * under-estimate for a cost guardrail).
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
    // Collapse date-snapshot variants into their base key at parse time,
    // matching the resolver's lookup key exactly (same rule as litellm).
    const key = stripDateSnapshot(machineKey(rawKey));
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
    // OpenRouter's discounted cache-read rate; absent → charge cached
    // tokens at the fresh-input rate (locked decision #2 convention).
    const cacheReadPerToken = rateOr(entry.pricing.input_cache_read, inputPerToken);

    out[key] = {
      input: inputPerToken * 1_000_000,
      output: outputPerToken * 1_000_000,
      cacheRead: cacheReadPerToken * 1_000_000,
      // OpenRouter entries are always "vendor/model" routed listings — there
      // is no provider-native/native vs routed collision to resolve, so mark
      // them routed for parity with the litellm cache shape.
      sourceKey: rawKey,
      route: "routed",
    };
  }

  log.debug(
    "model-pricing-parser",
    `openrouter parsed ${Object.keys(out).length} entries` +
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
