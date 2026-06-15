<template>
  <UiCard title="Session Usage" :badge="badgeText">
    <template v-if="sessionUsage">
      <div v-if="isActive" class="session-usage">
        <div class="session-usage__summary">
          <MetricCard label="Sessions" :value="sessionUsage.totalSessions" />
          <MetricCard label="Messages" :value="sessionUsage.messages" />
          <MetricCard label="Active days" :value="sessionUsage.activeDays" />
          <MetricCard label="Total cost" :value="sessionUsage.totalCost" />
        </div>

        <div class="session-usage__tokens">
          <div class="session-usage__panel">
            <h4>Token usage</h4>
            <div class="session-usage__token-grid">
              <MetricCard label="Input" :value="sessionUsage.inputTokens" />
              <MetricCard label="Output" :value="sessionUsage.outputTokens" />
              <MetricCard label="Cache read" :value="sessionUsage.cacheReadTokens" />
              <MetricCard label="Cache write" :value="sessionUsage.cacheWriteTokens" />
            </div>
            <div class="session-usage__token-meta">
              <span v-if="sessionUsage.averageTokensPerSession != null">Avg/session: {{ formatNumber(sessionUsage.averageTokensPerSession) }}</span>
              <span v-if="sessionUsage.medianTokensPerSession != null">Median/session: {{ formatNumber(sessionUsage.medianTokensPerSession) }}</span>
              <span v-if="sessionUsage.averageCostPerDay != null">Avg/day: {{ formatCurrency(sessionUsage.averageCostPerDay) }}</span>
            </div>
          </div>

          <div class="session-usage__panel">
            <h4>Tool usage</h4>
            <div v-if="sessionUsage.toolUsage.length" class="session-usage__tools">
              <div v-for="tool in sessionUsage.toolUsage" :key="tool.toolName" class="session-usage__tool">
                <div class="session-usage__tool-head">
                  <span class="session-usage__tool-name">{{ tool.toolName }}</span>
                  <span class="session-usage__tool-count">{{ formatNumber(tool.count) }}<template v-if="tool.percentage != null"> · {{ formatPercent(tool.percentage) }}</template></span>
                </div>
                <div class="session-usage__tool-bar">
                  <div class="session-usage__tool-fill" :style="{ width: `${tool.percentage ?? 0}%` }" />
                </div>
              </div>
            </div>
            <EmptyState v-else message="No tool usage recorded" />
          </div>
        </div>

        <p v-if="sessionUsage.message" class="session-usage__note">{{ sessionUsage.message }}</p>
      </div>

      <EmptyState
        v-else
        :message="fallbackMessage"
        :hint="fallbackHint"
      />
    </template>
    <EmptyState
      v-else
      message="Session usage unavailable"
      hint="Configure OpenCode stats collection to show this panel"
    />
  </UiCard>
</template>

<script setup lang="ts">
import type { DashboardWindowSessionUsageSummary } from '../types/snapshot'
import { formatCompactNumber } from '../utils/format'

const props = defineProps<{
  sessionUsage: DashboardWindowSessionUsageSummary | null
}>()

const badgeText = computed(() => props.sessionUsage?.periodStart && props.sessionUsage?.periodEnd
  ? `${props.sessionUsage.periodStart} to ${props.sessionUsage.periodEnd}`
  : undefined)

const isActive = computed(() => {
  const status = props.sessionUsage?.status
  return status === 'available' || status === 'partial' || status === 'stale'
})

const fallbackMessage = computed(() => {
  const status = props.sessionUsage?.status
  if (status === 'unconfigured') return 'Session usage is not configured'
  if (status === 'unavailable') return 'Session usage unavailable'
  if (status === 'empty') return 'No session activity in this window'
  if (status === 'error') return 'Session usage collection failed'
  return props.sessionUsage?.message ?? 'Session usage unavailable'
})

const fallbackHint = computed(() => {
  const status = props.sessionUsage?.status
  if (status === 'unconfigured') return 'Configure OPENCODE_BIN or OPENCODE_COMMAND and rerun refresh'
  if (status === 'unavailable') return 'OpenCode stats could not be collected for this window'
  if (status === 'empty') return 'OpenCode is wired up, but there were no sessions to show'
  if (status === 'error') return 'Check the OpenCode stats collector and the refresh logs'
  return 'OpenCode stats are configured, but no session activity was collected in this window'
})

function formatNumber(value: number | null | undefined): string {
  return formatCompactNumber(value)
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${value.toFixed(0)}%`
}
</script>

<style scoped>
.session-usage {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.session-usage__summary,
.session-usage__token-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

.session-usage__tokens {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 1rem;
}

.session-usage__panel {
  padding: 1rem;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  background: #0f172a;
}

.session-usage__panel h4 {
  margin-bottom: 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.session-usage__token-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-top: 0.75rem;
  font-size: 0.78rem;
  color: #64748b;
}

.session-usage__tools {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.session-usage__tool-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.8rem;
  color: #cbd5e1;
  margin-bottom: 0.35rem;
}

.session-usage__tool-name {
  font-weight: 500;
}

.session-usage__tool-count {
  color: #94a3b8;
  white-space: nowrap;
}

.session-usage__tool-bar {
  height: 0.45rem;
  background: #1e293b;
  border-radius: 999px;
  overflow: hidden;
}

.session-usage__tool-fill {
  height: 100%;
  background: linear-gradient(90deg, #38bdf8, #4ade80);
  border-radius: inherit;
}

.session-usage__note {
  font-size: 0.78rem;
  color: #94a3b8;
}

@media (max-width: 900px) {
  .session-usage__summary,
  .session-usage__token-grid,
  .session-usage__tokens {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .session-usage__summary,
  .session-usage__token-grid,
  .session-usage__tokens {
    grid-template-columns: 1fr;
  }
}
</style>
