# ORDIQ Frequently Asked Questions

Short answers to the questions the Dean asks most. Each entry lists other ways the question is asked, in English, Filipino and Taglish.

## How do I sign in to ORDIQ?

Also asked: paano mag-login, how to log in, sign in steps.

Enter the Dean username or email and the password on the sign-in page. If two-factor authentication is on, enter the 6-digit code from the authenticator app next. Only the Dean has an account; there is no sign-up page.

## What if I lose my phone with Google Authenticator?

Also asked: nawala ang phone, lost authenticator, cannot get the 6-digit code, recovery code.

On the code step of sign-in, choose "Use a recovery code" and enter one of the single-use recovery codes shown when two-factor was first set up. Each recovery code works once. If no recovery codes are left, the system administrator can reset the Dean account with the seed script described in the Operations manual.

## How do I turn two-factor authentication on or off?

Also asked: paano i-off ang 2FA, i-on ang Google Authenticator, disable TOTP, enable authenticator.

Open Settings, go to Sign-in security, and switch "Two-factor authentication (Google Authenticator)". Saving needs the current password. Turning it off keeps the authenticator setup, so turning it back on later needs no new QR scan. With it off, anyone who learns the password can sign in.

## Why is the account locked?

Also asked: na-lock ang account, locked out, too many attempts, maling password.

After a number of wrong sign-in attempts in a row the account locks for a set time. The defaults are 5 attempts and 15 minutes. Wait for the lock to end and try again. Both numbers are set in Settings › Sign-in security (3 to 10 attempts, 1 to 1,440 minutes).

## Why was I signed out automatically?

Also asked: bakit na-logout, auto logout, session expired, auto-expire, kusang nag-sign out.

ORDIQ signs the Dean out after a period of inactivity (default 30 minutes) and after the maximum session length (default 12 hours). Both are set in Settings › Session & automatic sign-out, where the inactivity sign-out can also be turned off.

## Why does saving settings ask for my password?

Also asked: bakit hinihingi ang password sa settings, current password required.

Changes to sign-in security and automatic sign-out protect the account, so ORDIQ asks for the current password before saving them. AI Assistant settings save without it. Every saved change is recorded in the audit log.

## How do I turn off the AI Assistant?

Also asked: i-disable ang AI, patayin ang chatbot, turn off chat.

Open Settings › AI Assistant and switch it off, then save. The chat button, the AI Assistant page and its sidebar item disappear and nothing is sent to the AI provider. The rest of ORDIQ keeps working.

## What is the monthly token budget?

Also asked: token limit, AI budget, gaano karami ang tokens.

It caps how much the AI Assistant can use each month. When it is used up, the assistant falls back to ORDIQ's built-in answers until the next month. The budget is set in Settings › AI Assistant and usage is shown on AI Assistant › Usage.

## How do I create a schedule for the term?

Also asked: paano gumawa ng schedule, generate schedule steps, saan magsisimula, where do I start for a new term, first steps.

1. Make sure the term's data is complete: faculty, subjects, sections, offerings and rooms. The Readiness Gate on Rules & Preferences shows what is missing.
2. Open Schedules and press Generate (CP-SAT). ORDIQ creates three candidates: Balanced, Faculty First and Student First.
3. Review and compare them, fix any conflicts or unscheduled meetings, then accept one.

## What is the difference between Balanced, Faculty First and Student First?

Also asked: candidate A B C, ano ang pinagkaiba ng candidates, weight profiles.

They are three candidate schedules built from the same data with different weights on the soft preferences. Candidate A (Balanced) keeps the weights moderate across faculty and student preferences. Candidate B (Faculty First) weighs faculty preferred days and times (SC-01), load balance (SC-02), preferred rooms (SC-04) and faculty fit (SC-07) more heavily. Candidate C (Student First) weighs fewer gaps (SC-03), an even spread across the week (SC-05), no evening classes for lower years (SC-09), lower-year priority (SC-10), no late laboratories (SC-11) and spreading major subjects (SC-12) more heavily. All three must meet the same hard rules.

## Why are some classes unscheduled?

Also asked: bakit may unscheduled, hindi nailagay na klase, unplaced meetings.

When a meeting cannot be placed without breaking a hard rule, ORDIQ leaves it unscheduled and states the reason instead of failing the whole schedule. Common reasons are no qualified faculty available, no free room of the right type or size, or the section's time already taken. The Schedules page and the assistant list each unscheduled meeting with its reason.

## How do I fix a conflict?

Also asked: paano ayusin ang conflict, resolve violation, may banggaan sa schedule.

Open the schedule on the Schedules page and move the meeting to another day, time, room or faculty member; each edit is checked right away. The assistant can also find conflict-free alternative slots or propose a change for the Dean to apply. If the rule is waivable (HC-04 to HC-15) and the situation is intended, record a waived exception with a written reason.

## How do I accept a schedule?

Also asked: paano i-accept ang schedule, approve the candidate, gawing official.

On the Schedules page, open the candidate and press Accept Candidate, then confirm. ORDIQ accepts it only when it has zero unwaived hard conflicts and zero unscheduled meetings. Accepting archives any previously accepted schedule for the term. "Accepted" means approved for portal encoding; university approval happens outside ORDIQ.

## Why can't I accept the schedule?

Also asked: ayaw ma-accept, hindi ma-accept ang candidate, accept failed.

ORDIQ blocks acceptance while the candidate still has unwaived hard conflicts or unscheduled meetings. Fix or waive the conflicts (only HC-04 to HC-15 can be waived) and place the remaining meetings, then accept again.

## Can the AI Assistant accept a schedule or apply a change?

Also asked: kaya ba ng chatbot mag-accept, can the AI apply proposals.

No. The assistant can check, explain, generate candidates, add directives and propose a change, but it has no way to apply a proposal, accept a schedule, delete records or edit master data. The Dean does those in the workspace, and proposals are applied or rejected on AI Assistant › Proposals.

## How do I change an accepted schedule?

Also asked: paano mag-revise, edit accepted schedule, may babaguhin sa accepted.

Open the accepted schedule and press Start Schedule Revision. ORDIQ creates a new draft version from it, so edits never change the accepted version. Accept the revision when it is ready.

## How do I undo an edit?

Also asked: i-undo, balik sa dati, revert change.

On the Schedules page, press Undo Edit to reverse the last change to the open schedule.

## What is a waived exception?

Also asked: waive, documented exception, override a rule.

A waived exception lets a waivable hard rule (HC-04 to HC-15) be broken on purpose, with a written reason that is kept in the record and shown in the Conflict and Exception Report. Double booking of a faculty member, room or section (HC-01, HC-02, HC-03) can never be waived.

## What is a Dean directive?

Also asked: ano ang directive, add a rule for the next run.

A directive is an extra rule the Dean adds for the next generation run. The types are: keep a faculty member off a day, a time window for a faculty member or a section, avoid a room, require a room, pin a meeting, assign a faculty member, and change a preference weight. Each is hard (must hold) or soft (preferred). Directives are on Rules & Preferences › Dean Directives, and the assistant can add one from a chat request. They do not change existing schedules until candidates are generated again.

## What are locked fixed blocks?

Also asked: fixed blocks, GenEd, PATHFIT, NSTP, klase ng ibang department.

Fixed blocks are time slots a section already uses for classes the college does not schedule, such as General Education, PATHFIT, NSTP or classes in other buildings. ORDIQ keeps those sections free at those times (HC-15). They are managed on Rules & Preferences › Locked Fixed Blocks.

## What does the Readiness Gate check?

Also asked: data readiness, kulang na data, ready na ba mag-generate, ISO 25012.

It checks the term's data for completeness, accuracy, consistency and currentness (ISO/IEC 25012) before generation. Critical gaps block generation until they are fixed, for example a term with no offerings, a subject with no qualified faculty, a section larger than every suitable room, or more required hours than the faculty or rooms can cover. Warnings, such as missing faculty availability or an outdated curriculum record, do not block.

## How do I import data from Excel?

Also asked: paano mag-import, upload workbook, Excel template.

Use the Import button on the data page and choose the completed ORDIQ data-gathering workbook (.xlsx). ORDIQ checks the file first and lists every problem by row and column in plain words; nothing is saved until the check passes.

## Where do I set when a faculty member is available?

Also asked: availability ng faculty, hindi pwede ang guro sa araw na ito.

Open Faculty, select the faculty member and use Availability to add available or unavailable days and time windows with a reason. HC-06 keeps classes inside them.

## Where do I set what subjects a faculty member can teach?

Also asked: qualifications, specialization, anong subject ang kaya ng guro.

Open Faculty, select the faculty member and use Qualifications to add subjects. HC-09 only assigns faculty to subjects they are qualified for. The faculty matching model also uses this to recommend faculty.

## Where do I change room capacity or type?

Also asked: kapasidad ng kwarto, room size, lecture or laboratory.

Open Rooms & Laboratories and edit the room. Capacity is checked by HC-04 and the room type (lecture or laboratory) by HC-05.

## Does ORDIQ keep student records?

Also asked: may student data ba, individual students, student ID.

No. ORDIQ stores only the number of students per section (decision D-21). There are no individual student names, IDs, grades or schedules anywhere in the system.

## Are faculty names sent to the AI provider?

Also asked: privacy ng faculty, pinapadala ba ang pangalan sa AI.

No. Before anything leaves ORDIQ, faculty names are replaced with codes such as ALIAS-001, and the real names are put back only in the reply shown to the Dean. Contact details, notes and raw imports are never sent.

## How do I export the schedule for the university portal?

Also asked: paano i-export, portal encoding, Excel para sa portal.

Open Reports and download the Portal Encoding Export (Excel). It is laid out for the scheduling officer to encode manually. ORDIQ never connects to the university portal directly.

## What reports are available?

Also asked: anong reports, download PDF, print schedule.

College Schedule Summary; Class Schedule per Section, per Faculty and per Room; Faculty Load Report; Room Utilization Report; Conflict and Exception Report; Validation & Unmet Preferences Report; Candidate Comparison; Revision History; and the Portal Encoding Export. Each downloads as PDF or Excel from the Reports page.

## How is Faculty Load Balance calculated?

Also asked: load balance score, paano kinukuha ang faculty load balance.

It is 100 minus the spread (standard deviation) of faculty load utilization, where each faculty member's utilization is assigned units divided by their regular maximum units. 100 means every faculty member carries the same share of their limit; lower means loads are uneven. It appears on the Dashboard; hovering the figure shows the formula.

## What does "optimized" mean in ORDIQ?

Also asked: best schedule ba ito, optimal, pinakamaganda ba.

The solver minimizes a weighted sum of soft-preference penalties, with a large penalty for every unscheduled meeting. "Proven optimal" means no better schedule exists for those weights; "best found" means the time limit ended the search. It does not mean a global best for every possible priority.

## How does the faculty recommendation work?

Also asked: ML, machine learning, faculty matching model, recommended faculty.

A logistic regression model scores how well each qualified faculty member fits a subject, using past assignments, qualifications and preferences. With little history it falls back to text similarity between subject and expertise. It only recommends; it never overrides a hard rule. The model can be retrained on AI Assistant › Usage.

## What do the notifications mean?

Also asked: bell, notification count, needs attention.

The bell counts urgent and warning items for the selected term: data problems that block generation, no schedule yet, conflicts, unscheduled classes, faculty overloads and proposals awaiting review. Each item links to where it is fixed. "Mark all as read" clears the count until an item changes.

## Who can use ORDIQ?

Also asked: sino ang pwedeng gumamit, coordinator account, multiple users.

Only the Dean signs in. Program coordinators and the scheduling officer work from the exported PDF and Excel reports. There is no sign-up page; the account is created by the administrator.

## What is ORDIQ?

Also asked: ano ang ORDIQ, what does the system do, purpose.

ORDIQ ("Order Meets Intelligence") is the class scheduling and resource allocation system of the MSEUF College of Engineering. It builds candidate schedules with a constraint solver, checks every schedule with an independent validator, recommends faculty with machine learning, and offers a chat assistant in English, Filipino and Taglish. The Dean makes every final decision.

## What are the hard constraints?

Also asked: list the hard rules, mandatory rules, HC list, ano ang mga hard constraints.

Every schedule must meet fifteen hard rules. HC-01 a faculty member teaches one class at a time. HC-02 a room hosts one class at a time. HC-03 a section attends one class at a time. HC-04 room capacity fits the section. HC-05 room type matches (lecture or laboratory). HC-06 faculty only when available. HC-07 faculty within maximum load. HC-08 all required meetings and hours scheduled. HC-09 faculty qualified for the subject. HC-10 rooms only when available. HC-11 inside allowed hours and outside official breaks. HC-12 required Dean directives respected. HC-13 required duration and meeting pattern. HC-14 calendar and maintenance restrictions. HC-15 sections clear of their fixed blocks. HC-01 to HC-03 can never be waived; the rest can be waived with a written reason. They are listed on Rules & Preferences › Hard Constraints.

## What languages does the assistant understand?

Also asked: Tagalog, Filipino, Taglish, English, pwede bang mag-Tagalog.

The AI Assistant understands and replies in English, Filipino and Taglish, and answers in the language of the question.

## HC-01: A faculty member teaches one class at a time

Also asked: faculty double booking, sabay na klase ng guro.

A faculty member cannot have two classes at the same time. Never waivable. Fix it on the Schedules page by moving one meeting or assigning another faculty member.

## HC-02: A room hosts one class at a time

Also asked: room double booking, dalawang klase sa isang kwarto.

A room cannot hold two classes at the same time. Never waivable. Fix it on the Schedules page by moving one meeting to another time or room.

## HC-03: A section attends one class at a time

Also asked: section double booking, sabay na klase ng section.

A section cannot have two classes at the same time. Never waivable. Fix it on the Schedules page.

## HC-04: Room capacity fits the section

Also asked: masyadong maliit ang kwarto, capacity.

The room must seat the section's student count. Waivable with a reason. Adjust room capacity on Rooms & Laboratories or section counts on Courses & Sections.

## HC-05: Room type matches the requirement

Also asked: laboratory sa lecture room, room type.

Laboratory meetings need a laboratory and lecture meetings a lecture room. Waivable with a reason. Room types are set on Rooms & Laboratories.

## HC-06: Faculty are scheduled only when available

Also asked: faculty availability conflict.

Classes must fall inside the faculty member's available time. Waivable with a reason. Availability is set on the Faculty page.

## HC-07: Faculty stay within maximum teaching load

Also asked: overload, sobra ang units.

A faculty member's units may not exceed the maximum for their employment type. Waivable with a reason. Load limits are on the Faculty page.

## HC-08: All required meetings and contact hours are scheduled

Also asked: kulang ang oras, missing meetings.

Every offering gets all its required meetings and contact hours. Waivable with a reason. Offerings are on Courses & Sections.

## HC-09: Faculty specialization matches the subject

Also asked: hindi qualified ang guro.

Faculty teach only subjects they are qualified for. Waivable with a reason. Qualifications are on the Faculty page.

## HC-10: Rooms are used only when available

Also asked: room not available.

Classes may use a room only during its available times. Waivable with a reason. Room availability is on Rooms & Laboratories.

## HC-11: Classes stay inside allowed periods and avoid official breaks

Also asked: lunch break, sobrang aga o gabi.

Classes must fall within the term's allowed hours and avoid official breaks. Waivable with a reason. Term hours are on Courses & Sections.

## HC-12: Required Dean directives are respected

Also asked: hard directive.

Directives marked hard must hold in every candidate. Waivable with a reason. Directives are on Rules & Preferences › Dean Directives.

## HC-13: Each class follows its required duration and meeting pattern

Also asked: meeting pattern, duration.

Each meeting keeps its required length and day pattern. Waivable with a reason. Patterns come from the offering on Courses & Sections.

## HC-14: Calendar and maintenance restrictions are respected

Also asked: maintenance, holiday.

Rooms under maintenance and restricted calendar periods are not used. Waivable with a reason. Maintenance periods are on Rooms & Laboratories.

## HC-15: Sections stay clear of their fixed blocks

Also asked: GenEd conflict, PATHFIT conflict.

A section's locked fixed blocks (classes run by other departments) stay free. Waivable with a reason. Fixed blocks are on Rules & Preferences › Locked Fixed Blocks.

## Soft preferences SC-01 to SC-08

Also asked: soft constraints, preferences, objective weights.

SC-01 honor faculty preferred days and times. SC-02 balance teaching loads. SC-03 minimize vacant gaps for faculty and sections. SC-04 use preferred rooms. SC-05 distribute classes evenly across the week. SC-06 minimize changes from the existing schedule when regenerating. SC-07 prefer faculty with a high ML fit score. SC-08 use rooms efficiently, such as not putting 15 students in a 40-seat room. Their weights are set on Rules & Preferences › Objective Weights; a preference counts only once it is approved.

## Soft preferences SC-09 to SC-16

Also asked: student preferences, survey preferences.

From the manuscript and student survey: SC-09 avoid evening classes for lower-year sections. SC-10 give lower-year sections priority. SC-11 keep laboratories away from late hours. SC-12 spread major and mathematics subjects across days. SC-13 keep a break between long back-to-back classes. SC-14 avoid a late class followed by an early class the next day. SC-15 place PATHFIT late in the day or before a vacant period. SC-16 limit very early starts. Each needs approval before it counts, and some pull against each other.
