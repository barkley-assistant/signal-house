<template>
  <div class="summary-grid">
    <UiCard title="Throughput">
      <template v-if="throughput && throughput.status !== 'empty' && !isBlockedState(throughput.status)">
        <MetricCard
          label="Issues closed"
          :value="throughput.issuesClosed"
          :trend="throughputTrend(throughput.issuesClosed)"
        />
        <MetricCard
          label="PRs merged"
          :value="throughput.prsMerged"
          :trend="throughputTrend(throughput.prsMerged)"
        />
        <MetricCard
          label="Commits"
          :value="throughput.totalCommits"
        />
        <p v-if="throughput.message" class="panel-note">{{ throughput.message }}</p>
      </template>
      <EmptyState
        v-else
        :message="throughput?.message ?? 'Throughput unavailable'"
        hint="Check GitHub and local git configuration"
      />
    </UiCard>

    <UiCard title="Cycle Time">
      <template v-if="cycleTime && cycleTime.status !== 'empty' && !isBlockedState(cycleTime.status)">
        <MetricCard
          label="Average"
          :value="cycleTime.averageDays"
          format="days"
          :trend="cycleTime ? 'down' : 'neutral'"
        />
        <MetricCard
          label="Median"
          :value="cycleTime.medianDays"
          format="days"
          :trend="cycleTime ? 'down' : 'neutral'"
        />
        <MetricCard
          label="P95"
          :value="cycleTime.p95Days"
          format="days"
          :trend="cycleTime ? 'down' : 'neutral'"
        />
        <MetricCard
          label="Sample"
          :value="cycleTime.sampleSize"
          sublabel="items"
        />
        <p v-if="cycleTime.message" class="panel-note">{{ cycleTime.message }}</p>
      </template>
      <EmptyState
        v-else
        :message="cycleTime?.message ?? 'Cycle time unavailable'"
        hint="GitHub pull requests are required for cycle time"
      />
    </UiCard>

    <UiCard title="CI Health">
      <template v-if="ci && ci.status !== 'empty' && !isBlockedState(ci.status)">
        <MetricCard
          label="Pass rate"
          :value="ci.passRate"
          format="percent"
          :trend="ciPassRateTrend"
        />
        <MetricCard
          label="Total runs"
          :value="ci.totalRuns"
        />
        <MetricCard
          label="Failures"
          :value="ci.failCount"
          :trend="ciFailTrend"
        />
        <p v-if="ci.message" class="panel-note">{{ ci.message }}</p>
      </template>
      <EmptyState
        v-else
        :message="ci?.message ?? 'CI unavailable'"
        hint="GitHub Actions or check-run data is required"
      />
    </UiCard>

    <UiCard title="Stale Work">
      <template v-if="staleWork && !isBlockedState(staleWork.status)">
        <MetricCard
          label="Stale issues"
          :value="staleWork.staleIssues"
          :trend="staleIssuesTrend"
        />
        <MetricCard
          label="Stale PRs"
          :value="staleWork.stalePrs"
          :trend="stalePRsTrend"
        />
        <p v-if="staleWork.message" class="panel-note">{{ staleWork.message }}</p>
      </template>
      <EmptyState
        v-else
        :message="staleWork?.message ?? 'Stale work unavailable'"
        hint="GitHub issues and pull requests are required"
      />
    </UiCard>

  </div>
</template>

<script setup lang="ts">
import type { DashboardWindowThroughputSummary, DashboardWindowCycleTimeSummary, DashboardWindowCISummary, DashboardWindowStaleWorkSummary, DashboardPanelStatus } from '../types/snapshot'

const props = defineProps<{
  throughput: DashboardWindowThroughputSummary | null
  cycleTime: DashboardWindowCycleTimeSummary | null
  ci: DashboardWindowCISummary | null
  staleWork: DashboardWindowStaleWorkSummary | null
  isStale?: boolean
}>()

function isBlockedState(status: DashboardPanelStatus): boolean {
  return status === 'unconfigured' || status === 'unavailable' || status === 'error'
}

function throughputTrend(val: number | undefined): 'up' | 'down' | 'neutral' {
  if (val == null || val === 0) return 'neutral'
  return 'up'
}

const ciPassRateTrend = 'up'
const ciFailTrend = 'down'
const staleIssuesTrend = 'down'
const stalePRsTrend = 'down'
</script>

<style scoped>
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.panel-note {
  grid-column: 1 / -1;
  margin-top: 0.25rem;
  font-size: 0.78rem;
  color: #94a3b8;
}

@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
