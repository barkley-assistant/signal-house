<template>
  <div class="dashboard">
    <div class="page-header">
      <div>
        <h2 class="page-title">Overview</h2>
        <p class="page-subtitle">Engineering health at a glance</p>
      </div>
      <div class="page-actions">
        <button
          class="refresh-btn"
          :class="{ 'refresh-btn--active': refreshing }"
          :disabled="refreshing || loading"
          @click="doRefresh"
        >
          <span v-if="refreshing" class="spinner" />
          <svg v-else class="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 4v6h6M23 20v-6h-6" />
            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
          </svg>
          {{ refreshing ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <!-- Error state (initial load) -->
    <UiCard v-if="error" full>
      <EmptyState
        message="Could not load dashboard data"
        :hint="error.message || 'Check that metrics have been collected'"
      />
    </UiCard>

    <!-- Loading state (initial load only) -->
    <div v-else-if="loading" class="sections">
      <div class="section section-large">
        <LoadingSkeleton variant="card" />
      </div>
      <div class="section"><LoadingSkeleton variant="chart" /></div>
      <div class="section"><LoadingSkeleton variant="card" /></div>
      <div class="section section-large"><LoadingSkeleton variant="table" /></div>
    </div>

    <!-- Empty state -->
    <UiCard v-else-if="!snapshot" full>
      <EmptyState
        message="No metrics collected yet"
        hint="Check that data collectors are configured, then click Refresh"
      />
    </UiCard>

    <!-- Dashboard content (keeps old data visible during refresh) -->
    <template v-else>
      <!-- Stale data banner -->
      <div v-if="isStale && !refreshing" class="banner banner--stale">
        <svg class="banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <span>Cached data from {{ lastRefreshAgo }} — results may be stale. Click Refresh for latest.</span>
      </div>

      <!-- Refresh-in-progress banner -->
      <div v-if="refreshing" class="banner banner--info">
        <span class="spinner spinner--small" />
        <span>Refreshing data from sources...</span>
      </div>

      <!-- Refresh error banner -->
      <div v-if="refreshError" class="banner banner--error">
        <svg class="banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
        <span>{{ refreshError }}</span>
      </div>

      <!-- Partial data warning from snapshot metadata -->
      <div
        v-if="snapshot.metadata.partialData && snapshot.metadata.errors.length > 0"
        class="banner banner--warning"
      >
        <svg class="banner__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <span>Data may be incomplete: {{ snapshot.metadata.errors[0] }}</span>
      </div>

      <div class="sections">
        <div class="section section-large section-summary">
          <SummaryCards
            :throughput="snapshot.aggregates.throughput"
            :cycle-time="snapshot.aggregates.cycleTime"
            :ci="snapshot.aggregates.ci"
            :stale-work="snapshot.aggregates.staleWork"
            :session-usage="snapshot.aggregates.sessionUsage"
          />
        </div>

        <div class="section section-chart">
          <UiCard title="Throughput">
            <ThroughputChart
              v-if="throughputData.length > 0"
              :data="throughputData"
            />
            <EmptyState v-else message="No throughput data yet" />
          </UiCard>
        </div>

        <div class="section section-chart">
          <UiCard title="Cycle Time">
            <CycleTimeChart
              v-if="cycleTimeData.length > 0"
              :data="cycleTimeData"
            />
            <EmptyState v-else message="No cycle time data yet" />
          </UiCard>
        </div>

        <div class="section section-chart">
          <UiCard title="CI Health">
            <CIHealthChart
              v-if="ciData.length > 0"
              :data="ciData"
            />
            <EmptyState v-else message="No CI data yet" />
          </UiCard>
        </div>

        <div class="section section-large section-table">
          <UiCard title="Stale or Blocked Work">
            <StaleWorkTable
              :issues="snapshot.issues"
              :pull-requests="snapshot.pullRequests"
            />
          </UiCard>
        </div>
      </div>
    </template>

    <footer class="last-refresh" v-if="lastRefresh">
      <p>Last updated: {{ lastRefresh }}</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import type { LatestState } from '../types/snapshot'
import type { ThroughputAggregate, CycleTimeAggregate, CIAggregate } from '../types/aggregates'

const fetchOpts = { cache: 'no-store' as const }
const { data: stateData, pending: statePending, error: stateError, refresh: refreshState } = useFetch<LatestState>('/api/state', fetchOpts)
const { data: throughputRaw, pending: throughputPending, refresh: refreshThroughput } = useFetch<ThroughputAggregate[]>('/api/trends/throughput', fetchOpts)
const { data: cycleTimeRaw, pending: cycleTimePending, refresh: refreshCycleTime } = useFetch<CycleTimeAggregate[]>('/api/trends/cycleTime', fetchOpts)
const { data: ciRaw, pending: ciPending, refresh: refreshCI } = useFetch<CIAggregate[]>('/api/trends/ci', fetchOpts)

const loading = computed(() => statePending.value || throughputPending.value || cycleTimePending.value || ciPending.value)
const error = computed(() => stateError.value)
const snapshot = computed(() => stateData.value?.snapshot ?? null)
const isStale = computed(() => stateData.value?.isStale ?? false)
const refreshing = ref(false)
const refreshError = ref<string | null>(null)

const throughputData = computed<ThroughputAggregate[]>(() => throughputRaw.value ?? [])
const cycleTimeData = computed<CycleTimeAggregate[]>(() => cycleTimeRaw.value ?? [])
const ciData = computed<CIAggregate[]>(() => ciRaw.value ?? [])

const lastRefresh = computed(() => {
  const ts = stateData.value?.lastSuccessfulRefreshAt
  if (!ts) return null
  return new Date(ts).toLocaleString()
})

const lastRefreshAgo = computed(() => {
  const ts = stateData.value?.lastSuccessfulRefreshAt
  if (!ts) return null
  const diff = Date.now() - new Date(ts).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  const remain = minutes % 60
  return remain > 0 ? `${hours}h ${remain}m ago` : `${hours}h ago`
})

async function doRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null

  try {
    await $fetch('/api/refresh', { method: 'POST' })
    await pollForRefreshComplete()
    await Promise.all([
      refreshState(),
      refreshThroughput(),
      refreshCycleTime(),
      refreshCI(),
    ])
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err && (err as any).statusCode === 409) {
      refreshError.value = 'A refresh is already in progress'
    } else {
      refreshError.value = err instanceof Error ? err.message : 'Failed to start refresh'
    }
  } finally {
    refreshing.value = false
  }
}

async function pollForRefreshComplete(timeoutMs = 60000, intervalMs = 2000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, intervalMs))
    try {
      const state = await $fetch<LatestState>(`/api/state?_t=${Date.now()}`)
      if (!state.refreshInProgress) return
    } catch {
      // ignore poll errors
    }
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
  gap: 1rem;
}

.page-actions {
  flex-shrink: 0;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: #f1f5f9;
}

.page-subtitle {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: #64748b;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: #e2e8f0;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background: #334155;
  border-color: #475569;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.refresh-btn--active {
  border-color: #3b82f6;
}

.refresh-icon {
  width: 0.9rem;
  height: 0.9rem;
}

.spinner {
  display: inline-block;
  width: 0.9rem;
  height: 0.9rem;
  border: 2px solid #64748b;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.spinner--small {
  width: 0.75rem;
  height: 0.75rem;
  border-width: 1.5px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  margin-bottom: 1rem;
  border-radius: 0.375rem;
  font-size: 0.8rem;
  font-weight: 500;
}

.banner__icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}

.banner--stale {
  background: #422006;
  border: 1px solid #78350f;
  color: #fbbf24;
}

.banner--info {
  background: #0c1929;
  border: 1px solid #1d4ed8;
  color: #60a5fa;
}

.banner--warning {
  background: #1c1917;
  border: 1px solid #92400e;
  color: #fcd34d;
}

.banner--error {
  background: #1f1315;
  border: 1px solid #991b1b;
  color: #fca5a5;
}

.sections {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 1rem;
}

.section {
  grid-column: span 4;
  min-height: 0;
}

.section-large {
  grid-column: span 12;
}

.section-summary {
  grid-column: span 12;
}

.section-chart {
  grid-column: span 4;
}

.section-table {
  grid-column: span 12;
}

.last-refresh {
  margin-top: 1.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid #1e293b;
  font-size: 0.75rem;
  color: #475569;
  text-align: right;
}

@media (max-width: 1100px) {
  .section-chart {
    grid-column: span 6;
  }
}

@media (max-width: 768px) {
  .section-chart {
    grid-column: span 12;
  }
}
</style>
