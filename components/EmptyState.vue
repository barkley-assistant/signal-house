<template>
  <div class="empty-state">
    <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
    <p class="empty-state__message">{{ message }}</p>
    <p v-if="hint" class="empty-state__hint">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  message: string
  hint?: string
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: #64748b;
  text-align: center;
}

.empty-state__icon {
  width: 2rem;
  height: 2rem;
  margin-bottom: 0.75rem;
  opacity: 0.5;
}

.empty-state__message {
  font-size: 0.875rem;
  font-weight: 500;
  color: #94a3b8;
}

.empty-state__hint {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #64748b;
}
</style>
