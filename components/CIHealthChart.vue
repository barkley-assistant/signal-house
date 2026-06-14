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
  const passCount = props.data.map(d => d.isGap ? null : (d.metrics?.ciPassCount ?? 0))
  const failCount = props.data.map(d => d.isGap ? null : (d.metrics?.ciFailCount ?? 0))
  const passRate = props.data.map(d => d.isGap || d.metrics?.ciPassRate == null ? null : d.metrics.ciPassRate * 100)

  const labelRotation = labels.length > 14 ? 45 : (labels.length > 6 ? 30 : 0)
  const labelInterval = labels.length > 14 ? 'auto' as const : 0

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
    grid: { left: 44, right: 44, top: 32, bottom: 32 },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLabel: { color: '#64748b', fontSize: 10, rotate: labelRotation, interval: labelInterval },
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
        barMaxWidth: 18,
      },
      {
        name: 'Failed',
        type: 'bar',
        stack: 'runs',
        data: failCount,
        itemStyle: { color: '#f87171' },
        barMaxWidth: 18,
      },
      {
        name: 'Pass rate',
        type: 'line',
        yAxisIndex: 1,
        data: passRate,
        connectNulls: false,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#c084fc', width: 2 },
        itemStyle: { color: '#c084fc' },
      },
    ],
  }
})


</script>
