"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Clock, Database, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emptyStateConfigs } from "./empty-config";
import { resolveSectionState } from "./resolve-state";
import { SectionSkeleton } from "./skeletons";
import type { SectionStateProps } from "./types";

const fadeTransition = {
  duration: 0.2,
};

function LoadingState({ section, minHeight }: { section: SectionStateProps["section"]; minHeight: string }) {
  return (
    <motion.div
      key="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="flex items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <SectionSkeleton section={section} />
    </motion.div>
  );
}

function EmptyState({ section, minHeight }: { section: SectionStateProps["section"]; minHeight: string }) {
  const config = emptyStateConfigs[section];
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="flex flex-col items-center justify-center gap-2 px-4 text-center"
      role="status"
      aria-label="Empty"
    >
      <Database className="size-6 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text-secondary">{config.message}</p>
      <p className="text-xs text-text-muted">{config.hint}</p>
    </motion.div>
  );
}

function ErrorState({
  errorMessage,
  onRetry,
  minHeight,
}: {
  errorMessage?: string;
  onRetry?: () => void;
  minHeight: string;
}) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="flex flex-col items-center justify-center gap-3 px-4 text-center"
      role="alert"
      aria-label="Error"
    >
      <AlertCircle className="size-6 text-status-error" aria-hidden="true" />
      <p className="text-sm font-medium text-text-secondary">
        {errorMessage ?? "Something went wrong"}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="border-divider text-text-secondary hover:bg-card-hover"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </Button>
      )}
    </motion.div>
  );
}

function UnavailableState({ minHeight }: { minHeight: string }) {
  return (
    <motion.div
      key="unavailable"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="flex flex-col items-center justify-center gap-2 px-4 text-center"
      role="status"
      aria-label="Source unavailable"
    >
      <Unplug className="size-6 text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text-secondary">Source not configured</p>
      <p className="text-xs text-text-muted">This data source has not been set up yet</p>
    </motion.div>
  );
}

function StaleState({
  children,
  minHeight,
}: {
  children?: React.ReactNode;
  minHeight: string;
}) {
  return (
    <motion.div
      key="stale"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="relative"
      aria-label="Data is stale"
    >
      {children}
      <div className="absolute inset-0 flex items-start justify-end rounded-lg bg-status-stale/5 p-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-status-stale/10 px-2 py-0.5 text-xs font-medium text-status-stale">
          <Clock className="size-3" aria-hidden="true" />
          Stale
        </span>
      </div>
    </motion.div>
  );
}

function PartialState({
  children,
  minHeight,
}: {
  children?: React.ReactNode;
  minHeight: string;
}) {
  return (
    <motion.div
      key="partial"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
      style={{ minHeight }}
      className="relative"
      aria-label="Partial data"
    >
      {children}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center rounded-b-lg bg-status-warning/5 px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-status-warning">
          <Database className="size-3" aria-hidden="true" />
          Partial data
        </span>
      </div>
    </motion.div>
  );
}

function DataAvailableState({ children }: { children?: React.ReactNode }) {
  return (
    <motion.div
      key="data-available"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fadeTransition}
    >
      {children}
    </motion.div>
  );
}

export function SectionState({
  state,
  section,
  errorMessage,
  onRetry,
  children,
  minHeight = "120px",
}: SectionStateProps) {
  return (
    <AnimatePresence mode="wait">
      {state === "loading" && <LoadingState section={section} minHeight={minHeight} />}
      {state === "empty" && <EmptyState section={section} minHeight={minHeight} />}
      {state === "error" && (
        <ErrorState errorMessage={errorMessage} onRetry={onRetry} minHeight={minHeight} />
      )}
      {state === "unavailable" && <UnavailableState minHeight={minHeight} />}
      {state === "stale" && <StaleState minHeight={minHeight}>{children}</StaleState>}
      {state === "partial" && <PartialState minHeight={minHeight}>{children}</PartialState>}
      {state === "data-available" && <DataAvailableState>{children}</DataAvailableState>}
    </AnimatePresence>
  );
}

export function useSectionState({
  isLoading,
  error,
  isEmpty,
  isStale,
  isPartial,
  isUnconfigured,
}: {
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  isStale?: boolean;
  isPartial?: boolean;
  isUnconfigured?: boolean;
}): SectionStateProps["state"] {
  return resolveSectionState({ isLoading, error, isEmpty, isStale, isPartial, isUnconfigured });
}
