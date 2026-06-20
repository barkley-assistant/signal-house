import { useMemo } from "react";

export function useEChartsTheme() {
  return useMemo(
    () => ({
      backgroundColor: "transparent",
      animation: true,
      animationDuration: 400,
      animationEasing: "easeOutQuart",
      textStyle: { color: "#f1f5f9", fontFamily: "Instrument Sans" },
      title: { textStyle: { color: "#f1f5f9", fontFamily: "Instrument Sans" } },
      legend: { show: false, textStyle: { color: "#94a3b8" } },
      tooltip: {
        backgroundColor: "#1a1d24",
        borderColor: "#262a33",
        borderWidth: 1,
        textStyle: { color: "#f1f5f9", fontSize: 12, fontFamily: "Instrument Sans" },
        axisPointer: { type: "cross", label: { backgroundColor: "#262a33" } },
      },
      grid: { top: 8, right: 8, bottom: 24, left: 40, containLabel: false },
      xAxis: {
        type: "category",
        axisLine: { lineStyle: { color: "#262a33" } },
        axisTick: { show: false },
        axisLabel: { color: "#64748b", fontSize: 10, fontFamily: "JetBrains Mono" },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        axisLine: { lineStyle: { color: "#262a33" } },
        axisTick: { show: false },
        axisLabel: { color: "#64748b", fontSize: 10, fontFamily: "JetBrains Mono" },
        splitLine: { lineStyle: { color: "#1e2128", type: "dashed" } },
      },
    }),
    []
  );
}
