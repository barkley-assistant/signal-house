"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard";
import { HealthSignalCard } from "@/components/HealthSignalCard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { SectionState, useSectionState } from "@/components/section-state";
import { StatusStrip } from "@/components/StatusStrip";
import { ModelUsageRankList } from "@/components/ModelUsageRankList";
import { TrendCard } from "@/components/TrendCard";
import type {
  DashboardWindowCards,
  DashboardWindowDay,
  DashboardWindowSessionUsageSummary,
  IssueMetric,
  PullRequestMetric,
} from "@/types";
import type { EChartsOption } from "echarts-for-react";

const SourceHealthSection = dynamic(
  () =>
    import("@/components/SourceHealthSection").then(
      (m) => m.SourceHealthSection,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl ring-1 ring-foreground/10 bg-card py-4">
        <div className="px-4 space-y-2">
          <div className="h-4 w-1/3 animate-pulse rounded bg-card-hover" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-card-hover" />
        </div>
      </div>
    ),
  },
);

type TypeFilter = "issues" | "prs" | "all";
type ConditionFilter = "stale" | "blocked" | "failing" | "all";
type SortMode = "oldest" | "urgent";

type AttentionItem = {
  id: string;
  kind: "issue" | "pr";
  title: string;
  repo: string;
  ageDays: number;
  priorityTier: "stale" | "ci-failing" | "ci-blocked" | "ci-pending";
  statusLabel: string;
};

const STALE_THRESHOLD_DAYS_FALLBACK = 14;

function daysSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((nowMs - ts) / (1000 * 60 * 60 * 24)));
}

function deriveAttentionItems(
  issues: IssueMetric[],
  pullRequests: PullRequestMetric[],
  nowMs: number,
  staleThresholdDays: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const issue of issues) {
    if (issue.state !== "open") continue;
    const ageDays = daysSince(issue.updatedAt, nowMs);
    const isStale = ageDays >= staleThresholdDays;
    items.push({
      id: `issue-${issue.id}`,
      kind: "issue",
      title: issue.title,
      repo: issue.repoKey,
      ageDays,
      priorityTier: isStale ? "stale" : "ci-pending",
      statusLabel: isStale ? "Stale" : "Active",
    });
  }

  for (const pr of pullRequests) {
    if (pr.state !== "open") continue;
    const ageDays = daysSince(pr.updatedAt, nowMs);
    const isStale = ageDays >= staleThresholdDays;
    let priorityTier: AttentionItem["priorityTier"];
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
      repo: pr.repoKey,
      ageDays,
      priorityTier,
      statusLabel,
    });
  }

  return items;
}

function throughputStatus(status: string | undefined): "healthy" | "warning" | "critical" | "empty" | "unknown" {
  if (!status) return "unknown";
  if (status === "available") return "healthy";
  if (status === "partial") return "warning";
  if (status === "stale") return "warning";
  if (status === "empty") return "empty";
  return "critical";
}

function cycleTimeStatus(card: { medianDays: number | null; averageDays: number | null; status: string } | undefined): "healthy" | "warning" | "critical" | "empty" | "unknown" {
  if (!card) return "unknown";
  if (card.status === "unavailable" || card.status === "error" || card.status === "unconfigured") return "critical";
  if (card.status === "empty") return "empty";
  const days = card.medianDays ?? card.averageDays;
  if (days == null) return "empty";
  if (days <= 3) return "healthy";
  if (days <= 7) return "warning";
  return "critical";
}

function ciStatus(card: { passRate: number | null; status: string } | undefined): "healthy" | "warning" | "critical" | "empty" | "unknown" {
  if (!card) return "unknown";
  if (card.status === "unavailable" || card.status === "error" || card.status === "unconfigured") return "critical";
  if (card.status === "empty") return "empty";
  if (card.passRate == null) return "empty";
  if (card.passRate >= 0.9) return "healthy";
  if (card.passRate >= 0.7) return "warning";
  return "critical";
}

function staleWorkStatus(card: { staleIssues: number; stalePrs: number; status: string } | undefined): "healthy" | "warning" | "critical" | "empty" | "unknown" {
  if (!card) return "unknown";
  if (card.status === "unavailable" || card.status === "error" || card.status === "unconfigured") return "critical";
  if (card.status === "empty") return "empty";
  const total = card.staleIssues + card.stalePrs;
  if (total === 0) return "healthy";
  if (total <= 3) return "warning";
  return "critical";
}

function overallScore(cards: DashboardWindowCards | null): number {
  if (!cards) return 0;
  let score = 0;
  if (throughputStatus(cards.throughput.status) === "healthy") score += 1;
  if (cycleTimeStatus(cards.cycleTime) === "healthy") score += 1;
  if (ciStatus(cards.ci) === "healthy") score += 1;
  if (staleWorkStatus(cards.staleWork) === "healthy") score += 1;
  return score;
}

function overallLabel(score: number): string {
  if (score >= 4) return "Healthy";
  if (score >= 3) return "Fair";
  if (score >= 2) return "Watch";
  if (score >= 1) return "At Risk";
  return "Critical";
}

function overallStatus(score: number): "healthy" | "warning" | "critical" | "empty" | "unknown" {
  if (score >= 4) return "healthy";
  if (score >= 2) return "warning";
  if (score >= 1) return "critical";
  return "empty";
}

const typeOptions: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "issues", label: "Issues" },
  { value: "prs", label: "PRs" },
];

const conditionOptions: Array<{ value: ConditionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "stale", label: "Stale" },
  { value: "blocked", label: "Blocked" },
  { value: "failing", label: "Failing" },
];

const sortOptions: Array<{ value: SortMode; label: string }> = [
  { value: "urgent", label: "Most urgent" },
  { value: "oldest", label: "Oldest first" },
];

function loadFilter<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = window.sessionStorage.getItem(key);
  return value === null ? fallback : (value as T);
}

function formatDayLabel(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function buildThroughputOption(days: DashboardWindowDay[]): EChartsOption | null {
  const nonNull = days.filter((d) => !d.isGap && d.metrics);
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const values = days.map((d) =>
    d.isGap ? null : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0),
  );
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: { fontSize: 10, color: "#64748b" },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#38bdf8", width: 2 },
        itemStyle: { color: "#38bdf8" },
        areaStyle: { color: "rgba(56,189,248,0.12)" },
      },
    ],
  };
}

function buildCycleTimeOption(days: DashboardWindowDay[]): EChartsOption | null {
  // Backend #152 will provide rolling 14-day medianCycleTimeDays per day.
  // Until then we use the per-day medianCycleTimeDays from DailyMetricsRow.
  const nonNull = days.filter(
    (d) => !d.isGap && d.metrics?.medianCycleTimeDays != null,
  );
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const values = days.map((d) =>
    d.isGap ? null : (d.metrics?.medianCycleTimeDays ?? null),
  );
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: { fontSize: 10, color: "#64748b" },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { color: "#a78bfa", width: 2 },
        itemStyle: { color: "#a78bfa" },
        areaStyle: { color: "rgba(167,139,250,0.12)" },
      },
    ],
  };
}

function buildCIOption(days: DashboardWindowDay[]): EChartsOption | null {
  const nonNull = days.filter((d) => !d.isGap && d.metrics);
  if (nonNull.length === 0) return null;
  const labels = days.map((d) => formatDayLabel(d.day));
  const passCounts = days.map((d) => (d.isGap ? null : (d.metrics?.ciPassCount ?? 0)));
  const failCounts = days.map((d) => (d.isGap ? null : (d.metrics?.ciFailCount ?? 0)));
  return {
    grid: { top: 8, right: 8, bottom: 20, left: 36, containLabel: false },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#64748b" },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      axisLabel: { fontSize: 10, color: "#64748b" },
    },
    tooltip: {
      backgroundColor: "#1a1d24",
      borderColor: "#262a33",
      textStyle: { color: "#f1f5f9", fontSize: 12 },
    },
    series: [
      {
        name: "Passed",
        type: "bar",
        stack: "ci",
        data: passCounts,
        itemStyle: { color: "#4ade80" },
        barMaxWidth: 12,
      },
      {
        name: "Failed",
        type: "bar",
        stack: "ci",
        data: failCounts,
        itemStyle: { color: "#f87171" },
        barMaxWidth: 12,
      },
    ],
  };
}

function computeThroughputFooter(days: DashboardWindowDay[]): string {
  if (days.length < 2) return "Insufficient data";
  const mid = Math.floor(days.length / 2);
  const prev = days.slice(0, mid);
  const curr = days.slice(mid);
  const prevSum = prev.reduce(
    (s, d) => s + (d.isGap ? 0 : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0)),
    0,
  );
  const currSum = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : (d.metrics?.issuesClosed ?? 0) + (d.metrics?.prsMerged ?? 0)),
    0,
  );
  const pctChange = prevSum > 0 ? ((currSum - prevSum) / prevSum) * 100 : 0;
  const arrow = pctChange >= 0 ? "\u2191" : "\u2193";
  const pctStr = prevSum > 0 ? `${Math.abs(Math.round(pctChange))}%` : "\u2014";
  return `${arrow}${pctStr} from last window \u00B7 ${currSum} this window`;
}

function computeCycleTimeFooter(days: DashboardWindowDay[]): string {
  const nonNull = days.filter(
    (d) => !d.isGap && d.metrics?.medianCycleTimeDays != null,
  );
  if (nonNull.length < 3) return "Insufficient PR data for cycle time trend";
  const latest = nonNull[nonNull.length - 1].metrics!.medianCycleTimeDays!;
  // Trend: compare first half vs second half. Down = improving for cycle time.
  const mid = Math.floor(nonNull.length / 2);
  const firstHalf = nonNull.slice(0, mid);
  const secondHalf = nonNull.slice(mid);
  const firstAvg =
    firstHalf.reduce((s, d) => s + (d.metrics?.medianCycleTimeDays ?? 0), 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((s, d) => s + (d.metrics?.medianCycleTimeDays ?? 0), 0) / secondHalf.length;
  const trend =
    secondAvg < firstAvg ? "Improving" : secondAvg > firstAvg ? "Slowing" : "Steady";
  return `Daily median \u00B7 ${latest.toFixed(1)}d latest \u00B7 ${trend} over window`;
}

function computeCIFooter(days: DashboardWindowDay[]): string {
  if (days.length < 2) return "Insufficient data";
  const mid = Math.floor(days.length / 2);
  const curr = days.slice(mid);
  const totalRuns = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciTotalRuns ?? 0),
    0,
  );
  const passCount = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciPassCount ?? 0),
    0,
  );
  const failCount = curr.reduce(
    (s, d) => s + (d.isGap ? 0 : d.metrics?.ciFailCount ?? 0),
    0,
  );
  const passRate = totalRuns > 0 ? Math.round((passCount / totalRuns) * 100) : 0;
  return `${passRate}% pass rate \u00B7 ${failCount} failures this window`;
}

export default function Home() {
  const {
    data,
    isLoading,
    error,
    selectedRepoKey,
    hasEverLoaded,
    manualRefreshStatus,
    manualRefreshErrorTimestamp,
    fetch,
    manualRefresh,
    triggerAutoRefresh,
    clearManualRefreshError,
  } = useDashboardStore();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => loadFilter("sh-queue-type", "all"));
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(() => loadFilter("sh-queue-cond", "all"));
  const [sortMode, setSortMode] = useState<SortMode>(() => loadFilter("sh-queue-sort", "urgent"));
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!hasEverLoaded && !isLoading) {
      fetch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-type", typeFilter);
  }, [typeFilter]);

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-cond", conditionFilter);
  }, [conditionFilter]);

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-sort", sortMode);
  }, [sortMode]);

  useEffect(() => {
    const interval = setInterval(() => {
      triggerAutoRefresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [triggerAutoRefresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const repoState = useSectionState({
    isLoading: !hasEverLoaded && isLoading,
    error,
    isEmpty: !data && hasEverLoaded,
  });

  const snapshotIssues = useMemo<IssueMetric[]>(
    () => data?.snapshot?.issues ?? [],
    [data],
  );

  const snapshotPullRequests = useMemo<PullRequestMetric[]>(
    () => data?.snapshot?.pullRequests ?? [],
    [data],
  );

  const staleThresholdDays = useMemo<number>(
    () => data?.snapshot?.aggregates?.staleWork?.staleThresholdDays ?? STALE_THRESHOLD_DAYS_FALLBACK,
    [data],
  );

  const attentionItems = useMemo<AttentionItem[]>(
    () => deriveAttentionItems(snapshotIssues, snapshotPullRequests, now, staleThresholdDays),
    [snapshotIssues, snapshotPullRequests, now, staleThresholdDays],
  );

  const filteredItems = useMemo(() => {
    let result = [...attentionItems];

    if (typeFilter === "issues") result = result.filter((item) => item.kind === "issue");
    if (typeFilter === "prs") result = result.filter((item) => item.kind === "pr");
    if (conditionFilter === "stale") result = result.filter((item) => item.priorityTier === "stale");
    if (conditionFilter === "blocked") result = result.filter((item) => item.priorityTier === "ci-blocked");
    if (conditionFilter === "failing") result = result.filter((item) => item.priorityTier === "ci-failing");

    result.sort((a, b) => (sortMode === "oldest" ? b.ageDays - a.ageDays : a.ageDays - b.ageDays));

    return result.slice(0, 20);
  }, [attentionItems, conditionFilter, sortMode, typeFilter]);

  const isFiltered = typeFilter !== "all" || conditionFilter !== "all" || sortMode !== "urgent";

  const attentionState = useSectionState({
    isLoading: !hasEverLoaded && isLoading,
    error,
    isEmpty: filteredItems.length === 0 && !isFiltered,
  });

  const sessionUsage = useMemo<DashboardWindowSessionUsageSummary | null>(
    () => data?.dashboardWindow?.sessionUsage ?? null,
    [data],
  );

  const cards = useMemo<DashboardWindowCards | null>(
    () => data?.dashboardWindow?.cards ?? null,
    [data],
  );

  const healthSummaryLoading = !hasEverLoaded && isLoading;
  const healthSummaryError = cards == null ? error : null;

  const modelUsageState = useSectionState({
    isLoading: !hasEverLoaded && isLoading,
    error,
    isEmpty: false,
  });

  const isRefreshingNow = isLoading || manualRefreshStatus === "running";
  const showErrorBanner = manualRefreshStatus === "failed" && manualRefreshErrorTimestamp !== null && now - manualRefreshErrorTimestamp < 8000;

  return (
    <main id="main-content" className="container mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Dashboard controls">
        <header className="mb-8">
          <h1
            className="text-3xl font-bold tracking-tight text-text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Signal House
          </h1>
          <p className="mt-2 text-base text-text-secondary font-body">Developer activity dashboard scaffold</p>
        </header>

        <section aria-label="Headline health summary" className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <HealthSignalCard
            label="Throughput"
            value={
              cards
                ? cards.throughput.issuesClosed + cards.throughput.prsMerged
                : null
            }
            unit="items"
            trend="neutral"
            status={throughputStatus(cards?.throughput.status)}
            detail={
              cards
                ? `${cards.throughput.totalCommits} commits in window`
                : null
            }
            loading={healthSummaryLoading}
            error={healthSummaryError}
          />
          <HealthSignalCard
            label="Cycle Time"
            value={
              cards?.cycleTime.medianDays != null
                ? cards.cycleTime.medianDays.toFixed(1)
                : cards?.cycleTime.averageDays != null
                  ? cards.cycleTime.averageDays.toFixed(1)
                  : null
            }
            unit="d"
            trend="neutral"
            status={cycleTimeStatus(cards?.cycleTime)}
            detail={
              cards
                ? cards.cycleTime.p95Days != null
                  ? `P95: ${cards.cycleTime.p95Days.toFixed(1)}d · ${cards.cycleTime.sampleSize} items`
                  : `${cards.cycleTime.sampleSize} items`
                : null
            }
            loading={healthSummaryLoading}
            error={healthSummaryError}
          />
          <HealthSignalCard
            label="CI Health"
            value={
              cards?.ci.passRate != null
                ? Math.round(cards.ci.passRate * 100)
                : null
            }
            unit="%"
            trend="neutral"
            status={ciStatus(cards?.ci)}
            detail={
              cards
                ? `${cards.ci.failCount} failures in ${cards.ci.totalRuns} runs`
                : null
            }
            loading={healthSummaryLoading}
            error={healthSummaryError}
          />
          <HealthSignalCard
            label="Stale Work"
            value={
              cards
                ? cards.staleWork.staleIssues + cards.staleWork.stalePrs
                : null
            }
            unit="items"
            trend="neutral"
            status={staleWorkStatus(cards?.staleWork)}
            detail={
              cards
                ? `${cards.staleWork.staleIssues} issues · ${cards.staleWork.stalePrs} PRs`
                : null
            }
            loading={healthSummaryLoading}
            error={healthSummaryError}
          />
          <HealthSignalCard
            label="Overall Health"
            value={overallLabel(overallScore(cards))}
            trend="neutral"
            status={overallStatus(overallScore(cards))}
            detail={
              cards
                ? `${overallScore(cards)}/4 signals healthy`
                : null
            }
            loading={healthSummaryLoading}
            error={healthSummaryError}
          />
        </section>
      </nav>

      <StatusStrip />

      <AnimatePresence>
        {showErrorBanner && (
          <motion.div
            key="error-banner"
            role="alert"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="mt-2 overflow-hidden rounded-lg border border-status-error/30"
            style={{ backgroundColor: "rgba(248, 113, 113, 0.08)" }}
          >
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span style={{ color: "var(--color-status-error)" }}>
                {error ?? "Refresh failed"}
              </span>
              <button
                type="button"
                onClick={() => clearManualRefreshError()}
                className="text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none rounded px-1.5 py-0.5"
                style={{ color: "var(--color-text-muted)" }}
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section aria-label="Repository and status" className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-card-border bg-card-bg transition-colors hover:bg-card-hover">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-text-primary">
              Repository
              <Badge variant="secondary" className="text-xs">
                {selectedRepoKey}
              </Badge>
            </CardTitle>
            <CardDescription>Current repository context</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionState
              state={repoState}
              section="health"
              errorMessage={error ?? undefined}
              onRetry={() => fetch()}
              minHeight="24px"
            >
              <p className="text-sm text-text-secondary">Data loaded</p>
            </SectionState>
          </CardContent>
        </Card>

        <Card className="border-card-border bg-card-bg transition-colors hover:bg-card-hover">
          <CardHeader>
            <CardTitle className="text-text-primary">Status</CardTitle>
            <CardDescription>System health overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Poller</span>
              <Badge variant="outline" className="border-divider text-text-muted">Enabled</Badge>
            </div>
            <Separator className="bg-divider" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Last refresh</span>
              <span className="text-sm text-text-muted">Never</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-card-border bg-card-bg transition-colors hover:bg-card-hover">
          <CardHeader>
            <CardTitle className="text-text-primary">Actions</CardTitle>
            <CardDescription>Dashboard controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="default"
              size="sm"
              className="w-full bg-accent-primary hover:bg-accent-primary/80"
              onClick={() => manualRefresh()}
              disabled={isRefreshingNow}
            >
              {isRefreshingNow && <RefreshCw className="size-3.5 animate-spin" />}
              {isRefreshingNow ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-divider text-text-secondary hover:bg-card-hover"
              onClick={() => {
                document
                  .getElementById("source-health-section")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              View Diagnostics
            </Button>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Health summary" className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Health Summary</CardTitle>
            <CardDescription>Key metrics at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionState
              state={repoState}
              section="health"
              errorMessage={error ?? undefined}
              onRetry={() => fetch()}
              minHeight="100px"
            >
              <div className="grid grid-cols-5 gap-3">
                {["Issues", "PRs", "CI Runs", "Stale", "Sessions"].map((label) => (
                  <div key={label} className="flex flex-col gap-1 rounded-lg border border-card-border bg-card-bg p-3">
                    <span className="text-xs text-text-muted">{label}</span>
                    <span className="text-lg font-semibold text-text-primary">—</span>
                  </div>
                ))}
              </div>
            </SectionState>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Trend charts" className="mt-6">
        {(() => {
          const days = data?.dashboardWindow?.days ?? [];
          const trendLoading = !hasEverLoaded && isLoading;
          const trendEmpty = days.length === 0;
          const throughputOption = trendEmpty ? null : buildThroughputOption(days);
          const cycleTimeOption = trendEmpty ? null : buildCycleTimeOption(days);
          const ciOption = trendEmpty ? null : buildCIOption(days);
          const throughputFooter = trendEmpty ? "" : computeThroughputFooter(days);
          const cycleTimeFooter = trendEmpty ? "" : computeCycleTimeFooter(days);
          const ciFooter = trendEmpty ? "" : computeCIFooter(days);
          return (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TrendCard
                title="Throughput"
                option={throughputOption}
                footer={throughputFooter}
                loading={trendLoading}
                isEmpty={trendEmpty}
                emptyMessage="No throughput data in this window"
              />
              <TrendCard
                title="Cycle Time"
                option={cycleTimeOption}
                footer={cycleTimeFooter}
                loading={trendLoading}
                isEmpty={trendEmpty}
                emptyMessage="Insufficient PR data for cycle time trend"
              />
              <TrendCard
                title="CI Health"
                option={ciOption}
                footer={ciFooter}
                loading={trendLoading}
                isEmpty={trendEmpty}
                emptyMessage="No CI data in this window"
              />
            </div>
          );
        })()}
      </section>

      <section aria-label="Attention queue" className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Attention Queue</CardTitle>
            <CardDescription>
              Simple filters and sort modes for stale and blocked work
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex gap-2 rounded-lg bg-card-hover p-2" role="group" aria-label="Type filter">
                  {typeOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={typeFilter === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", typeFilter === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      aria-pressed={typeFilter === opt.value}
                      onClick={() => setTypeFilter(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setTypeFilter(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-2 rounded-lg bg-card-hover p-2" role="group" aria-label="Condition filter">
                  {conditionOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={conditionFilter === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", conditionFilter === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      aria-pressed={conditionFilter === opt.value}
                      onClick={() => setConditionFilter(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setConditionFilter(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-2 rounded-lg bg-card-hover p-2" role="group" aria-label="Sort mode">
                  {sortOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={sortMode === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", sortMode === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      aria-pressed={sortMode === opt.value}
                      onClick={() => setSortMode(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSortMode(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {!isFiltered ? null : (
                <p className="text-base text-text-muted">Filters are active.</p>
              )}
            </div>

            <SectionState
              state={attentionState}
              section="attention"
              errorMessage={error ?? undefined}
              onRetry={() => fetch()}
              minHeight="200px"
            >
              <div className="space-y-2">
                {filteredItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-divider px-4 py-6 text-base text-text-muted">
                    No items match this filter. Try broadening your filter.
                  </p>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border border-card-border bg-card-bg px-4 py-3 transition-colors hover:bg-card-hover md:flex-row md:items-center md:justify-between"
                      aria-label={`${item.kind === "issue" ? "Issue" : "Pull request"}: ${item.title}, ${item.ageDays} days old, status: ${item.statusLabel}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{item.kind === "issue" ? "Issue" : "PR"}</Badge>
                          <span className="text-sm font-medium text-text-primary">{item.title}</span>
                        </div>
                        <p className="text-xs text-text-muted">{item.repo}</p>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-text-muted">
                        <span className="font-mono tabular-nums">{item.ageDays}d</span>
                        <Badge variant="outline" className="border-divider text-text-muted">
                          {item.statusLabel}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SectionState>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Ranked model usage" className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Model Usage</CardTitle>
            <CardDescription>
              Ranked by cost and token volume
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SectionState
              state={modelUsageState}
              section="model-usage"
              errorMessage={error ?? undefined}
              onRetry={() => fetch()}
              minHeight="160px"
            >
              <ModelUsageRankList sessionUsage={sessionUsage} />
            </SectionState>
          </CardContent>
        </Card>
      </section>

      <section aria-label="Source health diagnostics" id="source-health-section" className="mt-6 scroll-mt-6">
        <SourceHealthSection />
      </section>

      <footer className="mt-8 text-center text-sm text-text-muted">
        <p>Scaffold complete. Tailwind v4 + shadcn/ui + ECharts + Zustand</p>
      </footer>
    </main>
  );
}
