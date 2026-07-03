"use client";

import { useMemo, useState, useCallback } from "react";
import { BarChart3, ChevronDown, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { rankModelUsage, totalTokens as modelTotalTokens } from "@/lib/rank-models";
import type { RankedModelEntry } from "@/lib/rank-models";
import { UsageBar } from "@/components/UsageBar";
import { StatsBar } from "@/components/ui/stats-bar";
import { cn } from "@/lib/utils";
import { formatCost } from "@/lib/format-cost";
import { formatNumber } from "../../../utils/format";
import { averageCostPerMessage, hasDetailData, totalTokens as sumEntryTokens } from "./model-usage-utils";
import type { TokenUsageRow } from "@/types";

export interface ModelUsageRankListProps {
  tokenUsage: TokenUsageRow | null;
}

function ModelRow({
  entry,
  expanded,
  maxTokens,
  totalMessages,
  totalCost,
  onToggle,
}: {
  entry: RankedModelEntry;
  expanded: boolean;
  maxTokens: number;
  totalMessages: number;
  totalCost: number;
  onToggle: () => void;
}) {
  const entryTokenTotal = modelTotalTokens(entry);
  const messageShare = totalMessages > 0 ? entry.messages / totalMessages : 0;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-card-border bg-card-bg p-3 transition-colors hover:bg-card-hover",
        "cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
      )}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`${entry.modelName}: ${formatNumber(entry.messages)} messages`}
    >
      <div className="flex w-full items-center gap-2 text-left">
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
          {entry.modelName}
        </span>
        <span className="shrink-0 text-xs text-text-muted tabular-nums">
          {Math.round(entry.proportion * 100)}%
        </span>
        <span className="shrink-0 text-xs text-text-muted tabular-nums">
          {formatNumber(entry.messages)} msgs
        </span>
      </div>

      <UsageBar
        value={entryTokenTotal}
        max={maxTokens}
        color="bg-accent-primary"
        label={`${entry.modelName}: ${Math.round(entry.proportion * 100)} percent of tokens`}
        className="mt-2"
      />

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-3 border-t border-card-border pt-2">
              {!hasDetailData(entry) ? (
                <p className="text-xs text-text-muted">No token data available</p>
              ) : (
                <div className="grid grid-cols-6 gap-1 text-center">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">In</span>
                    <span className="text-xs font-mono tabular-nums text-text-secondary">{formatNumber(entry.inputTokens)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">Out</span>
                    <span className="text-xs font-mono tabular-nums text-text-secondary">{formatNumber(entry.outputTokens)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">Cache R</span>
                    <span className="text-xs font-mono tabular-nums text-text-secondary">{formatNumber(entry.cacheReadTokens)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">Cache W</span>
                    <span className="text-xs font-mono tabular-nums text-text-secondary">{formatNumber(entry.cacheWriteTokens)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">Total</span>
                    <span className="text-xs font-mono tabular-nums text-text-secondary">{formatNumber(sumEntryTokens(entry))}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-[0.06em] text-text-muted">Cost</span>
                    <span className={cn("text-xs font-mono tabular-nums", entry.cost != null && entry.cost > 0 ? "text-accent-primary" : "text-text-secondary")}>{formatCost(entry.cost)}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-text-muted">
                    <span>Message share</span>
                    <span>{Math.round(messageShare * 100)}%</span>
                  </div>
                  <UsageBar value={entry.messages} max={totalMessages} size="md" color="bg-chart-1" label={`${entry.modelName}: message share`} animated={false} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-text-muted">
                    <span>Cost share</span>
                    <span>{Math.round((totalCost > 0 && entry.cost != null ? entry.cost / totalCost : 0) * 100)}%</span>
                  </div>
                  <UsageBar value={entry.cost ?? 0} max={totalCost} size="md" color="bg-chart-2" label={`${entry.modelName}: cost share`} animated={false} />
                </div>
                <p className="text-[10px] text-text-muted">
                  Avg cost / message: {formatCost(averageCostPerMessage(entry))}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ModelUsageRankList({ tokenUsage }: ModelUsageRankListProps) {
  const modelUsage = useMemo(() => tokenUsage?.modelUsage ?? [], [tokenUsage?.modelUsage]);
  const ranked = useMemo(() => rankModelUsage(modelUsage), [modelUsage]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandAllMode, setExpandAllMode] = useState(false);

  const toggle = useCallback((name: string) => {
    if (expandAllMode) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        return next;
      });
    } else {
      setExpanded((prev) => (prev.has(name) ? new Set() : new Set([name])));
    }
  }, [expandAllMode]);

  const expandAll = useCallback(() => {
    setExpandAllMode(true);
    setExpanded(new Set(ranked.map((e) => e.modelName)));
  }, [ranked]);

  const collapseAll = useCallback(() => {
    setExpandAllMode(false);
    setExpanded(new Set());
  }, []);

  const maxTokens = useMemo(
    () => (ranked.length > 0 ? Math.max(...ranked.map((e) => modelTotalTokens(e))) : 0),
    [ranked],
  );
  const totalMessages = useMemo(() => ranked.reduce((sum, e) => sum + e.messages, 0), [ranked]);
  const totalCost = useMemo(() => ranked.reduce((sum, e) => sum + (e.cost ?? 0), 0), [ranked]);

  if (modelUsage.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        <BarChart3 className="size-6 text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text-secondary">No model usage recorded</p>
        <p className="text-xs text-text-muted">
          Model data appears once OpenCode provider calls are made
        </p>
      </div>
    );
  }

  const allExpanded = expandAllMode;

  return (
    <div className="space-y-3">
      <StatsBar
        variant="card"
        stats={[
          {
            label: "Sessions",
            value: tokenUsage!.totalSessions,
            format: "number",
          },
          {
            label: "Messages",
            value: tokenUsage!.totalMessages,
            format: "number",
          },
          {
            label: "Tokens",
            value: tokenUsage!.totalTokens,
            format: "number",
          },
          {
            label: "Cost",
            value: tokenUsage!.totalCost,
            format: "cost",
            highlight:
              tokenUsage!.totalCost != null && tokenUsage!.totalCost > 0,
          },
        ]}
      />

      {ranked.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            className="cursor-pointer rounded px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={allExpanded ? collapseAll : expandAll}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {ranked.map((entry) => (
          <ModelRow
            key={entry.modelName}
            entry={entry}
            expanded={expanded.has(entry.modelName)}
            maxTokens={maxTokens}
            totalMessages={totalMessages}
            totalCost={totalCost}
            onToggle={() => toggle(entry.modelName)}
          />
        ))}
      </div>
    </div>
  );
}
