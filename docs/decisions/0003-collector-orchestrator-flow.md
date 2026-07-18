# ADR-0003: Collector → orchestrator → SQLite → API → UI data flow

- **Status**: Accepted
- **Date**: 2026-06-14
- **Number**: 0003

## Context

Signal House is a single-process local dashboard that collects data from
multiple upstream sources (GitHub API, local git repositories, OpenCode CLI,
Hermes Agent) and presents it in a Next.js UI. The data flow architecture
needed to support:

- Multiple source types with different APIs and data shapes.
- A single atomic refresh cycle that produces consistent snapshots.
- Local-only operation — no separate daemon, no message bus, no network service.

## Decision

Adopt a strict linear pipeline: **collectors → orchestrator → SQLite → API → UI**.

Each layer has a single responsibility:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| Collectors | `server/lib/<source>/` | One folder per source. Each exports `createCollector(config) → { collect(): Promise<CollectorResult> }`. |
| Orchestrator | `server/lib/orchestrator/index.ts` | Single fan-out point. Runs collectors in parallel (cap = `SECRET_HOUSE_COLLECT_CONCURRENCY`, default 3), builds `privacyMap`, persists one atomic snapshot. |
| Database | `server/db/{client.ts, schema.ts}` | SQLite at `~/.local/share/signal-house/runtime/.data/metrics.db`. 13 tables across snapshots, aggregates, source data, and daily metrics. |
| API routes | `frontend/src/app/api/...` | Two main endpoints: `GET /api/state`, `POST /api/refresh`. Plus diagnostics, token usage history, and lock reset. |
| UI | `frontend/src/app/page.tsx` | Next.js dashboard. Polls `/api/state` every 30s when the page is open. |

### Rejected alternatives

1. **Direct GitHub from API routes (UI talks to upstream directly).**
   Rejected because it breaks the local-only invariant. The UI is a local
   dashboard — it should never need network access to function. It also
   duplicates collector logic in the API layer.

2. **A separate read-replica DB.**
   Rejected because it adds operational complexity (another process, sync
   mechanism, failure modes) for no benefit at single-process scale.

3. **Denormalized everything into `daily_metrics` only (no separate
   `source_*` tables).**
   Rejected because losing raw source data means you cannot re-aggregate
   when the aggregation logic changes. The `source_*` tables preserve the
   raw data for future re-aggregation and debugging.

## Consequences

- **Positive**: Clear ownership. Each layer has a single responsibility
  and a single entry point. Adding a new data source means adding a
  collector — no other layer changes.
- **Positive**: Atomic snapshots. The orchestrator collects all data before
  persisting, so the SQLite database is always consistent.
- **Positive**: The UI never needs upstream access. It reads from the API
  routes, which read from the local database. This works offline.
- **Negative**: The orchestrator is a single point of failure. If a collector
  hangs, the entire refresh stalls — mitigated by the concurrency cap and
  per-collector timeouts.
- **Negative**: The pipeline is synchronous within a refresh cycle.
  Collectors run in parallel but the orchestrator waits for all to finish
  before persisting. This is acceptable at current scale but would need
  rethinking for large multi-source deployments.

## References

- `docs/architecture.md §0` — "It's a single Node process" and "The UI
  never talks to GitHub, git, or any upstream source directly."
- `server/lib/orchestrator/index.ts` — orchestrator entry point and refresh
  cycle implementation
- `server/lib/<source>/` — per-source collector modules (github, git, hermes,
  opencode, sessions, upstream)