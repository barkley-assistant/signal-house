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
  /** null = no commit telemetry for this day (renders as a gap, never 0). */
  commits: number | null;
  /** null = no PR-merge telemetry for this day (renders as a gap, never 0). */
  prsMerged: number | null;
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

  // Commits: git.commitsByDay is already keyed by YYYY-MM-DD. Treat absence
  // as "unknown" (null), never 0 — the chart should render a gap, not a zero
  // bar. A missing day on `commitsByDay` means we have no commit telemetry
  // for that day, not that there were zero commits.
  const commitsByDay: Record<string, number> = git?.commitsByDay ?? {};

  // Dense day list — every day in [from, to] gets a row, even if empty.
  // CI uses null on days with no terminal runs (pass-rate is genuinely
  // undefined when the denominator is zero). Commits + PRs use null when we
  // have no signal that day so the chart shows a gap instead of a false zero.
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
    // Only surface commit/PR counts for days we actually have signal for.
    // A day absent from commitsByDay is "no telemetry" — not zero activity.
    const hasCommitSignal = Object.prototype.hasOwnProperty.call(commitsByDay, date);
    const hasPrSignal = prsByDay.has(date);
    points.push({
      date,
      ci,
      commits: hasCommitSignal ? (commitsByDay[date] ?? 0) : null,
      prsMerged: hasPrSignal ? (prsByDay.get(date) ?? 0) : null,
    });
  }

  const days = Math.round((endMs - startMs) / 86_400_000) + 1;
  return { from, to, days, points };
}

/** Re-export for callers that want the same anchor other handlers use. */
export { utcDay };