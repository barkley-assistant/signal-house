# Hermes Data Collector

Hermes (`~/.hermes/state.db`) stores `started_at` and `ended_at` as `REAL` Unix epoch **seconds**. The collector queries this database to compute token usage metrics.

## Epoch unit contract

| Source | Column | Unit | Date constructor |
|--------|--------|------|-----------------|
| Hermes `state.db` | `started_at`, `ended_at` | epoch **seconds** | `new Date(value * 1000)` |
| OpenCode `state.db` | `time_created` | epoch **milliseconds** | `new Date(value)` |

Key rules:

1. **SQL bind params**: Always bind epoch seconds (number) to `started_at >= ?` / `started_at < ?` comparisons. Never bind ISO 8601 strings — SQLite type affinity causes TEXT-vs-REAL comparisons to always return zero rows.
2. **Reading from DB**: `better-sqlite3` returns REAL columns as JS `number`. Multiply by 1000 before passing to `new Date()` which expects milliseconds.
3. **Date → epoch seconds**: `Math.floor(date.getTime() / 1000)` or `Math.floor(Date.now() / 1000)`.
4. **Collector caller**: `collector.ts` computes `since` as `Math.floor((Date.now() - 28d) / 1000)` and passes it to `queryModelBreakdown(since: number)`.
