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
  const opened = props.data.map(d => d.isGap ? null : (d.metrics?.issuesOpened ?? 0))
  const closed = props.data.map(d => d.isGap ? null : (d.metrics?.issuesClosed ?? 0))
  const merged = props.data.map(d => d.isGap ? null : (d.metrics?.prsMerged ?? 0))

  const labelRotation = labels.length > 14 ? 45 : (labels.length > 6 ? 30 : 0)
  const labelInterval = labels.length > 14 ? 'auto' as const : 0

  return {
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: ['Opened', 'Closed', 'Merged'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 40, right: 16, top: 32, bottom: 32 },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: labelRotation, interval: labelInterval },
      axisLine: { lineStyle: { color: '#334155' } },
      axisTick: { alignWithLabel: true },
    },
    yAxis: {
      type: 'value' as const,
      splitLine: { lineStyle: { color: '#1e293b' } },
      axisLabel: { color: '#64748b', fontSize: 10 },
    },
    series: [
      {
        name: 'Opened',
        type: 'bar',
        stack: 'total',
        data: opened,
        itemStyle: { color: '#60a5fa' },
        barMaxWidth: 18,
      },
      {
        name: 'Closed',
        type: 'bar',
        stack: 'total',
        data: closed,
        itemStyle: { color: '#4ade80' },
        barMaxWidth: 18,
      },
      {
        name: 'Merged',
        type: 'line',
        data: merged,
        connectNulls: false,
        lineStyle: { color: '#c084fc', width: 2 },
        itemStyle: { color: '#c084fc' },
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
      },
    ],
  }
})


</script>
