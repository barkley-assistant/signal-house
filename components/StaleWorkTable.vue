<template>
  <div class="stale-table-wrapper">
    <table v-if="items.length > 0" class="stale-table">
      <thead>
        <tr>
          <th class="col-type">Type</th>
          <th class="col-title">Title</th>
          <th class="col-repo">Repo</th>
          <th class="col-age">Age</th>
          <th class="col-status">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td class="col-type">
            <span class="type-badge" :class="`type-badge--${item.kind}`">
              {{ item.kind === 'issue' ? 'IS' : 'PR' }}
            </span>
          </td>
          <td class="col-title">
            <a :href="item.url" class="item-link" target="_blank" rel="noopener noreferrer">
              {{ item.title }}
            </a>
          </td>
          <td class="col-repo">{{ item.repo }}</td>
          <td class="col-age">{{ item.ageDays }}d</td>
          <td class="col-status">
            <span class="status-dot" :class="`status-dot--${item.statusClass}`" />
            {{ item.statusLabel }}
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState
      v-else
      message="No stale or blocked work"
      hint="All tracked items are up to date"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { IssueMetric, PullRequestMetric } from '../types/metrics'

interface StaleItem {
  id: string
  kind: 'issue' | 'pr'
  title: string
  repo: string
  url: string
  ageDays: number
  statusLabel: string
  statusClass: string
}

const props = defineProps<{
  issues: IssueMetric[]
  pullRequests: PullRequestMetric[]
}>()

const STALE_ISSUE_DAYS = 14
const STALE_PR_DAYS = 7

const items = computed<StaleItem[]>(() => {
  const now = Date.now()
  const results: StaleItem[] = []

  for (const issue of props.issues) {
    if (issue.state !== 'open') continue
    const age = dayDiff(now, issue.updatedAt)
    if (age >= STALE_ISSUE_DAYS) {
      results.push({
        id: issue.id,
        kind: 'issue',
        title: issue.title,
        repo: issue.repo,
        url: issue.url,
        ageDays: age,
        statusLabel: 'Stale',
        statusClass: 'warn',
      })
    }
  }

  for (const pr of props.pullRequests) {
    if (pr.state !== 'open') continue
    const age = dayDiff(now, pr.updatedAt)
    const isBlocked = pr.ciStatus != null && pr.ciStatus !== 'success'

    if (isBlocked) {
      results.push({
        id: pr.id,
        kind: 'pr',
        title: pr.title,
        repo: pr.repo,
        url: pr.url,
        ageDays: age,
        statusLabel: pr.ciStatus === 'failure' ? 'CI failing' : 'CI pending',
        statusClass: 'blocked',
      })
    } else if (age >= STALE_PR_DAYS) {
      results.push({
        id: pr.id,
        kind: 'pr',
        title: pr.title,
        repo: pr.repo,
        url: pr.url,
        ageDays: age,
        statusLabel: 'Stale',
        statusClass: 'warn',
      })
    }
  }

  results.sort((a, b) => b.ageDays - a.ageDays)
  return results.slice(0, 20)
})

function dayDiff(now: number, dateStr: string): number {
  return Math.floor((now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}
</script>

<style scoped>
.stale-table-wrapper {
  overflow-x: auto;
}

.stale-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.stale-table th {
  text-align: left;
  font-size: 0.65rem;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.5rem 0.5rem 0.5rem 0;
  border-bottom: 1px solid #334155;
  white-space: nowrap;
}

.stale-table td {
  padding: 0.5rem 0.5rem 0.5rem 0;
  border-bottom: 1px solid #1e293b;
  vertical-align: middle;
}

.stale-table tbody tr:hover td {
  background: rgba(148, 163, 184, 0.04);
}

.col-type { width: 48px; }
.col-title { min-width: 180px; }
.col-repo { width: 120px; }
.col-age { width: 56px; }
.col-status { width: 96px; }

.type-badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.15rem 0.35rem;
  border-radius: 3px;
  letter-spacing: 0.05em;
}

.type-badge--issue {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

.type-badge--pr {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.item-link {
  color: #e2e8f0;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 320px;
}

.item-link:hover {
  color: #60a5fa;
}

.col-repo {
  color: #94a3b8;
  font-family: monospace;
  font-size: 0.75rem;
}

.col-age {
  font-variant-numeric: tabular-nums;
  color: #f1f5f9;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 0.35rem;
  vertical-align: middle;
}

.status-dot--warn {
  background: #fbbf24;
}

.status-dot--blocked {
  background: #f87171;
}

@media (max-width: 768px) {
  .col-repo { display: none; }
  .col-status { width: auto; }
  .item-link { max-width: 200px; }
}
</style>
