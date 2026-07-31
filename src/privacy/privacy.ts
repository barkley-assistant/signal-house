/**
 * Privacy resolution — the fail-closed tri-state contract.
 *
 * `RepositoryPrivacy = true | false | null`; null = unknown. On operator-facing
 * surfaces, unknown and missing entries are treated as private (default-deny).
 * The only opt-in is SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS (default false).
 * API filtering happens server-side only; client-side hiding is insufficient.
 */

import type { PrivacyMap, RepositoryIdentity } from "../shared/types";

/** Build the privacy map; unknown (`null`) resolves to private (fail-closed). */
export function resolvePrivacyMap(repositories: RepositoryIdentity[]): PrivacyMap {
  const map: PrivacyMap = {};
  for (const r of repositories) map[r.repoKey] = r.isPrivate ?? true;
  return map;
}

/**
 * Visibility predicate for attention-queue items. Explicit public only —
 * private, unknown, and missing-map-entry all resolve to hidden.
 */
export function isRepoVisible(repoKey: string, privacyMap: PrivacyMap, showPrivate: boolean): boolean {
  if (showPrivate) return true; // the deliberate operator opt-in overrides the filter
  return privacyMap[repoKey] === false;
}

/** Repo keys visible under the current posture (explicit public only unless opted in). */
export function visibleRepoKeys(privacyMap: PrivacyMap, showPrivate: boolean): Set<string> {
  if (showPrivate) return new Set(Object.keys(privacyMap));
  const out = new Set<string>();
  for (const [key, isPrivate] of Object.entries(privacyMap)) {
    if (isPrivate === false) out.add(key);
  }
  return out;
}

/**
 * Count of repositories with NO privacy-map entry. Mismatches mean the
 * collector is incomplete; only the count is surfaced (never names).
 */
export function uncoveredRepos(repositories: RepositoryIdentity[], privacyMap: PrivacyMap): number {
  let n = 0;
  for (const r of repositories) {
    if (!(r.repoKey in privacyMap)) n++;
  }
  return n;
}
