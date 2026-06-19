"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { useDashboardStore } from "@/store/dashboard";
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

const attentionItems: AttentionItem[] = [
  {
    id: "issue-1",
    kind: "issue",
    title: "Queue rows need keyboard focus and a clearer hover state",
    repo: "barkley-clawd/signal-house",
    ageDays: 18,
    priorityTier: "stale",
    statusLabel: "Stale",
  },
  {
    id: "pr-2",
    kind: "pr",
    title: "Fix flaky diagnostics refresh",
    repo: "barkley-clawd/signal-house",
    ageDays: 6,
    priorityTier: "ci-failing",
    statusLabel: "CI failing",
  },
  {
    id: "pr-3",
    kind: "pr",
    title: "Replace dashboard scaffold with actual summaries",
    repo: "barkley-clawd/signal-house",
    ageDays: 12,
    priorityTier: "ci-blocked",
    statusLabel: "CI blocked",
  },
  {
    id: "issue-4",
    kind: "issue",
    title: "Add filter persistence to attention queue",
    repo: "barkley-clawd/signal-house",
    ageDays: 9,
    priorityTier: "ci-pending",
    statusLabel: "CI pending",
  },
];

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

function TestChart() {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = echarts.init(chartRef.current, "dark");

    chart.setOption({
      backgroundColor: "transparent",
      title: { text: "Sample Activity", textStyle: { color: "#f1f5f9" } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        axisLine: { lineStyle: { color: "#262a33" } },
        axisLabel: { color: "#94a3b8" },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: "#262a33" } },
        axisLabel: { color: "#94a3b8" },
        splitLine: { lineStyle: { color: "#1e2128" } },
      },
      series: [
        {
          data: [120, 200, 150, 80, 70, 110, 130],
          type: "bar",
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "#38bdf8" },
              { offset: 1, color: "rgba(56, 189, 248, 0.2)" },
            ]),
          },
        },
      ],
    });

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  }, []);

  return <div ref={chartRef} className="h-64 w-full" />;
}

export default function Home() {
  const { data, isLoading, error, selectedRepoKey, fetch } =
    useDashboardStore();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(() => loadFilter("sh-queue-type", "all"));
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>(() => loadFilter("sh-queue-cond", "all"));
  const [sortMode, setSortMode] = useState<SortMode>(() => loadFilter("sh-queue-sort", "urgent"));

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-type", typeFilter);
  }, [typeFilter]);

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-cond", conditionFilter);
  }, [conditionFilter]);

  useEffect(() => {
    window.sessionStorage.setItem("sh-queue-sort", sortMode);
  }, [sortMode]);

  const repoState = useSectionState({
    isLoading,
    error,
    isEmpty: !data,
  });

  const filteredItems = useMemo(() => {
    let result = [...attentionItems];

    if (typeFilter === "issues") result = result.filter((item) => item.kind === "issue");
    if (typeFilter === "prs") result = result.filter((item) => item.kind === "pr");
    if (conditionFilter === "stale") result = result.filter((item) => item.priorityTier === "stale");
    if (conditionFilter === "blocked") result = result.filter((item) => item.priorityTier === "ci-blocked");
    if (conditionFilter === "failing") result = result.filter((item) => item.priorityTier === "ci-failing");

    result.sort((a, b) => (sortMode === "oldest" ? b.ageDays - a.ageDays : a.ageDays - b.ageDays));

    return result.slice(0, 20);
  }, [conditionFilter, sortMode, typeFilter]);

  const isFiltered = typeFilter !== "all" || conditionFilter !== "all" || sortMode !== "urgent";

  const attentionState = useSectionState({
    isLoading,
    error,
    isEmpty: filteredItems.length === 0 && !isFiltered,
  });

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1
          className="text-3xl font-bold tracking-tight text-text-primary"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Signal House
        </h1>
        <p className="mt-2 text-text-secondary">Developer activity dashboard scaffold</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-card-border bg-card-bg transition-colors hover:bg-card-hover">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-text-primary">
              Repository
              <Badge variant="secondary" className="text-xs">
                {selectedRepoKey}
              </Badge>
            </CardTitle>
            <CardDescription className="text-text-muted">Current repository context</CardDescription>
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
            <CardDescription className="text-text-muted">System health overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Poller</span>
              <Badge variant="outline" className="border-divider text-text-muted">Disabled</Badge>
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
            <CardDescription className="text-text-muted">Dashboard controls</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="default"
              size="sm"
              className="w-full bg-accent-primary hover:bg-accent-primary/80"
              onClick={() => fetch()}
              disabled={isLoading}
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-divider text-text-secondary hover:bg-card-hover"
            >
              View Diagnostics
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Health Summary</CardTitle>
            <CardDescription className="text-text-muted">Key metrics at a glance</CardDescription>
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
      </div>

      <div className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Trend Chart</CardTitle>
            <CardDescription className="text-text-muted">Activity over time</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionState
              state={repoState}
              section="trends"
              errorMessage={error ?? undefined}
              onRetry={() => fetch()}
              minHeight="180px"
            >
              <TestChart />
            </SectionState>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card className="border-card-border bg-card-bg">
          <CardHeader>
            <CardTitle className="text-text-primary">Attention Queue</CardTitle>
            <CardDescription className="text-text-muted">
              Simple filters and sort modes for stale and blocked work
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <div className="flex gap-1 rounded-lg bg-card-hover p-1">
                  {typeOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={typeFilter === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", typeFilter === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      onClick={() => setTypeFilter(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setTypeFilter(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-1 rounded-lg bg-card-hover p-1">
                  {conditionOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={conditionFilter === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", conditionFilter === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      onClick={() => setConditionFilter(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setConditionFilter(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-1 rounded-lg bg-card-hover p-1">
                  {sortOptions.map((opt) => (
                    <Badge
                      key={opt.value}
                      variant={sortMode === opt.value ? "default" : "outline"}
                      className={cn("cursor-pointer px-3 py-1", sortMode === opt.value ? "text-primary-foreground" : "text-text-secondary")}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSortMode(opt.value)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSortMode(opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  ))}
                </div>
              </div>

              {!isFiltered ? null : (
                <p className="text-sm text-text-muted">Filters are active.</p>
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
                  <p className="rounded-lg border border-dashed border-divider px-4 py-6 text-sm text-text-muted">
                    No items match this filter. Try broadening your filter.
                  </p>
                ) : (
                  filteredItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border border-card-border bg-card-bg px-4 py-3 transition-colors hover:bg-card-hover md:flex-row md:items-center md:justify-between"
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
      </div>

      <footer className="mt-8 text-center text-sm text-text-muted">
        <p>Scaffold complete. Tailwind v4 + shadcn/ui + ECharts + Zustand</p>
      </footer>
    </div>
  );
}
