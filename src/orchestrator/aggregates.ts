/**
 * Derived aggregates for the state response — computed on demand from the
 * latest per-source data (no aggregates table; the source data IS the state).
 */

import type { PersistedState } from "../config/types";
import type { RuntimeConfig } from "../config/types";
import { avg, median, percentile, sum } from "../shared/math";
import { utcDaysAgo, utcDay } from "../shared/dates";

export interface UsageAggregate {
  totalSessions: number;
  totalMessages: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  bySource: Record<string, { sessions: number; cost: number | null; tokens: number | null }>;
  byModel: Array<{ model: string; provider: string | null; sessions: number; cost: number | null; tokens: number | null }>;
}

export interface Aggregates {
  window: { start: string; end: string; days: number };
  throughput: { issuesOpened: number; issuesClosed: number; prsCreated: number; prsMerged: number; totalCommits: number } | null;
  cycleTime: { avgSeconds: number | null; medianSeconds: number | null; p95Seconds: number | null; sampleSize: number } | null;
  ci: { totalRuns: number; passCount: number; failCount: number; passRate: number | null } | null;
  staleWork: { staleIssues: number; stalePrs: number; thresholdDays: number } | null;
  usage: UsageAggregate | null;
}

export function computeAggregates(states: PersistedState[], config: RuntimeConfig): Aggregates {
  const end = utcDay();
  const start = utcDaysAgo(config.orchestrator.lookbackDays);
  const window = { start, end, days: config.orchestrator.lookbackDays };

  const github = states.find((s) => s.source === "github")?.data ?? null;
  const git = states.find((s) => s.source === "git")?.data ?? null;
  const usageStates = states.filter((s) => (s.data?.usage?.byDay.length ?? 0) > 0);

  // Throughput — counts inside the window (issues/PRs from github, commits from git).
  const inWindow = (iso: string | null): boolean => !!iso && iso.slice(0, 10) >= start && iso.slice(0, 10) <= end;
  const throughput = github
    ? {
        issuesOpened: github.issues.filter((i) => inWindow(i.createdAt)).length,
        issuesClosed: github.issues.filter((i) => inWindow(i.closedAt)).length,
        prsCreated: github.pullRequests.filter((p) => inWindow(p.createdAt)).length,
        prsMerged: github.pullRequests.filter((p) => inWindow(p.mergedAt)).length,
        totalCommits: windowCommits(git, start, end),
      }
    : null;

  // Cycle time — merged PRs: mergedAt − createdAt (seconds).
  const merged = (github?.pullRequests ?? []).filter((p) => p.mergedAt && p.createdAt);
  const cycleTimes = merged.map((p) => (Date.parse(p.mergedAt!) - Date.parse(p.createdAt)) / 1000);
  const cycleTime =
    merged.length > 0
      ? {
          avgSeconds: avg(cycleTimes),
          medianSeconds: median(cycleTimes),
          p95Seconds: percentile(cycleTimes, 95),
          sampleSize: cycleTimes.length,
        }
      : null;

  // CI — workflow runs inside the window.
  const runs = (github?.workflowRuns ?? []).filter((w) => inWindow(w.createdAt));
  const passCount = runs.filter((w) => w.conclusion === "success").length;
  const failCount = runs.filter((w) => w.conclusion === "failure").length;
  const ci =
    runs.length > 0
      ? {
          totalRuns: runs.length,
          passCount,
          failCount,
          passRate: passCount + failCount > 0 ? passCount / (passCount + failCount) : null,
        }
      : null;

  // Stale work — open items untouched past the threshold.
  const thresholdMs = Date.now() - config.staleness.staleThresholdDays * 86_400_000;
  const staleIssues = (github?.issues ?? []).filter((i) => i.state === "open" && Date.parse(i.updatedAt) < thresholdMs).length;
  const stalePrs = (github?.pullRequests ?? []).filter((p) => p.state === "open" && Date.parse(p.updatedAt) < thresholdMs).length;
  const staleWork =
    github !== null
      ? { staleIssues, stalePrs, thresholdDays: config.staleness.staleThresholdDays }
      : null;

  // Usage — combined across hermes + opencode.
  const usage =
    usageStates.length > 0
      ? {
          totalSessions: sum(usageStates.map((s) => s.data?.usage?.byDay.reduce((a, d) => a + d.sessions, 0) ?? null)) ?? 0,
          totalMessages: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.map((d) => d.messages) ?? []))),
          totalTokens: sum(
            usageStates.map((s) =>
              sum(s.data?.usage?.byDay.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]) ?? []),
            ),
          ),
          totalCost: sum(usageStates.map((s) => sum(s.data?.usage?.byDay.map((d) => d.cost) ?? []))),
          bySource: Object.fromEntries(
            usageStates.map((s) => [
              s.source,
              {
                sessions: s.data!.usage!.byDay.reduce((a, d) => a + d.sessions, 0),
                cost: sum(s.data!.usage!.byDay.map((d) => d.cost)),
                tokens: sum(
                  s.data!.usage!.byDay.flatMap((d) => [d.tokensInput, d.tokensOutput, d.tokensCacheRead, d.tokensCacheWrite, d.tokensReasoning]),
                ),
              },
            ]),
          ),
          byModel: combineModels(usageStates),
        }
      : null;

  return { window, throughput, cycleTime, ci, staleWork, usage };
}

function windowCommits(git: NonNullable<PersistedState["data"]> | null, start: string, end: string): number {
  if (!git) return 0;
  let total = 0;
  for (const [day, count] of Object.entries(git.commitsByDay)) {
    if (day >= start && day <= end) total += count;
  }
  return total;
}

/** Merge per-source byModel rows across sources (cost-null-safe). */
function combineModels(states: PersistedState[]): UsageAggregate["byModel"] {
  const map = new Map<string, { model: string; provider: string | null; sessions: number; cost: number | null; tokens: number | null }>();
  for (const s of states) {
    for (const row of s.data!.usage!.byModel) {
      const key = `${row.provider ?? ""}/${row.model}`;
      const existing = map.get(key);
      if (existing) {
        existing.sessions += row.sessions;
        existing.cost = mergeNullSum(existing.cost, row.cost);
        existing.tokens = mergeNullSum(existing.tokens, rowTokens(row));
      } else {
        map.set(key, {
          model: row.model,
          provider: row.provider,
          sessions: row.sessions,
          cost: row.cost,
          tokens: rowTokens(row),
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
}

function rowTokens(row: { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; reasoningTokens: number | null }): number | null {
  return sum([row.inputTokens, row.outputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.reasoningTokens]);
}

function mergeNullSum(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
