# ORDIQ Architecture, Constraint Catalogue & Known Limitations

**System:** ORDIQ ("Order Meets Intelligence")  
**Quotation Reference:** `Q-2026-002`

---

## 1. System Architecture Diagram

```mermaid
flowchart LR
    Dean["Dean Browser (Next.js 15 UI)"] -->|HTTPS + Argon2id/TOTP Cookie| Web["apps/web (Next.js 15 Modular Monolith)"]
    Web -->|Prisma ORM| DB[("PostgreSQL 16 (Encrypted at Rest)")]
    Web -->|X-Engine-Token (Private Network)| Engine["services/engine (FastAPI + Python 3.12)"]
    Engine --> Validator["Independent Validator (HC-01..HC-15, SC-01..SC-16)"]
    Engine --> Solver["OR-Tools CP-SAT Solver"]
    Engine --> ML["scikit-learn Fit & Preference Learner"]
    Web --> Gateway["Privacy Gateway (Faculty.alias Scrubbing)"]
    Gateway -->|Pseudonymized ALIAS-XXX Only| LLM["LLM Provider (OpenAI / Anthropic / Ollama)"]
```

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Web Frontend & API | Next.js 15 (App Router), React 19, TypeScript 5.8 (strict), Tailwind CSS v4, shadcn/ui, TanStack Query | Workspace grids, timetable calendar, dashboard, reports, auth & API routes |
| Database & ORM | PostgreSQL 16 + Prisma ORM | Relational persistence, optimistic locking (`Schedule.version`), append-only `AuditLog` |
| Optimization & Validation Engine | Python 3.12, FastAPI, Pydantic v2, Google OR-Tools CP-SAT (`>=9.11`) | Stateless constraint validation (`POST /v1/validate`), multi-profile solving (`POST /v1/solve`), alternative slot search (`POST /v1/alternatives`) |
| Machine Learning | Python `scikit-learn` (`LogisticRegression`) + local token/character 3-gram embeddings (`D-11`, `D-12`) | Faculty–subject fit ranking (`POST /v1/ml/recommend`) and Laplace-smoothed preference learning |
| Security & Exports | Argon2id, `otpauth` (TOTP 2FA), AES-256-GCM, ExcelJS, PDF 1.4 generator | Dean-only security, `.xlsx` import/export pipeline, printable PDF reports |

---

## 3. Implemented Constraint Catalogue

### Hard Constraints (`HC-01` to `HC-15`)
- **Never Waivable (`D-18`):**
  - `HC-01`: No faculty double-booking
  - `HC-02`: No room double-booking
  - `HC-03`: No student section double-booking
- **Waivable Only With Documented Reason (`D-18`):**
  - `HC-04`: Room capacity >= section student count
  - `HC-05`: Room type matches lecture/lab requirement
  - `HC-06`: Faculty is qualified for the assigned subject
  - `HC-07`: Faculty and room are available during the scheduled slot
  - `HC-08`: Offering weekly meeting count and duration match subject contact hours
  - `HC-09`: Faculty total teaching load within regular/overload limit
  - `HC-10`: Meeting falls within official daily teaching window and respects lunch/break rules
  - `HC-11`: Section respects external `FixedBlock` commitments (PATHFIT, GenEd, `D-23`)
  - `HC-12`: Hard Dean directives (`Directive.hardness == HARD`) are satisfied
  - `HC-13`: Paired lecture/lab or MWF/TTh pattern consistency
  - `HC-14`: Room maintenance/calendar restrictions respected
  - `HC-15`: Combined-class sections synchronized to identical faculty, room, day, and time

### Soft Objectives (`SC-01` to `SC-16`)
- `SC-01` Approved faculty day/time/room preferences, `SC-02` Compact section schedules, `SC-03` Faculty teaching load balance, `SC-04` Preferred room assignment, `SC-05` Balanced daily distribution, `SC-06` Regeneration stability (minimal perturbation from prior schedule), `SC-07` ML faculty–subject fit score, `SC-08` Avoid late evening classes, `SC-09` Soft Dean directives, `SC-10` Lab immediately following lecture, `SC-11` Distinct preparations cap, `SC-12` Part-time faculty day consolidation, `SC-13` Room Utilization balance, `SC-14` Avoid 3+ consecutive lecture hours without break, `SC-15` Year-level cohort alignment, `SC-16` Minimize section room-switching.

---

## 4. Known Limitations & Future Enhancements (For Thesis Manuscript)

1. **Section-Level Representation (`D-21`):** ORDIQ models student cohorts at the block/section level (`Section.studentCount`). Individual irregular students taking cross-year subjects are outside scope and are recommended under *Future Enhancements*.
2. **Single-Semester Historical Baseline:** With one semester of historical data (`1st Sem A.Y. 2026–2027`), the ML module uses cold-start local text similarity combined with regularized logistic regression and improves incrementally as future semesters are accepted.
3. **Standalone Decision-Support Boundary:** ORDIQ produces non-official candidate schedules and portal-ready Excel exports; official registration and student release remain in the MSEUF portal after Registrar, Audit, and OVPAR approval.

