## 1. Hide the standalone CacheSavingsCard render

- [x] 1.1 In `src/web/app/App.tsx`, comment out the import at line 16 (`import { CacheSavingsCard } from "../components/CacheSavingsCard";`) with a short note that it is temporarily hidden, so a reader can see what was removed.
- [x] 1.2 In `src/web/app/App.tsx`, comment out the render at line 54 (`<CacheSavingsCard state={state} />`), preserving its position between `<HealthStrip state={state} />` and `<AgentSpend />` so re-enable restores the exact card order.
- [x] 1.3 Confirm `src/web/components/CacheSavingsCard.tsx`, the `.cache-card*` rules in `src/web/styles/components.css`, `src/orchestrator/aggregates.ts`, and `src/api/build-state.ts` are NOT modified.

## 2. Update the e2e card-render assertion

- [x] 2.1 In `e2e/dashboard.spec.ts`, update or remove the test `"cache savings card renders with hit rate and savings tiles"` (lines 131-140) to reflect that the standalone card no longer renders (e.g. assert the "Cache Savings" heading is absent), keeping the spec readable.
- [x] 2.2 Leave the `"cache savings API surfaces additive cache fields"` test (lines 142-150) intact — it asserts only the `/api/state` payload, which still carries `cacheReadTokens` / `cacheHitRate` / `cacheSavings`.
- [x] 2.3 Leave `tests/contract/api.test.ts` ("state payload includes additive cache fields") and `tests/unit/web/dashboard.test.tsx` ("ModelTable cache % sort") untouched.

## 3. Verify no regressions

- [x] 3.1 Run `bun run typecheck` (`bunx tsc --noEmit`) and confirm it passes with the import and render commented out (no unused-symbol type error introduced).
- [x] 3.2 Run `bun test tests/` and confirm the unit/contract suite is green, including `tests/unit/aggregates.test.ts`, `tests/unit/cache-metrics.test.ts`, and `tests/contract/api.test.ts`.
- [x] 3.3 Run `bunx playwright test` and confirm the e2e suite is green, including the updated card-render test and the unchanged API-payload test.
- [x] 3.4 Spot-check `bun run lint` (`bunx eslint .`) — the commented import should not produce a hard error (no-unused-vars is a warning); confirm no new warnings beyond the expected commented-line notice.
