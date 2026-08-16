## Why

The standalone **Cache Savings** card on the dashboard is being temporarily retired from the rendered view while its underlying metrics continue to feed `AgentSpend` and the `/api/state` payload. Hiding the render (not deleting the component, CSS, or pipeline) keeps re-enablement a one-line uncomment and avoids disrupting the contract tests that depend on the cache fields flowing through the API.

## What Changes

- The `<CacheSavingsCard state={state} />` render in `src/web/app/App.tsx` (line 54) and its import (line 16) are commented out so the card no longer appears on the dashboard.
- The `CacheSavingsCard` component (`src/web/components/CacheSavingsCard.tsx`), its `.cache-card*` CSS, and the cache-metrics pipeline in `src/orchestrator/aggregates.ts` and `src/api/build-state.ts` are **not** deleted or modified.
- The e2e UI assertion `"cache savings card renders with hit rate and savings tiles"` in `e2e/dashboard.spec.ts` is updated to reflect the card no longer rendering. The API-payload e2e test (`"cache savings API surfaces additive cache fields"`) and the contract test (`tests/contract/api.test.ts`) remain intact, since `cacheReadTokens` / `cacheHitRate` / `cacheSavings` still flow through `/api/state`.
- Standalone card-rendering requirements in the `usage-metrics` capability are retired via a `## REMOVED Requirements` block; aggregate/pipeline requirements stay in force.

## Capabilities

### New Capabilities

- _(none)_ The dashboard's cache-metrics surface is already captured by the existing `usage-metrics` capability; no new capability is introduced.

### Modified Capabilities

- `usage-metrics`: Retires the standalone `CacheSavingsCard` rendering requirements (empty-state rendering, window rescaling of the card's savings figure, per-provider breakdown toggle, mobile reflow) while keeping the windowed hit-rate, per-model savings computation, by-model table cache-% column/sort, daily chart `cache_read` series, additive API state shape, and palette/typography reuse requirements in force. Pipeline/aggregate behavior is unchanged.

## Impact

- **Code**: `src/web/app/App.tsx` (comment out import + JSX render); `e2e/dashboard.spec.ts` (update the one card-render assertion).
- **API / data model**: none — `StatePayload` keeps `cacheReadTokens`, `cacheHitRate`, `cacheSavings`; `summary.costAndTokens` forwarding in `src/api/build-state.ts` is untouched.
- **Dependencies**: none.
- **Tests**: one e2e UI test changes; `bun run typecheck`, `bun test`, and `bunx playwright test` must stay green.
- **Re-enable**: uncomment the import and the `<CacheSavingsCard state={state} />` line and restore the e2e assertion — a one-line render change.
