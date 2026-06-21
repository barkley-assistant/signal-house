"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Activity } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionState, useSectionState } from "@/components/section-state";
import type { SourceDiagnostics } from "@/types";

type SourceHealth = SourceDiagnostics["sourceHealth"][string];

const STORAGE_KEY = "sh-diagnostics-open";

type DashboardDiagnostics = SourceDiagnostics | null;

function loadExpanded(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(STORAGE_KEY) === "true";
}

function saveExpanded(open: boolean) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, String(open));
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

function formatDurationMs(durationMs: number | null | undefined): string {
  if (durationMs == null) return "—";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)}s`;
}

const healthDot: Record<SourceHealth["status"], string> = {
  healthy: "bg-status-success",
  degraded: "bg-status-warning",
  failed: "bg-status-error",
  unknown: "bg-status-neutral",
};

function getBadgeClasses(status: SourceHealth["status"]) {
  return cn(
    "cursor-pointer border px-2 py-1 text-xs font-medium transition-colors",
    status === "healthy" && "bg-status-success/10 text-status-success border-status-success/20",
    status === "degraded" && "bg-status-warning/10 text-status-warning border-status-warning/20",
    status === "failed" && "bg-status-error/10 text-status-error border-status-error/20",
    status === "unknown" && "bg-status-neutral/10 text-status-neutral border-status-neutral/20",
  );
}

function isEmptyDiagnostics(diagnostics: DashboardDiagnostics) {
  return !diagnostics || Object.keys(diagnostics.sourceHealth ?? {}).length === 0;
}

export function SourceHealthSection() {
  const dashboardDiagnostics = useDashboardStore((state) => state.diagnostics);
  const dataDiagnostics = useDashboardStore((state) => state.data?.diagnostics ?? null);
  const refreshDurationMs = useDashboardStore((state) => state.data?.refreshState?.durationMs ?? null);
  const loadDiagnostics = useDashboardStore((state) => state.loadDiagnostics);
  const diagnosticsLoading = useDashboardStore((state) => state.diagnosticsLoading);
  const diagnosticsError = useDashboardStore((state) => state.diagnosticsError);
  const diagnosticsHasLoaded = useDashboardStore((state) => state.diagnosticsHasLoaded);

  const diagnostics = dashboardDiagnostics ?? dataDiagnostics;
  const [expanded, setExpanded] = useState(loadExpanded);

  useEffect(() => {
    if (expanded && !diagnosticsHasLoaded && !diagnosticsLoading) {
      void loadDiagnostics();
    }
  }, [expanded, diagnosticsHasLoaded, diagnosticsLoading, loadDiagnostics]);

  const sourceEntries = useMemo(
    () => Object.entries(diagnostics?.sourceHealth ?? {}),
    [diagnostics],
  );

  const sectionState = useSectionState({
    isLoading: expanded && diagnosticsLoading,
    error: expanded ? diagnosticsError : null,
    isEmpty: diagnosticsHasLoaded && isEmptyDiagnostics(diagnostics),
  });
  const healthySourceCount = sourceEntries.filter(([, health]) => health.status === "healthy").length;
  const totalSourceCount = sourceEntries.length;

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    saveExpanded(next);
  }

  return (
    <Card className="border-card-border bg-card-bg" id="source-health-section">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-text-primary">
              <Activity className="size-4" aria-hidden="true" />
              Source Health
            </CardTitle>
            <CardDescription>Collector status and discovered repositories</CardDescription>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="inline-flex items-center justify-center rounded-md border border-card-border p-1.5 text-text-secondary transition-colors hover:bg-card-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls="source-health-panel"
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Source health summary">
          {sourceEntries.length > 0 ? (
            sourceEntries.map(([name, health]) => (
              <button
                key={name}
                type="button"
                onClick={toggle}
                className={getBadgeClasses(health.status)}
                aria-label={`${name} ${health.status}`}
              >
                {name} · {health.status}
              </button>
            ))
          ) : (
            <Badge variant="outline" className="border-divider text-text-muted">
              {diagnosticsLoading ? "Loading source health…" : "No source health yet"}
            </Badge>
          )}
        </div>
      </CardHeader>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id="source-health-panel"
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <CardContent>
              <SectionState
                state={sectionState}
                section="diagnostics"
                errorMessage={diagnosticsError ?? undefined}
                onRetry={() => void loadDiagnostics()}
                minHeight="120px"
              >
                <div className="space-y-4">
                  {sourceEntries.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        Source Status
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {sourceEntries.map(([name, health]) => (
                          <div
                            key={name}
                            className="rounded-lg border border-card-border bg-card-bg px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "h-2 w-2 shrink-0 rounded-full",
                                  healthDot[health.status] ?? healthDot.unknown,
                                )}
                                aria-hidden="true"
                              />
                              <span className="min-w-0 truncate text-sm text-text-primary">
                                {name}
                              </span>
                              <Badge
                                variant="outline"
                                className="ml-auto shrink-0 border-divider text-text-muted"
                              >
                                {health.status}
                              </Badge>
                            </div>
                            {health.message ? (
                              <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                                {health.message}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {diagnostics?.discoveredRepos?.length ? (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        Discovered Repositories
                      </p>
                      <div className="grid gap-1.5">
                        {diagnostics.discoveredRepos.map((repo) => (
                          <div
                            key={repo.repoKey}
                            className="flex items-center gap-2 rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 truncate font-medium text-text-primary">
                              {repo.name}
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-text-muted">
                              {repo.githubOwner}/{repo.githubRepo}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {diagnostics?.collectionTargets?.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                      <span className="text-text-secondary">Targets:</span>
                      {diagnostics.collectionTargets.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {diagnostics ? (
                    <div className="rounded-lg border border-card-border bg-card-bg p-3 text-sm space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">
                        Diagnostics
                      </p>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        <div className="flex justify-between gap-3">
                          <span className="text-text-muted">Poller</span>
                          <span className="text-text-primary">
                            {diagnostics.pollerEnabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        {diagnostics.pollerIntervalSeconds ? (
                          <div className="flex justify-between gap-3">
                            <span className="text-text-muted">Interval</span>
                            <span className="text-text-primary">
                              {formatSeconds(diagnostics.pollerIntervalSeconds)}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-3">
                          <span className="text-text-muted">Cache age</span>
                          <span className="text-text-primary">
                            {formatSeconds(diagnostics.cacheAgeSeconds)}
                          </span>
                        </div>
                        {diagnostics.lastSuccessfulRefreshAt ? (
                          <div className="flex justify-between gap-3">
                            <span className="text-text-muted">Last refresh</span>
                            <span className="text-text-primary">
                              {new Date(diagnostics.lastSuccessfulRefreshAt).toLocaleString()}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-3">
                          <span className="text-text-muted">Duration</span>
                          <span className="text-text-primary">
                            {formatDurationMs(refreshDurationMs)}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-text-muted">Sources</span>
                          <span className="text-text-primary">
                            {healthySourceCount}/{totalSourceCount} healthy
                          </span>
                        </div>
                      </div>
                      {diagnostics.lastError ? (
                        <p className="rounded bg-status-error/5 px-2 py-1 text-xs text-status-error">
                          {diagnostics.lastError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SectionState>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
