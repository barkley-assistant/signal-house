<template>
  <div class="metric-card">
    <p class="metric-card__label">{{ label }}</p>
    <p class="metric-card__value" :class="`metric-card__value--${trend}`">{{ displayValue }}</p>
    <p v-if="sublabel" class="metric-card__sublabel">{{ sublabel }}</p>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  value: number | string | null | undefined
  sublabel?: string
  trend?: 'up' | 'down' | 'neutral'
  format?: 'number' | 'percent' | 'days'
}>(), {
  trend: 'neutral',
  format: 'number',
})

function formatValue(val: number | string | null | undefined, fmt: string): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val
  if (fmt === 'percent') return `${(val * 100).toFixed(0)}%`
  if (fmt === 'days') return `${val.toFixed(1)}d`
  return val.toLocaleString()
}

const displayValue = formatValue(props.value, props.format)
</script>

<style scoped>
.metric-card {
  padding: 0.5rem 0;
  min-width: 0;
}

.metric-card + .metric-card {
  border-top: 1px solid #1e293b;
}

.metric-card__label {
  font-size: 0.7rem;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.25rem;
}

.metric-card__value {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f1f5f9;
  font-variant-numeric: tabular-nums;
}

.metric-card__value--up {
  color: #4ade80;
}

.metric-card__value--down {
  color: #f87171;
}

.metric-card__sublabel {
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.15rem;
}
</style>
