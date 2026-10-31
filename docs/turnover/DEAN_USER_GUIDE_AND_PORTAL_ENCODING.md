# ORDIQ Dean User Guide & Portal Encoding Workflow

**System:** ORDIQ ("Order Meets Intelligence")  
**Target Users:** Dean of the College of Engineering (System Operator) & Scheduling Officer (Portal Encoder)

---

## 1. Logging In (Dean-Only Access)

1. Navigate to `/login`.
2. Enter your Dean email (`dean@mseuf.edu.ph`), password, and the 6-digit **TOTP Authenticator code** from your mobile authenticator app.
3. Keep your single-use recovery codes in a secure offline location.

---

## 2. Step-by-Step Scheduling Workflow

### Step 1: Import or Update Term Master Data
1. Open **Faculty**, **Courses & Sections**, **Rooms & Laboratories**, or **Rules & Preferences** from the left sidebar.
2. Download the official template (`templates/ordiq-data-gathering-workbook.xlsx`) or upload your completed `.xlsx` workbook.
3. ORDIQ runs a **dry-run validation** first, reporting any row/column errors in plain language before committing atomically.
4. Review the **ISO/IEC 25012 Data Readiness Card** (Completeness, Accuracy, Consistency, Currentness). Critical gaps block schedule generation until resolved.

### Step 2: Check Existing Schedule or Generate Candidates
1. Open **Schedules** (`/schedules`).
2. Click **Generate 3 Candidates (CP-SAT)** to produce three optimized candidate schedules:
   - **Candidate A — Balanced (`BALANCED`)**
   - **Candidate B — Faculty First (`FACULTY_FIRST`)**
   - **Candidate C — Student First (`STUDENT_FIRST`)**
3. Every candidate is independently re-validated by the Python validator against `HC-01` through `HC-15`.

### Step 3: Review, Edit, Waive, or Compare
1. Switch between the **Spreadsheet Grid**, **Weekly Timetable Calendar** (filtered by Section, Faculty, or Room), and **Side-by-Side Candidate Comparison**.
2. Click **Pin/Unpin** on any entry you want to lock in place before regenerating.
3. If a waivable rule (`HC-04` to `HC-15`) requires an administrative override, record a **Documented Exception (`D-18`)** with a written justification. Core double-booking rules (`HC-01` Faculty, `HC-02` Room, `HC-03` Section) can never be waived.
4. Click **Accept Candidate for Portal Encoding** once `0` unwaived hard conflicts and `0` unscheduled meetings remain.

---

## 3. Using the Conversational AI Assistant (English, Filipino & Taglish)

Open the persistent right panel or `/assistant` to give instructions in English, Filipino, or Taglish:
- *"Check schedule conflicts for Engr. Maria Clara Santos"*
- *"Kumusta ang room utilization at lab usage natin?"*
- *"Sino ang bagay magturo ng CPE-101 ayon sa specialization?"*
- *"Huwag bigyan ng early class si Engr. Maria Clara Santos tuwing Lunes"*
- *"Propose a change to move offering OFF-CPE-1A-CPE101 to Wednesday"*

> **Important Boundary:** The AI Assistant can never apply a proposal, accept a schedule, or delete data on its own. When it creates a **Change Proposal Card**, click **Apply** or **Reject** to confirm.

---

## 4. Exporting Reports & Manual Portal Encoding (`Q-14`)

1. Open **Reports** (`/reports`).
2. Export printable **PDF** or **Excel (`.xlsx`)** reports per Section, Faculty, Room, Load Summary, Conflicts & Exceptions, or Candidate Comparison.
3. For the Scheduling Officer: export **Portal Encoding Export (`.xlsx`)**, which formats `TermCode`, `SectionCode`, `SubjectCode`, `Component`, `DayCode`, `StartTime`, `EndTime`, `RoomCode`, and `FacultyName` for manual encoding into the MSEUF portal.

