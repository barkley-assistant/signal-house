"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { SectionKind } from "./types";

interface SectionSkeletonProps {
  section: SectionKind;
}

function HealthSkeleton() {
  return (
    <div className="grid grid-cols-5 gap-3" aria-label="Loading health metrics">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-card-border bg-card-bg p-3">
          <Skeleton className="h-3 w-2/3 bg-divider" />
          <Skeleton className="h-6 w-1/2 bg-divider" />
          <Skeleton className="h-2 w-full bg-divider" />
        </div>
      ))}
    </div>
  );
}

function TrendsSkeleton() {
  return (
    <div aria-label="Loading trend chart">
      <Skeleton className="h-[180px] w-full bg-divider" />
    </div>
  );
}

function AttentionSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading attention queue">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-card-border bg-card-bg px-4 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full bg-divider" />
            <Skeleton className="h-4 w-8 rounded bg-divider" />
            <Skeleton className="h-4 flex-1 bg-divider" />
          </div>
          <Skeleton className="h-3 w-1/3 bg-divider" />
        </div>
      ))}
    </div>
  );
}

function ModelUsageSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading model usage">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-1/3 bg-divider" />
            <Skeleton className="h-4 w-16 bg-divider" />
          </div>
          <Skeleton className="h-3 w-full rounded bg-divider" />
        </div>
      ))}
    </div>
  );
}

function SessionUsageSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading session usage">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg border border-card-border bg-card-bg px-3 py-2">
          <Skeleton className="h-4 w-1/4 bg-divider" />
          <Skeleton className="h-4 w-16 bg-divider" />
        </div>
      ))}
    </div>
  );
}

const skeletonMap: Record<SectionKind, React.FC> = {
  health: HealthSkeleton,
  trends: TrendsSkeleton,
  attention: AttentionSkeleton,
  "model-usage": ModelUsageSkeleton,
  "session-usage": SessionUsageSkeleton,
};

export function SectionSkeleton({ section }: SectionSkeletonProps) {
  const SkeletonComponent = skeletonMap[section];
  return <SkeletonComponent />;
}
