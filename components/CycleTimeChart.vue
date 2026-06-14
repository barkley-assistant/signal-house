<template>
  <TrendChart :option="chartOption" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardWindowDay } from '../types/snapshot'

const props = defineProps<{
  data: DashboardWindowDay[]
}>()

const chartOption = computed(() => {
  const labels = props.data.map(d => formatDayLabel(d.day))
  const avg = props.data.map(d => d.isGap ? null : (d.metrics?.avgCycleTimeDays ?? null))
  const median = props.data.map(d => d.isGap ? null : (d.metrics?.medianCycleTimeDays ?? null))
  const p95 = props.data.map(d => d.isGap ? null : (d.metrics?.p95CycleTimeDays ?? null))

  const labelRotation = labels.length > 14 ? 45 : (labels.length > 6 ? 30 : 0)
  const labelInterval = labels.length > 14 ? 'auto' as const : 0

  return {
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: ['Average', 'Median', 'P95'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 44, right: 16, top: 32, bottom: 32 },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: labelRotation, interval: labelInterval },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value' as const,
      name: 'Days',
      nameTextStyle: { color: '#64748b', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}d' },
    },
    series: [
      {
        name: 'Average',
        type: 'line',
        data: avg,
        connectNulls: false,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#60a5fa', width: 2 },
        itemStyle: { color: '#60a5fa' },
        areaStyle: { color: 'rgba(96, 165, 250, 0.08)' },
      },
      {
        name: 'Median',
        type: 'line',
        data: median,
        connectNulls: false,
        smooth: true,
        symbol: 'diamond',
        symbolSize: 5,
        lineStyle: { color: '#4ade80', width: 2 },
        itemStyle: { color: '#4ade80' },
      },
      {
        name: 'P95',
        type: 'line',
        data: p95,
        connectNulls: false,
        smooth: true,
        symbol: 'triangle',
        symbolSize: 6,
        lineStyle: { color: '#f87171', width: 2, type: 'dashed' },
        itemStyle: { color: '#f87171' },
      },
    ],
  }
})


</script>
