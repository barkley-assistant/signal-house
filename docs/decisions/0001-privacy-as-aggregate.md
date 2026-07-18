# ADR-0001: Privacy as JSON aggregate in the aggregates table

- **Status**: Accepted
- **Date**: 2026-07-07
- **Number**: 0001

## Context

The `isPrivate` field on `RepositoryIdentity` flows correctly from the GitHub API
through the collector into the in-memory snapshot, but gets silently dropped when
the snapshot is normalized to SQLite. The `source_repositories` table has no
`is_private` column and `rowToRepositoryIdentity()` does not map it back.

This caused `buildPrivateRepoKeySet()` to always see `isPrivate: undefined`,
making the private-repo key Set always empty. All issues and PRs passed through
unfiltered regardless of the `SECRET_HOUSE_SHOW_PRIVATE_REPO_ITEMS` setting.

## Decision

Store repository privacy as a separate `repositoryPrivacy` aggregate in the
existing `aggregates` table — a key-value JSON blob, **no schema migration
needed**. The privacy map is built in `createOrchestrator().refresh()` at
`server/lib/orchestrator/index.ts:365–369` from deduplicated repositories:

```typescript
const privacyMap: Record<string, boolean> = {}
for (const repo of deduplicatedRepos) {
  privacyMap[repo.repoKey] = repo.isPrivate ?? true
}
```

The map is persisted into `aggregates.repositoryPrivacy` at line 383 and read
back into the snapshot at `server/db/client.ts:992–1016`. The API route at
`frontend/src/app/api/state/route.ts:106–114` uses `publicRepoKeys` built
from `privacyMap[repoKey] === false` to filter private items.

### Rejected alternative

Adding an `is_private` column to `source_repositories` was ruled out. This
would couple repository metadata to the snapshot lifecycle and require a
schema migration. The existing `aggregates` JSON-blob table already handles
derived data without schema changes.

## Consequences

- **Positive**: No schema migration needed. The `aggregates` table already
  stores JSON blobs for throughput, cycle time, CI, etc. — `repositoryPrivacy`
  fits the same pattern.
- **Positive**: The privacy map is rebuilt on every refresh, so it stays in
  sync with current repository data without manual maintenance.
- **Negative**: The privacy map lives independently of the repository identity
  data. A mismatch between `source_repositories` rows and `privacyMap` entries
  must be caught at runtime — which is why `validatePrivacyMap()` exists at
  `server/lib/orchestrator/index.ts:427–439`.
- **Negative**: Any new code path that adds repository keys must also update
  the privacy map, or `validatePrivacyMap()` flags it as partial data.

## References

- Commit: [`78c6adf`](https://github.com/barkley-assistant/signal-house/commit/78c6adf)
- PR: [#323](https://github.com/barkley-assistant/signal-house/pull/323) (closes #321)
- `types/aggregates.ts:87–89` — `RepositoryPrivacyAggregate` interface
- `server/lib/orchestrator/index.ts:365–369` — privacy map builder
- `server/lib/orchestrator/index.ts:427–439` — `validatePrivacyMap()`