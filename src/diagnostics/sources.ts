/**
 * /api/diagnostics — lazy endpoint, fetched only when the operator opens the
 * diagnostics panel. Collector/source health + discovered repositories, with
 * the privacy posture applied (private/unknown repo names never surface).
 */

import type { Database } from "bun:sqlite";
import type { RuntimeConfig } from "../config/types";
import { parsedLatestStates } from "../db/latest-state";
import { getRefreshMeta } from "../db/refresh-meta";
import { resolvePrivacyMap, visibleRepoKeys, uncoveredRepos } from "../privacy/privacy";
import { redactConfig } from "../config/redact";
import type { Collector } from "../collectors";
import { getPricingCacheStatus } from "../server/model-pricing-fetcher";
import { getHostMetricsStatus } from "../server/host-metrics-fetcher";

export interface DiagnosticsPayload {
  generatedAt: string;
  pricingCache: {
    lastFetchedAt: string | null;
    lastFetchStatus: "ok" | "failed" | "stale" | "empty";
    modelCount: number;
    source: string;
  };
  hostMetrics: {
    enabled: boolean;
    lastFetchedAt: string | null;
    lastFetchStatus: "ok" | "failed" | "stale" | "empty" | "disabled";
    dayCount: number;
    archiveCount: number;
    source: string;
  };
  sources: Array<{
    id: string;
    title: string;
    tier: string;
    ok: boolean;
    unavailable: boolean;
    capturedAt: number | null;
    durationMs: number | null;
    warnings: string[];
    errors: Array<{ message: string; code: string; retryable: boolean }>;
    stale: boolean;
  }>;
  discoveredRepos: Array<{
    repoKey: string;
    name: string;
    source: string;
    isPrivate: boolean | null;
    present: boolean;
    remoteUrl: string | null;
    githubOwner: string | null;
    githubRepo: string | null;
    localPath: string | null;
    lastSeenAt: string | null;
  }>;
  uncoveredPrivacyRepos: number;
  config: Record<string, unknown>;
}

export function buildDiagnostics(db: Database, config: RuntimeConfig, collectors: Collector[], now: number = Date.now()): DiagnosticsPayload {
  const states = parsedLatestStates(db);

  const bySource = new Map(states.map((s) => [s.source, s]));

  // Repositories across all sources, privacy-resolved.
  const allRepos = states.flatMap((s) => s.data!.repositories);
  const privacyMap = resolvePrivacyMap(allRepos);
  const visible = visibleRepoKeys(privacyMap, config.privacy.showPrivateRepoItems);

  const staleThresholdMs = config.staleness.staleThresholdMinutes * 60_000;

  return {
    generatedAt: new Date(now).toISOString(),
    pricingCache: (() => {
      const status = getPricingCacheStatus();
      return {
        lastFetchedAt: status.lastFetchedAt,
        lastFetchStatus: status.lastFetchStatus,
        modelCount: status.modelCount,
        source: status.source,
      };
    })(),
    hostMetrics: (() => {
      const status = getHostMetricsStatus();
      const enabled = config.hostMetrics.enabled;
      return {
        enabled,
        lastFetchedAt: enabled ? status.lastFetchedAt : null,
        // When disabled the fetcher never ran; report that instead of the
        // module's initial "empty" so operators don't chase a phantom fault.
        lastFetchStatus: enabled ? status.lastFetchStatus : "disabled",
        dayCount: enabled ? status.dayCount : 0,
        archiveCount: enabled ? status.archiveCount : 0,
        source: enabled ? status.source : "",
      };
    })(),
    sources: collectors.map((c) => {
      const state = bySource.get(c.id);
      const capturedAt = state?.capturedAt ?? null;
      return {
        id: c.id,
        title: c.title,
        tier: c.tier,
        ok: state?.ok ?? false,
        unavailable: state?.unavailable ?? true,
        capturedAt,
        durationMs: null, // duration is not persisted in latest_state; refresh_meta has totals
        warnings: state?.warnings ?? [],
        errors: state?.errors ?? [],
        stale: capturedAt === null || now - capturedAt > staleThresholdMs,
      };
    }),
    discoveredRepos: allRepos
      .filter((r) => visible.has(r.repoKey))
      .map((r) => ({
        repoKey: r.repoKey,
        name: r.name,
        source: r.source,
        isPrivate: r.isPrivate,
        present: r.present,
        remoteUrl: r.remoteUrl,
        githubOwner: r.githubOwner,
        githubRepo: r.githubRepo,
        localPath: r.localPath,
        lastSeenAt: r.lastSeenAt,
      }))
      .sort((a, b) => a.repoKey.localeCompare(b.repoKey)),
    uncoveredPrivacyRepos: uncoveredRepos(allRepos, privacyMap),
    config: redactConfig(config),
  };
}

export function lastManualRefreshAt(db: Database): string | null {
  return getRefreshMeta<string | null>(db, "last_manual_refresh_at");
}
