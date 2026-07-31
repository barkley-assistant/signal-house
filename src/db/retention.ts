/**
 * Retention — runs safely and predictably at startup and after each refresh.
 *
 * Sessions and workflow runs live inside `snapshots.data` JSON in the V2
 * schema, so the sessions/workflow retention knobs constrain snapshot pruning
 * (documented in the traceability doc, C11).
 */

import type { Database } from "bun:sqlite";
import { pruneSnapshots } from "./snapshots";
import { pruneDailyMetrics } from "./daily-metrics";
import { utcDaysAgo } from "../shared/dates";
import type { RuntimeConfig } from "../config/types";

export interface RetentionReport {
  prunedSnapshots: number;
  prunedDailyMetrics: number;
}

export function runRetention(db: Database, config: RuntimeConfig): RetentionReport {
  const now = Date.now();

  // Snapshot retention is the strictest of the raw-data knobs (snapshots carry
  // raw issue/PR/workflow/session payloads; daily_metrics is the long archive).
  const snapshotCutoffMs = now - config.retention.snapshotsDays * 86_400_000;

  const prunedSnapshots = pruneSnapshots(db, snapshotCutoffMs);
  const prunedDailyMetrics = pruneDailyMetrics(db, utcDaysAgo(config.retention.dailyMetricsDays));

  return { prunedSnapshots, prunedDailyMetrics };
}
