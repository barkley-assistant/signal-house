# Architecture Decision Records

| ADR | Title | Summary |
|-----|-------|---------|
| [0001](0001-privacy-as-aggregate.md) | Privacy as JSON aggregate | Store `isPrivate` map in `aggregates` table as JSON blob — no schema migration needed |
| [0002](0002-secret-house-env-prefix.md) | SECRET_HOUSE_* env prefix | Namespace env vars with `SECRET_HOUSE_*`, fall back to legacy names for backward compat |
| [0003](0003-collector-orchestrator-flow.md) | Collector → orchestrator → SQLite → API → UI | Strict linear pipeline — single-process, local-only, atomic snapshots |
| [0004](0004-explicit-null-privacy-contract.md) | Explicit-null tri-state privacy | `boolean \| null` with fail-closed `null → true` default for unknown privacy status |

New ADRs should use the [template](0000-template.md).