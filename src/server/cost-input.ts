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
 *
 * The operator's opencode.jsonc `models` map is keyed by display name
 * ("DeepSeek-V4-Pro", "MiniMax M3"), not by machine key. So the lookup
 * normalises BOTH the query and the config keys through `machineKey` and
 * resolves against a machine-key index — this is what makes a model like
 * "DeepSeek V4 Pro" (from a collector) match "DeepSeek-V4-Pro" (config).
 */
export function getInputCostPerMillion(model: string): number {
  return resolveModelCost(model).input;
}

/**
 * Return the cache-read cost per 1M tokens for `model` (or 0 if the model
 * has no `cache_read` rate). A missing rate means cache reads are treated
 * as free in the savings estimate — gross avoided input, not net.
 */
export function getCacheReadCostPerMillion(model: string): number {
  return resolveModelCost(model).cacheRead;
}

interface ModelCostEntry {
  cost?: { input?: number; cache_read?: number };
}

interface ResolvedCost {
  input: number;
  cacheRead: number;
}

/** machine-key → model entry index, rebuilt per config load. */
let modelIndex: Map<string, ModelCostEntry> | null = null;

function resolveModelCost(model: string): ResolvedCost {
  const config = loadConfig();
  if (!config) return { input: 0, cacheRead: 0 };

  const models = resolveModels(config);
  const key = machineKey(model);
  if (!key) return { input: 0, cacheRead: 0 };

  // Direct machine-key hit first (in case the config is ever keyed by
  // machine key), then the display-name-normalised index.
  const entry = models[key] ?? (modelIndex ?? buildModelIndex(models)).get(key);
  if (!entry) return { input: 0, cacheRead: 0 };

  const input = typeof entry.cost?.input === "number" && Number.isFinite(entry.cost.input) ? entry.cost.input : 0;
  const cacheRead =
    typeof entry.cost?.cache_read === "number" && Number.isFinite(entry.cost.cache_read) ? entry.cost.cache_read : 0;
  return { input, cacheRead };
}

/**
 * Locate the model cost table in an opencode config.
 *
 * opencode v1.x nests models under `provider.<id>.models` (e.g.
 * `provider.openference.models`), while older configs kept a top-level
 * `models` map. Support both, merging every provider's model table into one
 * so a model defined by any provider resolves.
 */
function resolveModels(config: Record<string, unknown>): Record<string, ModelCostEntry> {
  const top = config.models as Record<string, ModelCostEntry> | undefined;
  if (top && typeof top === "object" && Object.keys(top).length > 0) return top;

  const merged: Record<string, ModelCostEntry> = {};
  const providers = (config.provider ?? config.providers) as Record<string, unknown> | undefined;
  if (providers && typeof providers === "object") {
    for (const entry of Object.values(providers)) {
      if (!entry || typeof entry !== "object") continue;
      const models = (entry as Record<string, unknown>).models as Record<string, ModelCostEntry> | undefined;
      if (models && typeof models === "object") Object.assign(merged, models);
    }
  }
  return merged;
}

function buildModelIndex(models: Record<string, ModelCostEntry>): Map<string, ModelCostEntry> {
  modelIndex = new Map();
  for (const [name, entry] of Object.entries(models)) {
    const k = machineKey(name);
    if (k && !modelIndex.has(k)) modelIndex.set(k, entry);
  }
  return modelIndex;
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
  modelIndex = null;
}

/** Override the opencode config path. Tests use this to load fixtures. */
export function setCostConfigPath(path: string): void {
  configPath = path;
  cachedConfig = undefined;
  modelIndex = null;
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
