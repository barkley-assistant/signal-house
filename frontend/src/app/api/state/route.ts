import { NextResponse } from "next/server";
import { getLatestState, getDailyMetricsRange, getDailyTokenUsageRange } from "../../../../../server/db/client";
import { buildDashboardWindow } from "../../../../../server/lib/dashboard-state";
import { getDashboardWindowDays } from "../../../../../server/lib/runtime-config";
import { ensureDb } from "../_lib/ensure-db";
import type { DashboardAttentionItem, DashboardStateResponse, IssueMetric, PullRequestMetric } from "@/types";

const STALE_THRESHOLD_DAYS_FALLBACK = 14;

function daysSince(dateStr: string, nowMs: number): number {
  const updated = new Date(dateStr).getTime();
  if (Number.isNaN(updated)) return 0;
  return Math.max(0, Math.floor((nowMs - updated) / 86_400_000));
}

function buildAttentionItems(
  issues: IssueMetric[],
  pullRequests: PullRequestMetric[],
  nowMs: number,
  staleThresholdDays: number,
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];

  for (const issue of issues) {
    if (issue.state !== "open") continue;
    const ageDays = daysSince(issue.updatedAt, nowMs);
    const isStale = ageDays >= staleThresholdDays;
    items.push({
      id: `issue-${issue.id}`,
      kind: "issue",
      title: issue.title,
      repo: issue.repo,
      ageDays,
      priorityTier: isStale ? "stale" : "ci-pending",
      statusLabel: isStale ? "Stale" : "Active",
    });
  }

  for (const pr of pullRequests) {
    if (pr.state !== "open") continue;
    const ageDays = daysSince(pr.updatedAt, nowMs);
    const isStale = ageDays >= staleThresholdDays;
    let priorityTier: DashboardAttentionItem["priorityTier"];
    let statusLabel: string;

    if (pr.ciStatus === "failure") {
      priorityTier = "ci-failing";
      statusLabel = "CI failing";
    } else if (pr.ciStatus === "pending") {
      priorityTier = isStale ? "stale" : "ci-pending";
      statusLabel = isStale ? "Stale" : "CI pending";
    } else if (isStale) {
      priorityTier = "stale";
      statusLabel = "Stale";
    } else {
      priorityTier = "ci-pending";
      statusLabel = "Active";
    }

    items.push({
      id: `pr-${pr.id}`,
      kind: "pr",
      title: pr.title,
      repo: pr.repo,
      ageDays,
      priorityTier,
      statusLabel,
    });
  }

  return items;
}

export async function GET() {
  try {
    await ensureDb();

    const state = getLatestState();

    const windowDays = getDashboardWindowDays();
    const endDay = new Date().toISOString().slice(0, 10);
    const startDate = new Date(`${endDay}T00:00:00Z`);
    startDate.setUTCDate(startDate.getUTCDate() - (windowDays - 1));
    const startDay = startDate.toISOString().slice(0, 10);

    const rows = getDailyMetricsRange(startDay, endDay);
    const tokenUsageDays = getDailyTokenUsageRange(startDay, endDay);
    const sessionUsageAggregate = state.snapshot?.aggregates?.sessionUsage ?? null;
    const staleThresholdDays =
      state.snapshot?.aggregates?.staleWork?.staleThresholdDays ?? STALE_THRESHOLD_DAYS_FALLBACK;

    const dashboardWindow = buildDashboardWindow(
      rows,
      new Date(),
      state.isStale,
      sessionUsageAggregate,
    );

    const body: DashboardStateResponse = {
      window: {
        startDay: dashboardWindow.startDay,
        endDay: dashboardWindow.endDay,
        days: dashboardWindow.days,
        missingDays: dashboardWindow.missingDays,
        latestDay: dashboardWindow.latestDay,
        coverage: dashboardWindow.coverage,
        warnings: dashboardWindow.warnings,
      },
      summary: dashboardWindow.cards,
      usage: {
        sessionUsage: dashboardWindow.sessionUsage,
        tokenUsage: state.snapshot?.aggregates?.tokenUsage ?? null,
        tokenUsageDays,
      },
      attention: {
        staleThresholdDays,
        items: buildAttentionItems(
          state.snapshot?.issues ?? [],
          state.snapshot?.pullRequests ?? [],
          Date.now(),
          staleThresholdDays,
        ),
      },
      status: {
        lastRefreshAt: state.lastRefreshAt,
        lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt,
        refreshInProgress: state.refreshInProgress,
        isStale: state.isStale,
        staleReason: state.staleReason,
        pollerEnabled: state.pollerEnabled,
        refreshStatus: state.refreshStatus,
        lastFailureAt: state.lastFailureAt,
        lastSuccessAt: state.lastSuccessAt,
        nextRunAt: state.nextRunAt,
        refreshState: state.refreshState,
      },
      diagnostics: state.diagnostics,
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[api/state] failed to build state response:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
