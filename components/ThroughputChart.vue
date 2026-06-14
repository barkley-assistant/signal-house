<template>
  <TrendChart :option="chartOption" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ThroughputAggregate } from '../types/aggregates'

const props = defineProps<{
  data: ThroughputAggregate[]
}>()

const chartOption = computed(() => {
  const periods = props.data.map(d => formatPeriod(d.periodStart, d.periodEnd)).reverse()
  const opened = props.data.map(d => d.issuesOpened).reverse()
  const closed = props.data.map(d => d.issuesClosed).reverse()
  const merged = props.data.map(d => d.prsMerged).reverse()

  return {
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: ['Opened', 'Closed', 'Merged'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 40, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: 'category' as const,
      data: periods,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: periods.length > 6 ? 30 : 0 },
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
        barMaxWidth: 24,
      },
      {
        name: 'Closed',
        type: 'bar',
        stack: 'total',
        data: closed,
        itemStyle: { color: '#4ade80' },
        barMaxWidth: 24,
      },
      {
        name: 'Merged',
        type: 'line',
        data: merged,
        lineStyle: { color: '#c084fc', width: 2 },
        itemStyle: { color: '#c084fc' },
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
      },
    ],
  }
})

function formatPeriod(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${s.toLocaleDateString('en-US', opts)}-${e.toLocaleDateString('en-US', { day: 'numeric' })}`
}
</script>
