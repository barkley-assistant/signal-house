/**
 * Derive daily_metrics rows from collected source data.
 *
 * Semantics: rows are only produced for days where the source observed
 * something — absence stays absence (contract #9, no synthetic zero-row days).
 * A `value: null` row is written when the source had activity that day but the
 * value is unknown (e.g. cost telemetry missing) — contract #5. The caller
 * (orchestrator) writes the current UTC day as replace, older days as
 * insert-or-ignore so they stay intact.
 */

import type { CollectorId, DailyWrite, SourceData } from "../shared/types";

export function deriveDailyRows(source: CollectorId, data: SourceData): DailyWrite[] {
  const days = new Map<string, Map<string, DailyWrite>>();

  function bump(day: string, metric: string, value: number | null, tags: Record<string, string | null> = {}): void {
    if (!day) return;
    let metrics = days.get(day);
    if (!metrics) {
      metrics = new Map();
      days.set(day, metrics);
    }
    const key = `${metric}\u0000${JSON.stringify(tags)}`;
    const existing = metrics.get(key);
    if (existing) {
      existing.value = (existing.value ?? 0) + (value ?? 0);
    } else {
      metrics.set(key, { date: day, metric, value, tags });
    }
  }

  if (source === "github") {
    for (const issue of data.issues) {
      bump(issue.createdAt.slice(0, 10), "issues.opened", 1);
      if (issue.closedAt) bump(issue.closedAt.slice(0, 10), "issues.closed", 1);
    }
    for (const pr of data.pullRequests) {
      bump(pr.createdAt.slice(0, 10), "prs.created", 1);
      if (pr.mergedAt) bump(pr.mergedAt.slice(0, 10), "prs.merged", 1);
    }
    const ciPerDay = new Map<string, { runs: number; pass: number; fail: number }>();
    for (const run of data.workflowRuns) {
      const day = run.createdAt.slice(0, 10);
      const entry = ciPerDay.get(day) ?? { runs: 0, pass: 0, fail: 0 };
      entry.runs++;
      if (run.conclusion === "success") entry.pass++;
      if (run.conclusion === "failure") entry.fail++;
      ciPerDay.set(day, entry);
    }
    for (const [day, ci] of ciPerDay) {
      bump(day, "ci.total_runs", ci.runs);
      bump(day, "ci.pass_count", ci.pass);
      bump(day, "ci.fail_count", ci.fail);
      bump(day, "ci.pass_rate", ci.runs > 0 ? ci.pass / ci.runs : null);
    }
  }

  if (source === "git") {
    for (const [day, count] of Object.entries(data.commitsByDay)) {
      bump(day, "commits.total", count);
    }
  }

  if (source === "hermes" || source === "opencode") {
    for (const day of data.usage?.byDay ?? []) {
      bump(day.date, "sessions.total", day.sessions);
      bump(day.date, "messages.total", day.messages);
      bump(day.date, "tokens.input", day.tokensInput);
      bump(day.date, "tokens.output", day.tokensOutput);
      bump(day.date, "tokens.cache_read", day.tokensCacheRead);
      bump(day.date, "tokens.cache_write", day.tokensCacheWrite);
      bump(day.date, "tokens.reasoning", day.tokensReasoning);
      bump(day.date, "cost.total", day.cost);
    }
  }

  const out: DailyWrite[] = [];
  for (const metrics of days.values()) {
    for (const row of metrics.values()) out.push(row);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
