/**
 * Model name normalisation + family mapping.
 *
 * Sources (hermes, opencode) report the same model under many
 * spellings and vendor prefixes. We reduce every raw name to a stable
 * machine key (lowercase, vendor prefix stripped, non-alphanumeric → `-`)
 * for grouping and lookup. The `model-map.json` file maps machine keys to
 * friendly labels and families — edit THAT file to add or fix model names.
 *
 * Workflow when a new model appears:
 * 1. Look at the raw names in the dashboard (under "By model")
 * 2. Add a new entry to `models[]` in `model-map.json` with the right
 *    machine key, label, and family
 * 3. Redeploy — no code changes needed
 */

import modelMap from "./model-map.json";

type ModelEntry = { machine: string; label: string; family?: string; costInput?: number };
type FamilyPrefix = { prefix: string; family: string };

const MODELS = modelMap.models as ModelEntry[];
const FAMILY_PREFIXES = modelMap.familyPrefixes as FamilyPrefix[];

// Build lookups once at import time (the map is small, this is negligible).
const BY_MACHINE = new Map<string, ModelEntry>(MODELS.map((m) => [m.machine, m]));

/**
 * Cache savings convention (issue #352):
 * The operator deliberately sets `cost.cache.read = 0` for every model in
 * their pricing, so the dashboard cannot compute "savings" by multiplying
 * cache reads by a cache-read rate. Instead, savings are estimated as
 * `cache_read × cost.input / 1e6` — i.e. the input-equivalent cost the
 * cached reads would have incurred had they been billed at the full input
 * rate. The `costInput` field in model-map.json supplies the per-million
 * input USD rate for each model. Models without a `costInput` (or with a
 * zero rate) render "—" for $ saved — the documented fallback when the
 * operator hasn't populated the rate yet.
 */
export function costInputForModel(raw: string): number | null {
  const key = machineKey(raw);
  if (!key) return null;
  const entry = BY_MACHINE.get(key);
  if (!entry) return null;
  const rate = entry.costInput;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

/** Normalise a raw model name → stable machine key for grouping & lookup.
 *  Strips vendor prefixes ("openrouter/deepseek/…" → "…"), lowercases,
 *  strips dots, replaces remaining non-alphanumeric with `-`, collapses. */
export function machineKey(raw: string): string {
  const s = raw.trim().toLowerCase();
  const parts = s.split("/");
  const body = parts.length > 1 ? parts[parts.length - 1] : s;
  return body
    .replace(/\./g, "") // dots stripped entirely ("GLM-5.2" → "glm-52")
    .replace(/[^a-z0-9]+/g, "-") // spaces/underscores/dashes → single dash
    .replace(/^-+|-+$/g, "");
}

/** Friendly label for display: curated from model-map.json, title-case
 *  fallback if the model is not yet in the map. */
export function modelLabel(raw: string): string {
  const key = machineKey(raw);
  if (!key) return raw.trim();
  const entry = BY_MACHINE.get(key);
  if (entry) return entry.label;
  // Fallback: title-case each word, separators → single spaces
  return raw
    .trim()
    .split("/")
    .pop()!
    .replace(/[_\s-]+/g, " ")
    .trim()
    .replace(/\b([a-z0-9])/g, (c: string) => c.toUpperCase());
}

/** Human family label (DeepSeek, z.ai, Moonshot, …) or null. Checks the
 *  model map first, then falls back to prefix matching. */
export function modelFamily(raw: string): string | null {
  const key = machineKey(raw);
  if (!key) return null;
  const entry = BY_MACHINE.get(key);
  if (entry?.family) return entry.family;
  for (const { prefix, family } of FAMILY_PREFIXES) {
    if (key.startsWith(prefix)) return family;
  }
  return null;
}