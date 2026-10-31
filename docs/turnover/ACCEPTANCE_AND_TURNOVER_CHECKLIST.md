# ORDIQ Acceptance & Turnover Checklist

**Project:** ORDIQ — AI-Based Class Scheduling Decision-Support System  
**Client:** MSEUF College of Engineering (Proponents & Dean)  
**Quotation Reference:** `Q-2026-002`

---

## 1. Quotation Deliverables Verification (`Q-2026-002`)

| # | Quoted Item | Verification Test / Artifact | Status |
|---|---|---|---|
| 1 | Requirements and data setup (`₱2,000`) | `templates/ordiq-data-gathering-workbook.xlsx`, `templates/DATA_DICTIONARY.md`, `phase1-exit-criteria.test.ts` | Verified |
| 2 | Web application and chat interface (`₱3,500`) | App Shell, Schedule Workspace (`/schedules`), AI Assistant (`/assistant`), `phase3-exit-criteria.test.ts` | Verified |
| 3 | Scheduling engine (`₱4,000`) | Python OR-Tools CP-SAT solver + independent validator (`services/engine`), `phase2-exit-criteria.test.ts` | Verified |
| 4 | Generative AI integration (`₱2,500`) | Privacy Gateway + 14 tools + 32 Golden Prompts in EN/FIL/Taglish, `phase4-and-phase5-exit-criteria.test.ts` | Verified |
| 5 | Machine learning module (`₱10,000`) | Faculty–subject fit recommender + preference learner + model rollback, `phase4-and-phase5-exit-criteria.test.ts` | Verified |
| 6 | Dashboard and reports (`₱2,000`) | Single analytics service + 11 PDF/Excel report exports, `phase6-and-phase7-exit-criteria.test.ts` | Verified |
| 7 | Security and privacy (`₱5,000`) | Argon2id + TOTP 2FA + AES-256-GCM + `Faculty.alias` egress test + append-only `AuditLog` | Verified |
| 8 | Testing, turnover and walkthrough (`₱1,000`) | Stage 1–3 evaluation evidence (`/api/v1/evaluation`) + `docs/turnover/` manuals | Verified |

---

## 2. Sign-Off & Support Record

- **60-Day Free Bug-Fix Support Start Date:** `____________________`
- **Walkthrough Completed On:** `____________________`
- **Developer Data Deletion Confirmed On:** `____________________`
- **Client / Proponent Representative Signature:** `____________________`

