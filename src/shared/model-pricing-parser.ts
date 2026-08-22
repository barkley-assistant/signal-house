/**
 * Litellm pricing-table parser.
 *
 * Pure: no I/O. Takes the raw JSON response from litellm's
 * `model_prices_and_context_window.json`, returns a normalised
 * { input, output, cacheRead } per 1M tokens for every OpenAI
 * entry that has usable rates. Non-OpenAI entries are filtered out.
 * Entries with missing or non-finite rates are skipped silently
 * (a debug log line is emitted so future "why isn't model X
 * showing up?" investigations have a starting point).
 *
 * Pricing source:
 * https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 *
 * Litellm stores per-token rates; signal-house displays per-1M. We
 * multiply by 1_000_000 here so the rest of the codebase never has
 * to think about the unit difference.
 *
 * `cacheRead` falls back to `input` when the entry has no
 * `cache_read_input_token_cost` — locked decision #2.
 */

import { log } from "../shared/logger";
import { machineKey } from "../shared/models";

/** Per-1M-token rates for one model. All values are USD per 1M tokens. */
export interface LitellmPricing {
  input: number;
  output: number;
  cacheRead: number;
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

  const out: PricingMap = {};
  for (const [rawKey, value] of Object.entries(json)) {
    if (!isPlainObject(value)) continue;
    if (value.litellm_provider !== "openai") continue;

    const inputPerToken = numberOr(value.input_cost_per_token, NaN);
    const outputPerToken = numberOr(value.output_cost_per_token, NaN);
    if (!Number.isFinite(inputPerToken) || !Number.isFinite(outputPerToken)) {
      log.debug(
        "model-pricing-parser",
        `skip ${rawKey}: missing or non-finite rates (input=${value.input_cost_per_token}, output=${value.output_cost_per_token})`,
      );
      continue;
    }

    // cacheRead fallback: explicit cache_read rate, else input rate.
    const cacheReadPerToken = numberOr(value.cache_read_input_token_cost, inputPerToken);
    if (!Number.isFinite(cacheReadPerToken)) {
      log.debug("model-pricing-parser", `skip ${rawKey}: non-finite cache_read`);
      continue;
    }

    const key = machineKey(rawKey);
    if (!key) continue;

    out[key] = {
      input: inputPerToken * 1_000_000,
      output: outputPerToken * 1_000_000,
      cacheRead: cacheReadPerToken * 1_000_000,
    };
  }
  return out;
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