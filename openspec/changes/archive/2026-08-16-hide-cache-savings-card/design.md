## Context

The dashboard shell `src/web/app/App.tsx` renders top-level cards fed by the `useDash()` Zustand store, in order: `<HealthStrip />` → `<CacheSavingsCard state={state} />` → `<AgentSpend />` → `<AttentionQueue />` → `<SourceDiagnostics />`. The cache-metrics pipeline that feeds the card runs from `src/orchestrator/aggregates.ts` (`fillUsageDefaults` / `buildSnapshotUsage`) through `src/api/build-state.ts`, which forwards `cacheReadTokens`, `cacheHitRate`, and `cacheSavings` in both `state.usage` and `state.summary.costAndTokens`. `AgentSpend` (`src/web/components/AgentSpend.tsx`) consumes the same metrics independently via its `DailyUsageChart` (`cacheRead` series) and `ModelTable` (`cacheHitRate` column), so those surfaces keep rendering cache data regardless of the standalone card. See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**
- Make the standalone `CacheSavingsCard` not appear on the dashboard with the smallest possible diff (comment-out, not delete).
- Keep the component, its `.cache-card*` CSS, and the entire cache-metrics pipeline untouched so `AgentSpend`, `/api/state`, and the contract/API-payload tests are unaffected.
- Keep re-enablement a one-line uncomment (import + JSX render) with a matching one-test restore.

**Non-Goals:**
- Removing the `CacheSavingsCard` component, its CSS, or any pipeline code.
- Changing the cache-metrics API shape (`cacheReadTokens` / `cacheHitRate` / `cacheSavings`) or the `summary.costAndTokens` forwarding.
- Touching how `AgentSpend`'s chart or `ModelTable` consumes cache metrics.
- Any permanent spec change beyond retiring the standalone-card rendering requirements for the hide period.

## Decisions

**Comment out, do not delete (`src/web/app/App.tsx`).**
- Line 16: `import { CacheSavingsCard } from "../components/CacheSavingsCard";` → comment out.
- Line 54: `<CacheSavingsCard state={state} />` → comment out.
- Rationale: the goal is a *temporary* hide and a trivial, reversible PR. Deleting the import/component/CSS would force a larger diff, lose the re-enable-one-line property, and risk the contract/API-payload tests that depend on the pipeline. Commenting preserves the render's position in the card order so re-enable restores the exact layout.
- Alternative considered: delete the import and JSX, relying on `git revert` for restore. Rejected — loses the "reader sees what was removed" property the user asked for and makes the diff less obviously a temporary hide.
- Alternative considered: gate the render behind a feature flag. Rejected — disproportionate for a one-line temporary hide; introduces a new config surface and a test path the user did not ask for.

**Keep the `CacheSavingsCard` component, `.cache-card*` CSS, and pipeline in tree.**
- `src/web/components/CacheSavingsCard.tsx`, `.cache-card__*` rules in `src/web/styles/components.css`, and `src/orchestrator/aggregates.ts` / `src/api/build-state.ts` are not edited.
- Rationale: `AgentSpend` reads `cacheRead` and `cacheHitRate`; `/api/state` carries `cacheReadTokens`/`cacheHitRate`/`cacheSavings`; `tests/contract/api.test.ts` ("state payload includes additive cache fields") and the e2e `"cache savings API surfaces additive cache fields"` test depend on those fields. Removing the pipeline would break those consumers and tests.

**Update only the card-render e2e assertion; leave the API-payload e2e and contract tests intact.**
- `e2e/dashboard.spec.ts:131-140` — `"cache savings card renders with hit rate and savings tiles"` asserts the rendered heading "Cache Savings", the `Hit rate` / `Saved` tiles, and the provider-breakdown button. With the card hidden these selectors will fail, so the test must be updated (removed or rewritten to assert the card is absent) — see tasks.
- `e2e/dashboard.spec.ts:142-150` — `"cache savings API surfaces additive cache fields"` asserts only the `/api/state` payload and is unaffected; it stays as-is.
- `tests/contract/api.test.ts:216-241` and `tests/unit/web/dashboard.test.tsx:306-352` ("ModelTable cache % sort") do not assert the card and stay as-is.

**No `// @ts-ignore` or escape hatches.** Commenting an import and a JSX line does not introduce unused-symbol lint failures: `@typescript-eslint/no-unused-vars` is a warning and the import will be commented alongside its usage, so neither the import nor the component is referenced. `bun run typecheck` (`bunx tsc --noEmit`) sees neither the import nor the render, so no unused-symbol type error is introduced.

## Risks / Trade-offs

- **Commented-out code rot.** A commented import and JSX line can drift from the surrounding code if `App.tsx` is refactored while the card is hidden. → Mitigation: the change is explicitly temporary; the e2e restore is documented in the spec `Migration` notes and in `tasks.md`. Reviewer should confirm the commented lines still reference a component that exists at re-enable time.
- **Spec-level coverage gap for source discrimination during the hide.** Retiring `Per-provider breakdown and source discrimination` removes its pipeline invariant from the spec text, even though the pipeline is unchanged. → Mitigation: `tests/unit/aggregates.test.ts` and `tests/unit/cache-metrics.test.ts` keep enforcing source discrimination at the aggregate layer throughout the hide; the spec `Reason`/`Migration` notes record that the invariant remains code-enforced and that re-enable restores the spec requirement.
- **Stale CSS in the bundle.** `.cache-card*` rules remain in `components.css` and ship unused. → Accepted: the user explicitly required keeping the CSS, and the size cost is negligible for a temporary hide.

## Migration Plan

- Deploy: comment out the import (line 16) and the render (line 54) in `src/web/app/App.tsx`; update the one e2e UI test; ship. No data migration, no API change.
- Rollback / re-enable: uncomment line 16 and line 54 in `src/web/app/App.tsx` and restore the e2e `"cache savings card renders with hit rate and savings tiles"` assertion. One-line render change; no pipeline or spec rework.

## Open Questions

None. The scope is a deliberate, fully-specified one-line render hide.
