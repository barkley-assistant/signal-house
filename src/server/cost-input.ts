/**
 * Server-side cost.input lookup for cache savings estimation.
 *
 * Normalises the raw model name through src/shared/model-map.json
 * (machine key), then reads `cost.input` per model from the operator's
 * opencode config. The config is read once per process and cached; a missing
 * or invalid rate yields savings of 0, never NaN.
 *
 * Collectors are NOT involved — this lives at the dashboard layer so the
 * opencode collector cost contract (#6) is untouched.
 */

import { readFileSync } from "node:fs";
import { machineKey } from "../shared/models";

let configPath = `${process.env.HOME ?? process.env.USERPROFILE}/.config/opencode/opencode.jsonc`;

let cachedConfig: Record<string, unknown> | null | undefined;

/**
 * Return the input cost per 1M tokens for `model` (or 0 if unavailable).
 * The lookup first tries the model's normalised machine key, then the raw
 * model name, in the operator's opencode.jsonc `models` map.
 */
export function getInputCostPerMillion(model: string): number {
  const config = loadConfig();
  if (!config) return 0;

  const models = (config.models as Record<string, { cost?: { input?: number } }> | undefined) ?? {};
  const key = machineKey(model);
  const entry = key ? models[key] ?? models[model] : models[model];
  const rate = entry?.cost?.input;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : 0;
}

function loadConfig(): Record<string, unknown> | null {
  if (cachedConfig !== undefined) return cachedConfig;
  try {
    const text = readFileSync(configPath, "utf-8");
    cachedConfig = parseJsonc(text) as Record<string, unknown>;
  } catch {
    cachedConfig = null;
  }
  return cachedConfig;
}

/** Reset the process-lifetime config cache. Used by tests that point
 *  `configPath` at a fixture file. */
export function resetCostConfigCache(): void {
  cachedConfig = undefined;
}

/** Override the opencode config path. Tests use this to load fixtures. */
export function setCostConfigPath(path: string): void {
  configPath = path;
  cachedConfig = undefined;
}

/** Minimal JSONC parser: strips line comments and C-style block comments
 *  without touching string contents, then falls back to standard JSON.parse. */
function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\"") {
      // Copy string verbatim, honouring escapes.
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out);
}
