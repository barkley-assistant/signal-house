<template>
  <div class="dashboard">
    <div class="page-header">
      <h2 class="page-title">Overview</h2>
      <p class="page-subtitle">Engineering health at a glance</p>
    </div>

    <!-- Error state -->
    <UiCard v-if="error" full>
      <EmptyState
        message="Could not load dashboard data"
        :hint="error.message || 'Check that metrics have been collected'"
      />
    </UiCard>

    <!-- Loading state -->
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
        hint="Run the data collector to populate the dashboard"
      />
    </UiCard>

    <!-- Dashboard content -->
    <template v-else>
      <div class="section section-large section-summary">
        <SummaryCards
          :throughput="snapshot.aggregates.throughput"
          :cycle-time="snapshot.aggregates.cycleTime"
          :ci="snapshot.aggregates.ci"
          :stale-work="snapshot.aggregates.staleWork"
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
    </template>

    <footer class="last-refresh" v-if="lastRefresh">
      <p>Last updated: {{ lastRefresh }}</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
import type { LatestState } from '../types/snapshot'
import type { ThroughputAggregate, CycleTimeAggregate, CIAggregate } from '../types/aggregates'

const { data: stateData, pending: statePending, error: stateError } = useFetch<LatestState>('/api/state')
const { data: throughputRaw, pending: throughputPending } = useFetch<ThroughputAggregate[]>('/api/trends/throughput')
const { data: cycleTimeRaw, pending: cycleTimePending } = useFetch<CycleTimeAggregate[]>('/api/trends/cycleTime')
const { data: ciRaw, pending: ciPending } = useFetch<CIAggregate[]>('/api/trends/ci')

const loading = computed(() => statePending.value || throughputPending.value || cycleTimePending.value || ciPending.value)
const error = computed(() => stateError.value)
const snapshot = computed(() => stateData.value?.snapshot ?? null)

const throughputData = computed<ThroughputAggregate[]>(() => throughputRaw.value ?? [])
const cycleTimeData = computed<CycleTimeAggregate[]>(() => cycleTimeRaw.value ?? [])
const ciData = computed<CIAggregate[]>(() => ciRaw.value ?? [])

const lastRefresh = computed(() => {
  const ts = stateData.value?.lastSuccessfulRefreshAt
  if (!ts) return null
  return new Date(ts).toLocaleString()
})
</script>

<style scoped>
.page-header {
  margin-bottom: 1rem;
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
