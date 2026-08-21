/**
 * Daily delivery metrics — per-day CI pass-rate + commit count + PR-merged count.
 * Derived from latest_state (no extra collectors, no schema changes); consumers
 * group the raw collector arrays by UTC date. Days with no activity still get
 * a row (zeros), so the chart x-axis is dense and ECharts has no gaps.
 */
import type { Database } from "bun:sqlite";
import { parsedLatestStates } from "../db/latest-state";
import { utcDay, utcDayFromMs } from "../shared/dates";

export interface DeliveryCiPoint {
  totalRuns: number;
  passCount: number;
  failCount: number;
  /** pass / (pass + fail); null when no terminal runs that day. */
  passRate: number | null;
}

export interface DeliveryPoint {
  date: string; // YYYY-MM-DD
  ci: DeliveryCiPoint | null;
  commits: number;
  prsMerged: number;
}

export interface DeliveryTrend {
  from: string;
  to: string;
  days: number;
  points: DeliveryPoint[];
}

/** Build the per-day delivery trend for the window [from, to] (inclusive). */
export function buildDeliveryTrend(db: Database, from: string, to: string): DeliveryTrend {
  const states = parsedLatestStates(db);
  const github = states.find((s) => s.source === "github")?.data ?? null;
  const git = states.find((s) => s.source === "git")?.data ?? null;

  // CI: github.workflowRuns[].createdAt → UTC day.
  const ciByDay = new Map<string, { pass: number; fail: number }>();
  for (const run of github?.workflowRuns ?? []) {
    if (!run?.createdAt) continue;
    // Skip in-flight runs (no conclusion yet) so the denominator stays terminal-only.
    if (run.conclusion !== "success" && run.conclusion !== "failure") continue;
    const day = run.createdAt.slice(0, 10);
    if (day < from || day > to) continue;
    const slot = ciByDay.get(day) ?? { pass: 0, fail: 0 };
    if (run.conclusion === "success") slot.pass += 1;
    else slot.fail += 1;
    ciByDay.set(day, slot);
  }

  // PRs merged: github.pullRequests[].mergedAt → UTC day.
  const prsByDay = new Map<string, number>();
  for (const pr of github?.pullRequests ?? []) {
    if (!pr?.mergedAt) continue;
    const day = pr.mergedAt.slice(0, 10);
    if (day < from || day > to) continue;
    prsByDay.set(day, (prsByDay.get(day) ?? 0) + 1);
  }

  // Commits: git.commitsByDay is already keyed by YYYY-MM-DD.
  const commitsByDay: Record<string, number> = git?.commitsByDay ?? {};

  // Dense day list — every day in [from, to] gets a row, even if empty.
  const points: DeliveryPoint[] = [];
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const date = utcDayFromMs(ms);
    const ciSlot = ciByDay.get(date);
    const totalRuns = ciSlot ? ciSlot.pass + ciSlot.fail : 0;
    const ci: DeliveryCiPoint | null = totalRuns > 0
      ? {
          totalRuns,
          passCount: ciSlot!.pass,
          failCount: ciSlot!.fail,
          passRate: totalRuns > 0 ? ciSlot!.pass / totalRuns : null,
        }
      : null;
    points.push({
      date,
      ci,
      commits: commitsByDay[date] ?? 0,
      prsMerged: prsByDay.get(date) ?? 0,
    });
  }

  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  return { from, to, days, points };
}

/** Re-export for callers that want the same anchor other handlers use. */
export { utcDay };