<template>
  <TrendChart :option="chartOption" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CycleTimeAggregate } from '../types/aggregates'

const props = defineProps<{
  data: CycleTimeAggregate[]
}>()

const chartOption = computed(() => {
  const periods = props.data.map(d => formatPeriod(d.periodStart, d.periodEnd)).reverse()
  const avg = props.data.map(d => d.averageDays).reverse()
  const median = props.data.map(d => d.medianDays).reverse()
  const p95 = props.data.map(d => d.p95Days).reverse()

  return {
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: ['Average', 'Median', 'P95'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 44, right: 16, top: 32, bottom: 28 },
    xAxis: {
      type: 'category' as const,
      data: periods,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: periods.length > 6 ? 30 : 0 },
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
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#60a5fa', width: 2 },
        itemStyle: { color: '#60a5fa' },
        areaStyle: { color: 'rgba(96, 165, 250, 0.08)' },
      },
      {
        name: 'Median',
        type: 'line',
        data: median,
        smooth: true,
        symbol: 'diamond',
        symbolSize: 6,
        lineStyle: { color: '#4ade80', width: 2 },
        itemStyle: { color: '#4ade80' },
      },
      {
        name: 'P95',
        type: 'line',
        data: p95,
        smooth: true,
        symbol: 'triangle',
        symbolSize: 7,
        lineStyle: { color: '#f87171', width: 2, type: 'dashed' },
        itemStyle: { color: '#f87171' },
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
