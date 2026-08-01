# Agent instructions

## Code style

- Follow existing project patterns. Read the relevant source before
  writing new code in the same area.
- Keep changes scoped to the task. The smallest change that solves
  the problem.
- Prefer explicit over clever. A reader at 2am with a pager should
  understand every line.
- Don't introduce `// @ts-ignore`, `as any`, or other escape hatches
  unless absolutely necessary, and document the reason if you do.

## Comments

- Comments explain why, never what. The code says what; the comment
  says why.
- If a non-obvious decision exists in the code, the comment that
  documents it is mandatory, not optional.
- If you delete code, delete its comments too. Dead comments rot
  faster than dead code.

## Types

- Numbers that can be unknown use `number | null`, not `0`. Display
  `null` as `"—"` or a "no data" label, never as `0`.
- Booleans that can be unknown use `boolean | null`.
- Two booleans in a signature = a discriminated union.
- Five+ parameters = an object.
- TypeScript `strict` stays on. If a new type forces you to add an
  escape hatch, that is a signal to question the type.

## Tests

- Bun's test runner (`bun:test`). Tests live in `tests/`
  (unit + contract), Playwright e2e specs live in `e2e/`.
- Red test first, then implementation.
- If a test encodes a wrong default, invert the test, then fix the
  production code. Don't write new code around a bad test.
- Tests are a love letter to your future self. Write the test you
  wish existed.

## Working style

- Don't rewrite when an edit will do. If a follow-up is needed
  outside the current task's scope, note it with `@todo`.
- Keep `README.md` and `.env.example` up to date when the change
  affects user-facing behaviour or config surface.
- Don't add dependencies for things the standard library can do.
