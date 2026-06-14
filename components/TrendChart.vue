<template>
  <div ref="chartRef" class="trend-chart" :style="{ height }"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = withDefaults(defineProps<{
  option: Record<string, unknown>
  height?: string
}>(), {
  height: '240px',
})

const emit = defineEmits<{
  ready: []
}>()

const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
let resizeObserver: ResizeObserver | null = null

function initChart() {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value, undefined, { renderer: 'canvas' })
  chart.setOption(props.option)
  emit('ready')
}

function disposeChart() {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
}

function handleResize() {
  chart?.resize()
}

onMounted(() => {
  nextTick(() => {
    initChart()
    if (chartRef.value) {
      resizeObserver = new ResizeObserver(handleResize)
      resizeObserver.observe(chartRef.value)
    }
  })
})

onBeforeUnmount(disposeChart)

watch(
  () => props.option,
  (val) => {
    chart?.setOption(val, true)
  },
  { deep: true },
)
</script>

<style scoped>
.trend-chart {
  width: 100%;
  min-height: 200px;
}
</style>
