# ADR-0002: SECRET_HOUSE_* environment variable prefix

- **Status**: Accepted
- **Date**: 2026-06-15
- **Number**: 0002

## Context

The project was originally branded as "Clawd Barkley" and used environment
variable names like `GITHUB_TOKEN`, `METRICS_POLL_INTERVAL_SECONDS`, and
`SESSIONS_PERIOD_DAYS`. During the rename to Signal House, a naming collision
risk emerged: generic names like `GITHUB_TOKEN` could conflict with other tools
or daemons running on the same machine.

A rename alone would break existing deployed `.env` files and systemd units
that use the legacy names. Backward compatibility was required.

## Decision

Adopt a `SECRET_HOUSE_*` prefix for all Signal House environment variables
(e.g., `SECRET_HOUSE_GITHUB_TOKEN`, `SECRET_HOUSE_POLL_INTERVAL_SECONDS`).

Introduce a two-argument `getEnv(env, key, fallbackKey?)` helper in
`server/lib/env.ts` that checks the preferred name first, then the legacy
fallback:

```typescript
export function getEnv(env: NodeJS.ProcessEnv, key: string, fallbackKey?: string): string | undefined {
  return firstDefined([env[key], fallbackKey ? env[fallbackKey] : undefined])
}
```

This makes the rename non-breaking at the operator level. The preferred
`SECRET_HOUSE_*` name takes precedence; the legacy name is used only when
the preferred name is absent.

### Rejected alternative

Renaming all variables without fallback support was rejected. Existing
deployments would silently stop working until every `.env` file was updated,
which is an unacceptable operator burden.

## Consequences

- **Positive**: Clear namespace ownership. No collisions with other tools
  (OpenCode, git, system daemons) that might read `GITHUB_TOKEN`.
- **Positive**: Graceful migration path. Operators can update `.env` files
  at their own pace — the legacy names keep working until they do.
- **Negative**: Every config variable needs two entries in documentation
  (preferred + legacy). See `README.md`'s "Legacy Env Names" section and
  `server/lib/runtime-config.ts` for the full list.
- **Negative**: New contributors may be confused by which name to use.
  Convention: always set the `SECRET_HOUSE_*` name; only use legacy names
  when following old documentation.

## References

- Commit (rename + prefix intro): [`3e533f6`](https://github.com/barkley-assistant/signal-house/commit/3e533f6)
- Commits (rebrand to agent-agnostic): [`a8b13c4`](https://github.com/barkley-assistant/signal-house/commit/a8b13c4), [`26ca3b6`](https://github.com/barkley-assistant/signal-house/commit/26ca3b6)
- PR: [#327](https://github.com/barkley-assistant/signal-house/pull/327) (closes #326)
- `server/lib/env.ts:1–12` — `getEnv` / `getBooleanEnv` helpers
- `server/lib/runtime-config.ts:81–128` — runtime config reading `SECRET_HOUSE_*` vars with legacy fallbacks