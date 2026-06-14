<template>
  <TrendChart :option="chartOption" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CIAggregate } from '../types/aggregates'

const props = defineProps<{
  data: CIAggregate[]
}>()

const chartOption = computed(() => {
  const periods = props.data.map(d => formatPeriod(d.periodStart, d.periodEnd)).reverse()
  const passCount = props.data.map(d => d.passCount).reverse()
  const failCount = props.data.map(d => d.failCount).reverse()
  const passRate = props.data.map(d => d.passRate * 100).reverse()

  return {
    tooltip: {
      trigger: 'axis' as const,
      formatter(params: unknown) {
        const items = params as Array<{ seriesName: string; value: number; marker: string }>
        return items.map(p =>
          `${p.marker} ${p.seriesName}: ${p.seriesName === 'Pass rate' ? p.value.toFixed(0) + '%' : p.value}`
        ).join('<br/>')
      },
    },
    legend: {
      data: ['Passed', 'Failed', 'Pass rate'],
      textStyle: { color: '#94a3b8', fontSize: 11 },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 44, right: 44, top: 32, bottom: 28 },
    xAxis: {
      type: 'category' as const,
      data: periods,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: periods.length > 6 ? 30 : 0 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: [
      {
        type: 'value' as const,
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      {
        type: 'value' as const,
        min: 0,
        max: 100,
        splitLine: { show: false },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: '{value}%' },
      },
    ],
    series: [
      {
        name: 'Passed',
        type: 'bar',
        stack: 'runs',
        data: passCount,
        itemStyle: { color: '#4ade80' },
        barMaxWidth: 24,
      },
      {
        name: 'Failed',
        type: 'bar',
        stack: 'runs',
        data: failCount,
        itemStyle: { color: '#f87171' },
        barMaxWidth: 24,
      },
      {
        name: 'Pass rate',
        type: 'line',
        yAxisIndex: 1,
        data: passRate,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: '#c084fc', width: 2 },
        itemStyle: { color: '#c084fc' },
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
