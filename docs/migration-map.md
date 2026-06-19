# Migration Map

Maps every existing Nuxt/Vue component to its fate in the Next.js/React rewrite.
Parent issue: #131 · This document: #149

> Update this file as components are built, replaced, or deleted.

---

## 1. Vue Component Inventory

### Replace

| Vue component | File | Replacement | Build status |
|---|---|---|---|
| `SummaryCards.vue` | `components/SummaryCards.vue` | Split into 5× `HealthSignalCard` | Not started |
| `MetricCard.vue` | `components/MetricCard.vue` | `HealthSignalCard` (richer states) | Not started |
| `UiCard.vue` | `components/UiCard.vue` | shadcn `<Card>` (`frontend/src/components/ui/card.tsx`) | Done — shadcn card installed |
| `SessionUsageSection.vue` | `components/SessionUsageSection.vue` | `ModelUsageRankList` + `SessionSummaryCard` | Not started |
| `ThroughputChart.vue` | `components/ThroughputChart.vue` | `TrendCard` with shared ECharts theme | Not started |
| `CycleTimeChart.vue` | `components/CycleTimeChart.vue` | `TrendCard` | Not started |
| `CIHealthChart.vue` | `components/CIHealthChart.vue` | `TrendCard` | Not started |
| `TrendChart.vue` | `components/TrendChart.vue` | `TrendEChart` (raw ECharts wrapper) | Not started |
| `StaleWorkTable.vue` | `components/StaleWorkTable.vue` | `AttentionQueue` + `AttentionRow` | Not started |

### Retain (refactor to React)

| Vue component | File | Target | Build status |
|---|---|---|---|
| `EmptyState.vue` | `components/EmptyState.vue` | React `EmptyState` with design-system tokens | Not started |
| `LoadingSkeleton.vue` | `components/LoadingSkeleton.vue` | React `LoadingSkeleton` — shadcn `<Skeleton>` exists (`frontend/src/components/ui/skeleton.tsx`), needs section-level variants | Partial — shadcn primitive ready |

### Delete (no direct replacement)

| Vue component | File | Reason |
|---|---|---|
| `pages/index.vue` | `pages/index.vue` | Replaced by `frontend/src/app/page.tsx` + section components |
| `layouts/default.vue` | `layouts/default.vue` | Replaced by `frontend/src/app/layout.tsx` |
| `app.vue` | `app.vue` | Nuxt root — no Next.js equivalent needed |

---

## 2. New Components to Build

All `.tsx` under `frontend/src/components/`.

| Component | Purpose | Build status |
|---|---|---|
| `DashboardShell` | Page-level layout wrapper (max-width, grain, global styles) | Not started |
| `TopStatusStrip` | Service state, last refresh, next refresh, poller status | Not started |
| `SectionState` | Unified loading / empty / error / stale placeholder for sections | Not started |
| `HealthSummaryRow` | Row container for 5 health signal cards | Not started |
| `HealthSignalCard` | Single health signal card (replaces SummaryCards + MetricCard) | Not started |
| `TrendCard` | Card wrapper for trend charts (replaces 3 chart components) | Not started |
| `TrendEChart` | Raw ECharts React wrapper with shared theme + resize + dispose | Not started |
| `AttentionQueue` | Stale/blocked work list container (replaces StaleWorkTable) | Not started |
| `AttentionRow` | Single row in attention queue | Not started |
| `ModelUsageRankList` | Ranked model usage list (replaces SessionUsageSection internals) | Not started |
| `UsageBar` | Horizontal bar for token/cost breakdown | Not started |
| `SourceHealthSection` | Lazy-loaded diagnostics panel | Not started |

---

## 3. Stores, Hooks, and Utilities

| Name | Type | Location | Build status |
|---|---|---|---|
| `useDashboardStore` | Zustand store | `frontend/src/store/dashboard.ts` | Partial — holds `unknown` data, needs `LatestState` typing and repo-key selection |
| `useDashboardState` | Hook | `frontend/src/hooks/useDashboardState.ts` | Done — thin wrapper over store |
| `useEChartsTheme` | Hook | `frontend/src/hooks/useEChartsTheme.ts` | Done — returns shared dark theme config |
| `useStaggerAnimation` | Hook | — | Not started — Framer Motion stagger variants |
| `cn()` | Util | `frontend/src/lib/utils.ts` | Done |
| `fetchState` / `triggerRefresh` / `fetchDiagnostics` | API client | `frontend/src/lib/api-client.ts` | Done — stubs, needs real backend wiring |
| Number/date formatters | Util | — | Not started — need `formatCompactNumber`, `formatTimestamp`, age calculator |

---

## 4. API Routes

| Route | Nuxt source | Next.js target | Build status |
|---|---|---|---|
| `GET /api/state` | `server/api/state.get.ts` | `frontend/src/app/api/state/route.ts` | Stub — returns static empty shape |
| `POST /api/refresh` | `server/api/refresh.post.ts` | `frontend/src/app/api/refresh/route.ts` | Stub — returns "not implemented" |
| `GET /api/diagnostics` | — | `frontend/src/app/api/diagnostics/route.ts` | Stub — returns empty shape |

---

## 5. Page Architecture

### Current (Nuxt)

```
nuxt.config.ts
app.vue
  └── layouts/default.vue
        └── pages/index.vue
              ├── Service Status (UiCard)
              ├── SummaryCards (Throughput / CycleTime / CI / Stale / PR)
              │   └── MetricCard (×N)
              ├── ThroughputChart → TrendChart
              ├── CycleTimeChart → TrendChart
              ├── CIHealthChart → TrendChart
              ├── StaleWorkTable
              └── SessionUsageSection
                    └── MetricCard (×N)
```

### Target (Next.js)

```
frontend/src/app/layout.tsx (fonts, metadata, grain overlay)
  └── frontend/src/app/page.tsx
        └── DashboardShell
              ├── TopStatusStrip (reads from store)
              ├── HealthSummaryRow (receives cards prop)
              │   └── HealthSignalCard (×5)
              ├── TrendArea (receives days prop)
              │   └── TrendCard → TrendEChart
              ├── AttentionQueueSection (receives issues+prs prop)
              │   └── AttentionRow (×N)
              ├── SessionUsageSection (receives sessionUsage prop)
              │   ├── SessionSummaryCard
              │   └── ModelUsageRankList → UsageBar
              └── SourceHealthSection (lazy, reads /api/diagnostics)
```

---

## 6. Shared Code Migration

These directories move from `server/` to repo root so both the Next.js frontend (`app/api/`) and standalone collector scripts can import them.

| Current location | Target location | Status |
|---|---|---|
| `server/db/` (schema, client) | `db/` | Not started |
| `server/lib/` (orchestrator, collectors, refresh, poller) | `collector/` | Not started |
| `types/` | `types/` (stays) | Done — already at root |
| `utils/` | `utils/` (stays) | Done — already at root |

---

## 7. Nuxt Infrastructure to Delete

Only after all replacements are built, tested, and no imports remain.

| File / directory | Reason |
|---|---|
| `nuxt.config.ts` | Nuxt config — replaced by `frontend/next.config.ts` |
| `app.vue` | Nuxt root component |
| `app.config.ts` | Nuxt app config (if present) |
| `pages/` | Nuxt pages — replaced by `frontend/src/app/` |
| `layouts/` | Nuxt layouts — replaced by `frontend/src/app/layout.tsx` |
| `components/*.vue` | All 11 Vue components |
| `server/` | Nuxt server — API routes move to `frontend/src/app/api/`, db/lib move to root |
| `assets/` | Nuxt assets — move to `frontend/public/` or `frontend/src/app/` |
| `.nuxt/`, `.output/` | Nuxt build artifacts |
| Nuxt-specific deps in root `package.json` | `nuxt`, `vue` |

---

## 8. Migration Sequence

Tracks build order. A step is **done** only when the component renders correct data and no old component imports it.

| Step | What | Status |
|---|---|---|
| 1 | `DashboardShell` + `TopStatusStrip` + `SectionState` | Not started |
| 2 | `store/dashboard.ts` — typed Zustand store with `LatestState` | Partial (store exists, needs typing) |
| 3 | `HealthSummaryRow` + `HealthSignalCard` | Not started |
| 4 | `TrendCard` + `TrendEChart` + `useEChartsTheme` | Partial (`useEChartsTheme` done) |
| 5 | `AttentionQueue` + `AttentionRow` | Not started |
| 6 | `ModelUsageRankList` + `UsageBar` | Not started |
| 7 | `SourceHealthSection` (lazy) | Not started |
| 8 | Wire API routes to real backend (db + collector) | Not started |
| 9 | Move `server/db/` → `db/`, `server/lib/` → `collector/` | Not started |
| 10 | Delete old Nuxt/Vue infrastructure | Not started |

---

## 9. Removal Criteria

A Vue component can only be deleted when **all** of these are true:

1. Its replacement is built and rendering correct data
2. No other component imports it
3. Migration tests pass (same data → same visual output)
4. No half-migrated components depend on it
