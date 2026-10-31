# ORDIQ — Order Meets Intelligence

AI-based class scheduling decision-support system for the **College of Engineering**, **Manuel S. Enverga University Foundation (MSEUF)**, Lucena City.

> **Authoritative Plan:** See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the complete architecture, constraint catalogue (`HC-01`–`HC-15`, `SC-01`–`SC-16`), data model, and phase-by-phase build checklist.

---

## Architecture Overview

ORDIQ uses a **modular monolith + stateless Python engine** architecture:

- **`apps/web`** (Next.js App Router, TypeScript strict, Tailwind CSS, shadcn/ui, TanStack Query, Prisma + PostgreSQL):
  - App Shell, Dashboard, Spreadsheet Workspace, Timetable, Reports, AI Assistant, Privacy Gateway (`Faculty.alias`), and `/api/v1/*` route handlers.
- **`packages/contracts`**:
  - Deterministic TypeScript types generated from `services/engine`'s OpenAPI 3.1 schema, plus shared domain enums.
- **`services/engine`** (Python 3.12, FastAPI, Pydantic, Google OR-Tools CP-SAT, scikit-learn):
  - Stateless optimization solver, independent hard-constraint validator oracle, and ML recommendation/preference learning service.

---

## Quick Start (Docker Compose)

Start PostgreSQL, the Python scheduling engine, and the Next.js web application with one command:

```bash
cp .env.example .env
docker compose up --build
```

- **Web Application:** `http://localhost:3000`
- **Web System Health API:** `http://localhost:3000/api/v1/health`
- **Engine Liveness API:** `http://localhost:8000/healthz` (requires `X-Engine-Token` header)

---

## Local Development Setup

### Prerequisites

- **Node.js** `>= 22` and **pnpm** `12.x`
- **Python** `3.12` and **uv**
- **PostgreSQL** `16` (or via `docker compose up postgres -d`)

### 1. Environment Configuration

```bash
cp .env.example .env
```

### 2. Python Engine (`services/engine`)

```bash
cd services/engine
uv sync
uv run ruff check .
uv run mypy engine tests scripts
uv run pytest
uv run uvicorn engine.main:app --reload --port 8000
```

### 3. Web App & Contracts (`apps/web`, `packages/contracts`)

```bash
pnpm install
pnpm contracts:check
pnpm --filter @ordiq/web db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm dev
```

### 4. Regenerating OpenAPI Contracts

Whenever a Pydantic schema or FastAPI route changes in `services/engine`:

```bash
cd services/engine && uv run python scripts/export_openapi.py
cd ../.. && pnpm contracts:generate
```

