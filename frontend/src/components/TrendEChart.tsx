"use client";

import ReactECharts, { type EChartsOption, type EChartsInstance } from "echarts-for-react";
import { useMemo } from "react";
import { useEChartsTheme } from "@/hooks/useEChartsTheme";

interface TrendEChartProps {
  option: EChartsOption;
  height?: number | string;
  onReady?: (instance: EChartsInstance) => void;
}

export function TrendEChart({ option, height = 180, onReady }: TrendEChartProps) {
  const theme = useEChartsTheme();
  const mergedOption = useMemo(() => ({ ...theme, ...option }), [option, theme]);

  return (
    <ReactECharts
      option={mergedOption}
      notMerge
      lazyUpdate
      autoResize
      style={{ height }}
      onChartReady={onReady}
      opts={{ renderer: "canvas" }}
    />
  );
}
