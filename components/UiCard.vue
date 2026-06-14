<template>
  <div class="ui-card" :class="{ 'ui-card--full': full }">
    <div v-if="title" class="ui-card__header">
      <h3 class="ui-card__title">{{ title }}</h3>
      <span v-if="badge" class="ui-card__badge">{{ badge }}</span>
    </div>
    <div class="ui-card__body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  badge?: string
  full?: boolean
}>()
</script>

<style scoped>
.ui-card {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 1.25rem;
  min-height: 120px;
}

.ui-card--full {
  grid-column: span 12;
}

.ui-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.ui-card__title {
  font-size: 0.75rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ui-card__badge {
  font-size: 0.7rem;
  color: #64748b;
  background: #0f172a;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}

.ui-card__body {
  position: relative;
}
</style>
