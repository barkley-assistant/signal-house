<template>
  <div class="skeleton" :class="[`skeleton--${variant}`]" :style="skeletonStyle">
    <div class="skeleton__pulse" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'text' | 'card' | 'chart' | 'table'
  width?: string
  height?: string
}>(), {
  variant: 'text',
})

const skeletonStyle = computed(() => ({
  width: props.width ?? (props.variant === 'card' ? '100%' : props.variant === 'chart' ? '100%' : props.variant === 'table' ? '100%' : '60%'),
  height: props.height ?? (props.variant === 'card' ? '120px' : props.variant === 'chart' ? '240px' : props.variant === 'table' ? '200px' : '1rem'),
}))
</script>

<style scoped>
.skeleton {
  position: relative;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  overflow: hidden;
  min-height: 1rem;
}

.skeleton--text {
  border-radius: 0.25rem;
  border: none;
  background: #334155;
}

.skeleton__pulse {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(148, 163, 184, 0.08) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
