# ORDIQ Privacy, Security & Data Governance Notes

**System:** ORDIQ ("Order Meets Intelligence")  
**Quotation Reference:** `Q-2026-002`  
**Compliance Alignment:** Philippine Data Privacy Act of 2012 (RA 10173), ISO/IEC 25010, ISO/IEC 25012

---

## 1. Personal Data Minimization (`D-21`)

1. **Zero Individual Student Records:** ORDIQ operates strictly at the **section level** (`Section.studentCount`, e.g., `CE-1A: 38 students`). No database table, API endpoint, or Excel import sheet accepts or stores student names, student ID numbers, or individual student schedules.
2. **Faculty Pseudonymization (`Faculty.alias`):** Every faculty member is assigned a sequential pseudonym (`ALIAS-001`, `ALIAS-002`, etc.) stored in the database.

---

## 2. AI Privacy Gateway & Egress Protection

All Generative AI interactions pass through a single module (`apps/web/src/server/modules/ai/privacy-gateway.ts`), enforced by ESLint import boundaries:

1. **Outgoing Scrubbing:** Full names, surnames, given names, honorific combinations (`Engr.`, `Dr.`, `Prof.`, `Sir`, `Ma'am`), diacritic/accent variations (`Ñ` -> `N`, `á` -> `a`), and fuzzy misspellings next to honorifics (`Prof. Sntos` -> `ALIAS-001`) are replaced with `Faculty.alias` before any request leaves the application.
2. **Allowlist Tool Serialization:** Tool results are filtered through an explicit key allowlist (`serializeToolResultForLlm`). Free-text notes, email addresses, and contact numbers are never sent to the LLM.
3. **Streaming De-Pseudonymization:** `DePseudonymizerStream` buffers trailing partial tokens across chunk boundaries and restores real faculty names only inside the Dean's authenticated browser response.
4. **Token-Only Usage Logging:** `LlmUsageRecord` logs only `provider`, `model`, `tokensIn`, `tokensOut`, and `estimatedCostPhp`—never prompt or reply content.
5. **Automated Egress Verification:** Verified by the 32-prompt golden evaluation suite (`phase4-and-phase5-exit-criteria.test.ts`), asserting **0 faculty names** in any captured LLM request payload.

---

## 3. Access Control & Audit Trail

- **Dean-Only Access (`D-20`):** Public signup is disabled. Every `/api/v1/*` data, generation, schedule, AI, ML, analytics, report, and evaluation endpoint requires an authenticated Dean session verified with **Argon2id + TOTP 2FA**.
- **Append-Only Audit Log:** Every state-changing action (`TERM_UPDATED`, `IMPORT_COMMITTED`, `GENERATION_RUN_COMPLETED`, `SCHEDULE_ENTRY_EDITED`, `SCHEDULE_EXCEPTION_ADDED`, `SCHEDULE_ACCEPTED`, `AI_PROPOSAL_APPLIED`, `ML_MODEL_TRAIN`, `REPORT_EXPORTED`) is recorded in the append-only `AuditLog`.

---

## 4. Developer Data Deletion Attestation (Phase 8 Handover)

In accordance with Quotation `Q-2026-002`:
- Development and automated testing were conducted using synthetic fixtures (`generateSmallFixture` and `generateMediumCollegeFixture` modeling 7 programs, 44 faculty, and 903 students across 24 sections).
- Upon final turnover and acceptance, all copies of MSEUF College of Engineering schedules or faculty data on developer machines are permanently deleted and confirmed in writing.

