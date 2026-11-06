# ADR 0001: One state repository with a unit of work per request

- Status: Accepted (2026-11-02)
- Decision log: D-25

## Context

Phases 1 to 7 built every service against one in-memory `MasterDataState`, which holds Maps of records plus arrays for usage and learning events. The state was lost on restart, and with more than one server instance each instance had its own copy. The plan expected a `*.repo.ts` per module.

Rewriting all services to call Prisma would have made every service asynchronous and database-bound, and touched every test. The data is small: one college, one Dean, a few thousand records per term.

## Decision

- The in-memory state stays the domain model. `src/server/repo/state.repository.ts` maps each collection to its table (`COLLECTIONS`, listed in foreign-key order). It can load the whole state, and it can compute and apply a diff.
- **Change detection.** A snapshot holds a JSON fingerprint per record. `diffState` compares the current state with the snapshot and returns the upserts and deletes per table. This catches `Map.set` replacements and in-place mutation of nested arrays alike.
- **Writes.** Each table gets one statement per save: `INSERT ... SELECT FROM jsonb_populate_recordset(...) ON CONFLICT (id) DO UPDATE`. Deletes run children first, and upserts run parents first. Child rows (schedule entries, messages) are replaced together with their parent.
- **Unit of work.** `withDeanRoute` (`src/server/http/dean-route.ts`) wraps every Dean API route:
  - GET and HEAD refresh the state if `system_state.version` changed, then run.
  - Other methods run one at a time per instance. After the handler finishes, the changes are saved in one transaction that also advances `system_state.version`.
  - If another instance saved first, the request fails with 409 `CONCURRENT_MODIFICATION`.
  - Any error marks the state stale, so the next request reloads it from the database.
- PostgreSQL (Supabase) is the only store for the running app, in development and production alike. Only the automated test suite (`NODE_ENV=test`) runs the services and auth purely in memory.

## Consequences

- Services and tests are unchanged and stay synchronous. The database is reached through one write path only.
- Every write request pays for a fingerprint diff of the whole state. At college size this takes milliseconds; at a much larger size it would not.
- Writes are serialized across instances by the version check. Two concurrent writes on different instances lead to one 409, which is acceptable with a single Dean.
- A schedule's entries are rewritten whenever the schedule changes.
- `state.persistence.int.test.ts` checks a full round trip against a real database inside a transaction that is rolled back (`ORDIQ_DB_TEST=1`).
