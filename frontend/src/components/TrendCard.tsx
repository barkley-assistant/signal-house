"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendEChart } from "@/components/TrendEChart";
import type { EChartsOption } from "echarts-for-react";

interface TrendCardProps {
  title: string;
  option: EChartsOption | null;
  footer: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
}

export function TrendCard({ title, option, footer, loading, isEmpty, emptyMessage }: TrendCardProps) {
  return (
    <Card className="border-card-border bg-card-bg">
      <CardContent className="p-4">
        <h3
          className="mb-3 text-sm font-semibold text-text-primary"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {title}
        </h3>

        <div className="h-[180px]">
          {loading ? (
            <Skeleton className="h-full w-full bg-divider" />
          ) : isEmpty || !option ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-divider">
              <p className="px-2 text-center text-xs text-text-muted">
                {emptyMessage ?? "No data in this window"}
              </p>
            </div>
          ) : (
            <TrendEChart option={option} height={180} />
          )}
        </div>

        <p className="mt-3 truncate text-xs text-text-secondary">{footer}</p>
      </CardContent>
    </Card>
  );
}
