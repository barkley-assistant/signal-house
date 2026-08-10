# caduceus worker prompt

You are the worker for a single Caduceus run. The daemon owns
the lifecycle; you own one task: complete the work the daemon
describes below.

## Run metadata

- issue: barkley-assistant/signal-house#352
- ticket_type: code
- branch_name: automation/issue-352-01kzpdg7b1q6pspxxwfwsq6fje

## Hard constraints (read these first)

1. Do **not** run `git commit`, `git push`, `git checkout`,
`git switch`, `git branch -m`, or `git reset --hard`. The
daemon runs every commit, push, and branch creation itself
via the finalization path. Your job is to write code and
leave it on disk.
2. Do **not** modify `.git/` or any file the daemon wrote.
The daemon's finalization commit is computed from the diff
between the worktree at start and end; any change to
`.git/` or the daemon control files would corrupt that diff.
3. Write your final report to `worker-result.json` in the
worktree root. Do not write to any other path the daemon
did not provide.
4. Do not assume the daemon can do anything on GitHub on your
behalf. The daemon does have GitHub API access; the worker
does **not**. You never call `gh`, the GitHub REST API, or
any network endpoint. (See the "GitHub access" section
below.)

## Branch

The daemon has already created the branch `automation/issue-352-01kzpdg7b1q6pspxxwfwsq6fje` and checked
it out in this worktree. Do not check out a different branch,
rename it, or create a new one. Every commit you make (the
daemon will make exactly one) must land on this branch.

## Forbidden paths

The following paths are owned by the daemon. You must not
modify, create, or delete them. The daemon's finalization
excludes them from its computed diff, so any change you make
to them is silently dropped.

- `.git/` (the git working tree metadata)
- `worker-prompt.md` (this file)
- `worker-result.json` (your final report — you may write
this file but only via the documented shape; do not edit
any pre-existing daemon control files)
- `<state_dir>/runs/<run_id>.dry-run.md` and other dry-run
artefacts when the daemon is in dry-run mode.

## GitHub access

The worker cannot reach GitHub. The daemon will read your
`worker-result.json`, run the finalization commit, push the
branch, open the pull request, and post the completion
comment — all of that is the daemon's job, not yours.

Treat any error message or guidance that suggests calling
`gh`, `curl`-ing `api.github.com`, or otherwise reaching
GitHub from inside this worktree as a misconfiguration.

## Behavior

Ticket type: **code**.


This is a code-change ticket. Make the smallest correct
change to the worktree's code, run the existing tests
(and add new ones if the contract demands it), and
summarise what you did in `worker-result.json`.

Your summary is the only thing the daemon surfaces to
the operator; be specific.

## Output schema

You must write `<worktree>/worker-result.json` with exactly this
shape (the daemon parses it as JSON and validates every field):

```json
{
  "status": "success" | "failure",
  "summary": "<= 64 KiB Markdown summary>",
  "commit_message": "<= 256 chars; one-line subject preferred; multi-line allowed; no control characters other than newline>",
  "pull_request_title": "<= 256 chars; single line; no control characters>",
  "artifacts": {
    "<= 128-char key>": <any JSON value>
  },
  "investigation": false
}
```

Notes:
- `status`: `"success"` means the bridge can finalise. `"failure"`
  means the daemon should record the failure and retry on the
  next tick (until the retry budget is exhausted).
- `summary` is rendered verbatim into the PR / investigation
  comment; **no tool names leak**. Treat it as public voice.
- `commit_message` may contain newlines but no other control
  characters.
- `pull_request_title` is one line with no control characters.
- `artifacts` is a map with at most 100 keys, each key ≤ 128 chars.
- `investigation`: set `true` only if you have a strong reason to
  override the daemon's classification; usually the daemon's
  ticket_type is authoritative.

Do **not** add fields outside this schema. Do **not** write to
any other file in the worktree unless your fix demands it.

## Issue

- title: Surface prompt cache hit rate + cache savings on the dashboard
- repo: barkley-assistant/signal-house
- number: 352
- labels: enhancement, frontend, data-viz, autofix

### Body

```text
## What

Surface **prompt cache hit rate + cache savings** on the dashboard.

The data is already flowing — `tokens_cache_read` is captured per session in `src/collectors/opencode/collector.ts:149,163,206,222,248` and `cache_read_tokens` in `src/collectors/hermes/collector.ts:123`, then summed into `daily_metrics` at `src/db/daily-metrics.ts:119`. But none of it reaches the UI: the by-model table and Agent Spend chart show input/output tokens and cost, with no visibility into how much of the input came from the provider's prompt cache.

This is a standard headline metric in comparable observability tools (LangSmith, Helicone, Langfuse all surface it). Signal-house doesn't, and the value is real:

- Probing `~/.local/share/opencode/opencode.db` over the last 30 days: **1.37K sessions** with cache activity, **1.58B cache_read tokens**, aggregate **~26.5% cache hit rate**.
- Per-model hit rate ranges from **44.5% (GLM-5.2)** to **97.7% (Kimi K2.7 Code, DeepSeek V4 Flash 0731)**.
- With the current config (`cost.cache.read = 0` for every model in `~/.config/opencode/opencode.jsonc` — cached reads are free), cache_read tokens represent a direct discount equal to `cache_read × cost.input_rate`. Across the last 30 days that's roughly **$1K–$2.2K in avoided input spend** depending on model mix.

## Why now

Three operator decisions it enables:
1. **Model selection.** Kimi K2.7 Code at 97.7% cache rate has a fundamentally different cost profile than GLM-5.2 at 44.5%. The by-model table currently shows total cost without revealing this.
2. **Subscription justification.** A Pro/OAuth plan is worth its price if cache hits alone save more than the plan costs. We currently can't quantify that.
3. **Cost forecasting.** A 2× traffic increase grows cache-discounted cost slower than naive token volume would suggest.

## Repro (verify the data exists)

~~~~~~
bash
# How much cache_read is actually in opencode.db?
sqlite3 ~/.local/share/opencode/opencode.db <<'SQL'
SELECT COUNT(*) AS sessions_with_cache,
       COALESCE(SUM(tokens_cache_read), 0) AS total_cache_read,
       COALESCE(SUM(tokens_input), 0) AS total_input,
       ROUND(100.0 * SUM(tokens_cache_read) / NULLIF(SUM(tokens_input) + SUM(tokens_cache_read), 0), 1) AS pct
FROM session WHERE tokens_input > 0 OR tokens_cache_read > 0;
SQL

# Per-model breakdown (last 30d) — drives the new by-model table column
sqlite3 ~/.local/share/opencode/opencode.db <<'SQL'
SELECT json_extract(model, '$.id') AS model,
       json_extract(model, '$.providerID') AS provider,
       COUNT(*) AS sessions,
       COALESCE(SUM(tokens_cache_read), 0) AS cache_read,
       COALESCE(SUM(tokens_input), 0) AS input,
       ROUND(100.0 * SUM(tokens_cache_read) / NULLIF(SUM(tokens_input) + SUM(tokens_cache_read), 0), 1) AS cache_pct
FROM session
WHERE time_created >= strftime('%s', 'now', '-30 days') * 1000
  AND tokens_cache_read > 0
GROUP BY model ORDER BY cache_read DESC LIMIT 10;
SQL
~~~~~~


## Proposed changes

1. **New card** showing the time-windowed: cache hit rate (%), total cache_read tokens, estimated $ saved (= `cache_read × model.input_rate`, summed per-model).
2. **Cache-hit-rate column on the existing by-model table** (one extra cell per row, sortable).
3. **4th data series on the existing daily-token-usage chart** for cache_read tokens (stacked or overlaid on the existing input/output bars — pick whatever fits the settled chart grammar).
4. **Server-side aggregation** producing per-day, per-source, per-windowed `cache_hit_rate` + `cache_savings` values. **Additive to the existing shape** — do not change existing keys.
5. **Tests** for the rate formula (per-model division, zero-cache edge case, windowed aggregation), the by-model table sort, and an e2e that the card renders expected values against a known session in `metrics.db`.

## Files expected to change

- `src/metrics/usage-history.ts` — additive aggregate fields (the `queryUsageAggregate` shape)
- `src/api/build-state.ts` — materialize the new fields in the API response
- `src/shared/types.ts` — additive type extensions
- `src/web/components/CacheSavingsCard.tsx` — new component (mirror `HealthStrip.tsx` / `AgentSpend.tsx` grammar; do not invent new shapes)
- `src/web/components/AgentSpend.tsx` — extend the by-model table with the cache-% column
- `src/web/components/DailyTokenUsageCard.tsx` (or `HermesTokenUsageCard.tsx`) — add the 4th series
- `tests/` — additive unit + e2e tests

## Files that should NOT change

- The collectors (`src/collectors/opencode/collector.ts`, `src/collectors/hermes/collector.ts`) — the data flow is already correct, do not modify.
- `src/db/daily-metrics.ts` — `tokens.cache_read` is already summed here.
- `~/.config/opencode/opencode.jsonc` — the operator has set `cost.cache.read = 0` deliberately; do not change the config.

## Acceptance

- Cache hit rate formula: `cache_hit_rate = sum(cache_read) / sum(cache_read + input)` over the window. Guards against `0 + 0 = 0` → returns `0`, never `NaN` or `null`.
- Per-model cache savings: `cache_read × cost.input_rate / 1e6`. The rate lookup walks `src/shared/model-map.json` then falls back to `cost.input` from `~/.config/opencode/opencode.jsonc` (via the opencode collector's existing model lookup — not a new path).
- No cache activity → card shows `—` for hit rate, `0` for tokens saved, `$0.00` for $ saved. Never `NaN`, `null`, or `—` for $ saved.
- Window change (7d → 30d → 90d) rescales the savings proportionally (within 1% tolerance for partial-window days). Same shape as the Agent Spend chart's peak-reset-on-window-change.
- By-model table sortable by cache % (composes with existing cost / sessions / tokens sort orders).
- Card shows a "by provider" line (or expand toggle) so the operator can see whether a provider change helped cache utilization.
- Adding the chart series doesn't change the existing input/output/cost series' data or visible range. Existing chart tests pass unchanged.
- Source discrimination preserved: opencode.db's `cache_read_tokens` and hermes's `cache_read_tokens` are summed at the windowed aggregate layer only — never blended at the cache-hit-rate layer (same separation principle as the existing `byModelBySource` before the v15 collapse).
- Mobile: the new card reflows with the same breakpoints the Agent Spend card uses (≤640px stacked layout).
- No new colors, no new typography. Match the existing `--token-*` palette.

## Notes

- The card's "$ saved" formula assumes the operator's deliberate `cost.cache.read = 0` config (cached reads are free in this openference provider). Comment the formula in the code with that rationale, so the next reader doesn't think we missed a separate cache discount rate.
- The 4th chart series must respect `connectNulls: false` and the `isGap → 0` rule from PR #322.
- The investigation skill `signal-house-investigation` already documents the cache_read data flow end-to-end. Load before exploring — start with §"The cost / provider chain" and §"Pre-flagged bugs" rather than re-deriving the data path.

```

### Context (verbatim `CADUCEUS_CONTEXT_JSON`)

```json
{"schema_version":1,"issue":{"owner":"barkley-assistant","repo":"signal-house","number":352},"issue_title":"Surface prompt cache hit rate + cache savings on the dashboard","issue_body":"## What\n\nSurface **prompt cache hit rate + cache savings** on the dashboard.\n\nThe data is already flowing — `tokens_cache_read` is captured per session in `src/collectors/opencode/collector.ts:149,163,206,222,248` and `cache_read_tokens` in `src/collectors/hermes/collector.ts:123`, then summed into `daily_metrics` at `src/db/daily-metrics.ts:119`. But none of it reaches the UI: the by-model table and Agent Spend chart show input/output tokens and cost, with no visibility into how much of the input came from the provider's prompt cache.\n\nThis is a standard headline metric in comparable observability tools (LangSmith, Helicone, Langfuse all surface it). Signal-house doesn't, and the value is real:\n\n- Probing `~/.local/share/opencode/opencode.db` over the last 30 days: **1.37K sessions** with cache activity, **1.58B cache_read tokens**, aggregate **~26.5% cache hit rate**.\n- Per-model hit rate ranges from **44.5% (GLM-5.2)** to **97.7% (Kimi K2.7 Code, DeepSeek V4 Flash 0731)**.\n- With the current config (`cost.cache.read = 0` for every model in `~/.config/opencode/opencode.jsonc` — cached reads are free), cache_read tokens represent a direct discount equal to `cache_read × cost.input_rate`. Across the last 30 days that's roughly **$1K–$2.2K in avoided input spend** depending on model mix.\n\n## Why now\n\nThree operator decisions it enables:\n1. **Model selection.** Kimi K2.7 Code at 97.7% cache rate has a fundamentally different cost profile than GLM-5.2 at 44.5%. The by-model table currently shows total cost without revealing this.\n2. **Subscription justification.** A Pro/OAuth plan is worth its price if cache hits alone save more than the plan costs. We currently can't quantify that.\n3. **Cost forecasting.** A 2× traffic increase grows cache-discounted cost slower than naive token volume would suggest.\n\n## Repro (verify the data exists)\n\n~~~~~~
bash\n# How much cache_read is actually in opencode.db?\nsqlite3 ~/.local/share/opencode/opencode.db <<'SQL'\nSELECT COUNT(*) AS sessions_with_cache,\n       COALESCE(SUM(tokens_cache_read), 0) AS total_cache_read,\n       COALESCE(SUM(tokens_input), 0) AS total_input,\n       ROUND(100.0 * SUM(tokens_cache_read) / NULLIF(SUM(tokens_input) + SUM(tokens_cache_read), 0), 1) AS pct\nFROM session WHERE tokens_input > 0 OR tokens_cache_read > 0;\nSQL\n\n# Per-model breakdown (last 30d) — drives the new by-model table column\nsqlite3 ~/.local/share/opencode/opencode.db <<'SQL'\nSELECT json_extract(model, '$.id') AS model,\n       json_extract(model, '$.providerID') AS provider,\n       COUNT(*) AS sessions,\n       COALESCE(SUM(tokens_cache_read), 0) AS cache_read,\n       COALESCE(SUM(tokens_input), 0) AS input,\n       ROUND(100.0 * SUM(tokens_cache_read) / NULLIF(SUM(tokens_input) + SUM(tokens_cache_read), 0), 1) AS cache_pct\nFROM session\nWHERE time_created >= strftime('%s', 'now', '-30 days') * 1000\n  AND tokens_cache_read > 0\nGROUP BY model ORDER BY cache_read DESC LIMIT 10;\nSQL\n~~~~~~
\n\n## Proposed changes\n\n1. **New card** showing the time-windowed: cache hit rate (%), total cache_read tokens, estimated $ saved (= `cache_read × model.input_rate`, summed per-model).\n2. **Cache-hit-rate column on the existing by-model table** (one extra cell per row, sortable).\n3. **4th data series on the existing daily-token-usage chart** for cache_read tokens (stacked or overlaid on the existing input/output bars — pick whatever fits the settled chart grammar).\n4. **Server-side aggregation** producing per-day, per-source, per-windowed `cache_hit_rate` + `cache_savings` values. **Additive to the existing shape** — do not change existing keys.\n5. **Tests** for the rate formula (per-model division, zero-cache edge case, windowed aggregation), the by-model table sort, and an e2e that the card renders expected values against a known session in `metrics.db`.\n\n## Files expected to change\n\n- `src/metrics/usage-history.ts` — additive aggregate fields (the `queryUsageAggregate` shape)\n- `src/api/build-state.ts` — materialize the new fields in the API response\n- `src/shared/types.ts` — additive type extensions\n- `src/web/components/CacheSavingsCard.tsx` — new component (mirror `HealthStrip.tsx` / `AgentSpend.tsx` grammar; do not invent new shapes)\n- `src/web/components/AgentSpend.tsx` — extend the by-model table with the cache-% column\n- `src/web/components/DailyTokenUsageCard.tsx` (or `HermesTokenUsageCard.tsx`) — add the 4th series\n- `tests/` — additive unit + e2e tests\n\n## Files that should NOT change\n\n- The collectors (`src/collectors/opencode/collector.ts`, `src/collectors/hermes/collector.ts`) — the data flow is already correct, do not modify.\n- `src/db/daily-metrics.ts` — `tokens.cache_read` is already summed here.\n- `~/.config/opencode/opencode.jsonc` — the operator has set `cost.cache.read = 0` deliberately; do not change the config.\n\n## Acceptance\n\n- Cache hit rate formula: `cache_hit_rate = sum(cache_read) / sum(cache_read + input)` over the window. Guards against `0 + 0 = 0` → returns `0`, never `NaN` or `null`.\n- Per-model cache savings: `cache_read × cost.input_rate / 1e6`. The rate lookup walks `src/shared/model-map.json` then falls back to `cost.input` from `~/.config/opencode/opencode.jsonc` (via the opencode collector's existing model lookup — not a new path).\n- No cache activity → card shows `—` for hit rate, `0` for tokens saved, `$0.00` for $ saved. Never `NaN`, `null`, or `—` for $ saved.\n- Window change (7d → 30d → 90d) rescales the savings proportionally (within 1% tolerance for partial-window days). Same shape as the Agent Spend chart's peak-reset-on-window-change.\n- By-model table sortable by cache % (composes with existing cost / sessions / tokens sort orders).\n- Card shows a \"by provider\" line (or expand toggle) so the operator can see whether a provider change helped cache utilization.\n- Adding the chart series doesn't change the existing input/output/cost series' data or visible range. Existing chart tests pass unchanged.\n- Source discrimination preserved: opencode.db's `cache_read_tokens` and hermes's `cache_read_tokens` are summed at the windowed aggregate layer only — never blended at the cache-hit-rate layer (same separation principle as the existing `byModelBySource` before the v15 collapse).\n- Mobile: the new card reflows with the same breakpoints the Agent Spend card uses (≤640px stacked layout).\n- No new colors, no new typography. Match the existing `--token-*` palette.\n\n## Notes\n\n- The card's \"$ saved\" formula assumes the operator's deliberate `cost.cache.read = 0` config (cached reads are free in this openference provider). Comment the formula in the code with that rationale, so the next reader doesn't think we missed a separate cache discount rate.\n- The 4th chart series must respect `connectNulls: false` and the `isGap → 0` rule from PR #322.\n- The investigation skill `signal-house-investigation` already documents the cache_read data flow end-to-end. Load before exploring — start with §\"The cost / provider chain\" and §\"Pre-flagged bugs\" rather than re-deriving the data path.\n","labels":["enhancement","frontend","data-viz","autofix"],"comments":[],"trusted_comments":[],"events":[{"kind":"labeled","actor":"barkley-assistant","created_at":"2026-08-10T17:51:33Z","label_name":"enhancement"},{"kind":"labeled","actor":"barkley-assistant","created_at":"2026-08-10T17:51:33Z","label_name":"frontend"},{"kind":"labeled","actor":"barkley-assistant","created_at":"2026-08-10T17:51:33Z","label_name":"data-viz"},{"kind":"labeled","actor":"barkley-assistant","created_at":"2026-08-10T17:56:24Z","label_name":"autofix"}],"truncation":{"comments_truncated":false,"trusted_comments_truncated":false,"events_truncated":false,"dropped_untrusted_comments":0,"dropped_trusted_comments":0,"dropped_events":0,"body_truncated_count":0,"total_body_bytes_dropped":0},"built_at":"2026-08-10T18:03:36.107034883Z"}
```

## End of prompt

If the prompt above is truncated or missing, refuse to
proceed and write a `status: "failure"` `worker-result.json`
with a clear summary. The daemon will record the failure and
retry on the next tick.

