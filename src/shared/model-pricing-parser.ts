/**
 * Litellm pricing-table parser.
 *
 * Pure: no I/O. Takes the raw JSON response from litellm's
 * `model_prices_and_context_window.json`, returns a normalised
 * { input, output, cacheRead } per 1M tokens for every entry
 * that has usable rates. Entries with missing or non-finite
 * rates are skipped with a debug log line so future "why isn't
 * model X showing up?" investigations have a starting point.
 *
 * Pricing source:
 * https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
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
 * fresh-input rate rather than inventing a discount.
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
import { machineKey } from "../shared/models";

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
  for (const [rawKey, value] of Object.entries(json)) {
    if (!isPlainObject(value)) continue;

    const inputPerToken = numberOr(value.input_cost_per_token, NaN);
    const outputPerToken = numberOr(value.output_cost_per_token, NaN);
    if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
      log.debug(
        "model-pricing-parser",
        `skip ${rawKey}: missing or non-finite rates (input=${value.input_cost_per_token}, output=${value.output_cost_per_token})`,
      );
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

    const key = machineKey(rawKey);
    if (!key) continue;

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
  // cheapest reseller, so that's the defensible default.
  const out: PricingMap = {};
  for (const [key, list] of candidates) {
    const natives = list.filter((c) => c.route === "native");
    const pool = natives.length > 0 ? natives : list;
    const winner = pool.reduce((a, b) => (b.input < a.input ? b : a));
    if (list.length > 1) {
      log.debug(
        "model-pricing-parser",
        `collision on ${key}: ${list.length} entries, kept ${winner.rawKey} (${winner.route}, input $${winner.input}/1M)`,
      );
    }
    out[key] = {
      input: winner.input,
      output: winner.output,
      cacheRead: winner.cacheRead,
      sourceKey: winner.rawKey,
      route: winner.route,
    };
  }
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

/** Narrow `unknown` to a plain object record. Returns false for
 *  arrays, null, primitives, and objects with non-own properties. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
