# ORDIQ Operations & Administration Manual

**System:** ORDIQ ("Order Meets Intelligence") — AI-Based Class Scheduling Decision-Support System  
**Client:** College of Engineering, Manuel S. Enverga University Foundation (MSEUF), Lucena City  
**Quotation Reference:** `Q-2026-002`

---

## 1. Starting and Stopping the System

### Production Docker Compose
```bash
# Start all services (PostgreSQL 16, Python 3.12 CP-SAT/ML Engine, Next.js 15 Web App)
docker compose up -d --build

# Check service health
docker compose ps
curl -s http://localhost:3000/api/v1/health

# Stop all services cleanly
docker compose down
```

### Network Isolation
- Only `apps/web` (port `3000` behind TLS reverse proxy) is exposed to the network.
- `services/engine` (port `8000`) and `postgres` (port `5432`) run on an internal Docker bridge network with no public internet exposure, and every Web → Engine call requires the shared `X-Engine-Token` header.

---

## 2. Seeding or Resetting the Dean Account

Public account registration is permanently disabled (`D-20`). The Dean's account is managed exclusively via the CLI seed script:

```bash
pnpm --filter @ordiq/web db:seed-dean
```

- Passwords are hashed using **Argon2id**.
- First login requires **TOTP 2FA** enrollment (Google Authenticator, Microsoft Authenticator, or Authy) and generates single-use recovery codes.
- TOTP secrets are encrypted at rest using AES-256-GCM with `APP_ENCRYPTION_KEY`.

---

## 3. Switching AI Providers (`LLM_PROVIDER`)

ORDIQ supports switching LLM providers via `.env` without any code changes (`D-09`):

```env
# Options: openai | anthropic | ollama
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_MONTHLY_TOKEN_BUDGET=500000
```

- **Cloud (Standard Package):** Set `LLM_PROVIDER=openai` (with `OPENAI_API_KEY`) or `LLM_PROVIDER=anthropic` (with `ANTHROPIC_API_KEY`).
- **On-Premise Local (Premium / Offline Mode):** Set `LLM_PROVIDER=ollama` and `OLLAMA_BASE_URL=http://ollama:11434`.
- Regardless of provider, **all traffic passes through the Privacy Gateway** (`src/server/modules/ai/privacy-gateway.ts`), which replaces all faculty names with `Faculty.alias` (`ALIAS-001`, etc.) before egress.

---

## 4. Database Migrations, Encrypted Backups, and Restore

### Running Migrations
```bash
pnpm --filter @ordiq/web prisma migrate deploy
```

### Nightly Encrypted Backup
```bash
# Dump PostgreSQL database and encrypt with AES-256
docker compose exec -T postgres pg_dump -U ordiq ordiq_db \
  | openssl enc -aes-256-cbc -pbkdf2 -pass env:APP_ENCRYPTION_KEY \
  > backups/ordiq-$(date +%Y%m%d).sql.enc
```

### Restoring from Encrypted Backup
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:APP_ENCRYPTION_KEY \
  -in backups/ordiq-YYYYMMDD.sql.enc \
  | docker compose exec -T postgres psql -U ordiq -d ordiq_db
```

---

## 5. Secret Rotation Checklist for Production Turnover

Before live use with MSEUF College of Engineering data:
1. Generate a fresh 64-hex-character `APP_ENCRYPTION_KEY` (`openssl rand -hex 32`).
2. Generate a fresh `ENGINE_TOKEN` (`openssl rand -hex 32`) and update both `apps/web` and `services/engine`.
3. Generate a fresh `SESSION_SECRET` (`openssl rand -hex 32`).
4. Set `DEAN_INITIAL_PASSWORD` and run `pnpm --filter @ordiq/web db:seed-dean` so the Dean enrolls their own TOTP device.

