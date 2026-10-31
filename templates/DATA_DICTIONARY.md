# ORDIQ Data Dictionary & Workbook Specification

**System:** ORDIQ ("Order Meets Intelligence") — MSEUF College of Engineering
**Template Workbook:** `templates/ordiq-data-gathering-workbook.xlsx`
**Data Minimization Policy (`D-21`):** Individual student records (names, student numbers, grades, or contact details) are **strictly prohibited** across all sheets and database tables. Only section-level student counts (`studentCount`) are accepted.

---

## 1. Sheet: `Programs`
Defines the 7 academic engineering programs of the College of Engineering.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Unique program code (`CE`, `CPE`, `EE`, `ECE`, `GE`, `IE`, `ME`). |
| `name` | `string` | Yes | | Official program title (e.g., `BS Industrial Engineering`). |
| `coordinator` | `string` | Yes | | Program coordinator display name (plain text). |

---

## 2. Sheet: `Faculty`
Defines the 44 engineering faculty members. ORDIQ automatically assigns a separate `Faculty.alias` (`ALIAS-001`, etc.) internally so real names never leave the system when communicating with an AI provider.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Department human code (e.g., `FAC-001`). |
| `name` | `string` | Yes | | Full name of faculty member (protected; never sent to LLM). |
| `programCode` | `string` | No | FK → `Programs.code` | Home engineering program code. |
| `employmentType` | `enum` | Yes | | `FULL_TIME_PERMANENT` \| `FULL_TIME_NON_PERMANENT` \| `PART_TIME` \| `VISITING`. |
| `specialization` | `string` | Yes | | Declared area of specialization (used for `HC-09` and ML matching). |
| `education` | `string` | Yes | | Highest degree / educational background. |
| `maxLoadUnits` | `integer` | Yes | | Maximum allowed teaching units for the semester (`HC-07`). |
| `maxLoadHours` | `integer` | Yes | | Maximum allowed weekly contact hours (`HC-07`). |
| `status` | `enum` | Yes | | `ACTIVE` \| `ON_LEAVE` \| `INACTIVE`. |

---

## 3. Sheet: `Subjects`
Defines curriculum subjects offered by or taken within the College of Engineering.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Subject code (e.g., `IE101`, `CE201L`). |
| `name` | `string` | Yes | | Descriptive course title. |
| `description` | `string` | No | | Topic summary used by local NLP embeddings for faculty-fit ranking. |
| `programCode` | `string` | No | FK → `Programs.code` | Owning program code (`null` for general engineering courses). |
| `yearLevel` | `integer` | Yes | | Curriculum year level (`1` to `5`). |
| `category` | `enum` | Yes | | `MAJOR` \| `GENERAL_ENGINEERING` \| `MATHEMATICS` \| `SCIENCE` \| `GENERAL_EDUCATION` \| `PATHFIT`. |
| `units` | `integer` | Yes | | Academic credit units. |
| `contactHours` | `integer` | Yes | | Total required weekly contact hours (`HC-08`). |
| `lectureHours` | `integer` | Yes | | Weekly lecture contact hours. |
| `labHours` | `integer` | Yes | | Weekly laboratory contact hours. |
| `curriculumVersion` | `string` | Yes | | Curriculum revision year/code (e.g., `2024`). |
| `isCurrentCurriculum` | `boolean` | Yes | | `true` if active in current curriculum; `false` triggers a currentness readiness warning. |

---

## 4. Sheet: `Sections`
Defines student class sections. **No individual student columns (`studentId`, `studentName`) are allowed.**

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Unique section code (e.g., `IE-1A`, `CE-2B`). |
| `programCode` | `string` | Yes | FK → `Programs.code` | Program code to which the section belongs. |
| `yearLevel` | `integer` | Yes | | Year level (`1` to `5`). |
| `studentCount` | `integer` | Yes | | Headcount enrolled in the section (checked against `Room.capacity` in `HC-04`). |

---

## 5. Sheet: `Rooms`
Defines lecture rooms and laboratories inside the College of Engineering building.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Room code (e.g., `EN-LEC-01`, `EN-LAB-01`). |
| `name` | `string` | Yes | | Descriptive room name. |
| `type` | `enum` | Yes | | `LECTURE` (typically ≥ 40 capacity) \| `LAB` (typically ≥ 30 capacity). |
| `capacity` | `integer` | Yes | | Maximum student seating capacity (`HC-04`). |
| `equipment` | `string` | No | | Comma-separated equipment tags. |
| `restrictions` | `string` | No | | Notes on specialized laboratory restrictions. |
| `status` | `enum` | Yes | | `ACTIVE` \| `MAINTENANCE` \| `INACTIVE`. |

---

## 6. Sheet: `Offerings`
Defines the specific section-subject components (`LECTURE` or `LAB`) to be scheduled in a term.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `code` | `string` | Yes | **PK** | Unique offering code (e.g., `OFF-AY2026-2027-S1-IE-1A-IE101`). |
| `termCode` | `string` | Yes | FK → `Terms.code` | Target term code (e.g., `AY2026-2027-S1`). |
| `sectionCode` | `string` | Yes | FK → `Sections.code` | Section taking this offering. |
| `subjectCode` | `string` | Yes | FK → `Subjects.code` | Subject offered. |
| `component` | `enum` | Yes | | `LECTURE` \| `LAB`. |
| `meetingsPerWeek` | `integer` | Yes | | Number of weekly class meetings (`1` to `6`). |
| `minutesPerMeeting` | `integer` | Yes | | Duration of each meeting in minutes (`30` to `360`, multiple of slot size). |
| `meetingPattern` | `enum` | Yes | | `MWF` \| `TTH` \| `SINGLE` \| `ANY` (`HC-13`). |
| `requiredRoomType` | `enum` | Yes | | `LECTURE` \| `LAB` (`HC-05`). |
| `preassignedFacultyCode` | `string` | No | FK → `Faculty.code` | Optional pre-assigned instructor. |
| `combinedClassGroup` | `string` | No | | Optional group identifier when two sections share a combined lecture. |

---

## 7. Sheet: `FixedBlocks`
Defines locked time blocks for classes outside the College of Engineering's control (e.g., General Education, PATHFIT, NSTP in other buildings, Decision `D-23` & `HC-15`).

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `termCode` | `string` | Yes | **Composite PK** | Target term code. |
| `sectionCode` | `string` | Yes | **Composite PK** | Section locked during this window. |
| `weekday` | `enum` | Yes | **Composite PK** | `MONDAY` \| `TUESDAY` \| `WEDNESDAY` \| `THURSDAY` \| `FRIDAY` \| `SATURDAY`. |
| `startMin` | `integer` | Yes | **Composite PK** | Start time in minutes from midnight (`450` = 7:30 AM). |
| `endMin` | `integer` | Yes | | End time in minutes from midnight (`1230` = 8:30 PM). |
| `label` | `string` | Yes | | Reason/subject label (e.g., `PATHFIT 1`). |
| `location` | `string` | Yes | | External building/venue. |

---

## 8. Sheet: `FacultyAvailability`
Defines declared faculty availability windows (`HC-06`).

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `facultyCode` | `string` | Yes | **Composite PK** | Faculty code (`FAC-001`). |
| `termCode` | `string` | Yes | **Composite PK** | Term code. |
| `weekday` | `enum` | Yes | **Composite PK** | `MONDAY`..`SATURDAY`. |
| `startMin` | `integer` | Yes | **Composite PK** | Window start in minutes from midnight. |
| `endMin` | `integer` | Yes | | Window end in minutes from midnight. |
| `status` | `enum` | Yes | | `AVAILABLE` \| `UNAVAILABLE`. |
| `reason` | `string` | No | | Optional note. |

---

## 9. Sheet: `FacultyQualifications`
Maps which faculty members are qualified to teach each subject (`HC-09`).

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `facultyCode` | `string` | Yes | **Composite PK** | Faculty code (`FAC-001`). |
| `subjectCode` | `string` | Yes | **Composite PK** | Subject code (`IE101`). |
| `source` | `enum` | Yes | | `DECLARED` \| `HISTORY` \| `DEAN`. |

---

## 10. Sheet: `FacultyPreferences`
Stores faculty preference survey results (`SC-01`, Decision `D-17`).

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `facultyCode` | `string` | Yes | **Composite PK** | Faculty code. |
| `termCode` | `string` | Yes | **Composite PK** | Term code. |
| `type` | `enum` | Yes | **Composite PK** | `PREFERRED_DAY` \| `AVOID_DAY` \| `PREFERRED_TIME_WINDOW` \| `PREFERRED_ROOM`. |
| `value` | `string` | Yes | **Composite PK** | Day name (`FRIDAY`), time window (`07:30-12:00`), or room code. |
| `weight` | `number` | Yes | | Relative preference weight (`0.0` to `10.0`). |
| `source` | `enum` | Yes | | `SURVEY` \| `LEARNED` \| `DEAN`. |

---

## 11. Sheet: `PastSchedule`
Imports the 1st Semester A.Y. 2026–2027 manual schedule as a read-only `Schedule` (`source: "IMPORTED"`) for baseline comparison, conflict checking, and ML training.

| Column | Type | Required | Natural Key | Description & Allowed Values |
|---|---|---|---|---|
| `offeringCode` | `string` | Yes | FK → `Offerings.code` | Offering placed by this schedule entry. |
| `facultyCode` | `string` | Yes | FK → `Faculty.code` | Assigned faculty member. |
| `roomCode` | `string` | Yes | FK → `Rooms.code` | Assigned classroom or laboratory. |
| `weekday` | `enum` | Yes | | `MONDAY`..`SATURDAY`. |
| `startMin` | `integer` | Yes | | Start time in minutes from midnight. |
| `endMin` | `integer` | Yes | | End time in minutes from midnight. |

