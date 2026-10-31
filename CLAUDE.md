# CLAUDE.md — ORDIQ Repository Guide

Always read and follow [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) before making architectural, schema, constraint, or UI changes.

## Key Architectural Rules

1. **Engine is stateless (`services/engine`):** Never connects to PostgreSQL directly. Receives problem snapshots as JSON and returns validated results.
2. **Single source of truth for hard constraints:** All hard-constraint checks (`HC-01` to `HC-15`) live in `services/engine/engine/validator`, written in plain Python and independent of the CP-SAT solver (`services/engine/engine/solver`).
3. **Strict import boundaries (`apps/web`):**
   - `app → features`
   - `app/api → server/modules → repo → platform`
   - Client/UI code (`src/features/**`, `src/components/**`, `src/app/(shell)/**`) must **never** import from `src/server/**`.
4. **LLM safety & privacy:**
   - All LLM calls must pass through `src/server/ai/privacy` (`Faculty.alias` pseudonymization).
   - The LLM has **no write path**—no tool may apply a proposal, accept a schedule, or mutate master data.
5. **Data minimization:** Section-level student counts only (`D-21`). No individual student records anywhere in the schema, logs, or imports.
6. **Conventions:**
   - Prisma models `PascalCase`, database tables/columns `snake_case` via `@map`/`@@map`.
   - TypeScript `camelCase`, Python `snake_case`.
   - API errors use `{ "error": { "code": "...", "message": "...", "details": {} } }`.
   - Never display mockup numbers from Figure 4 as real schedule metrics.

## Common Commands

- **Validate & test Python engine:**
  `cd services/engine && uv run ruff check . && uv run mypy engine tests scripts && uv run pytest`
- **Export OpenAPI & regenerate TypeScript contracts:**
  `cd services/engine && uv run python scripts/export_openapi.py && cd ../.. && pnpm contracts:generate`
- **Lint, typecheck, and test web workspace:**
  `pnpm contracts:check && pnpm lint && pnpm typecheck && pnpm test`

