# ORDIQ In-App Guide

This guide describes the ORDIQ screens as they are in the current release. When an older document describes a screen differently, this guide is the current one.

## Layout of the app

The top bar shows the MSEUF logo, the term selector, the light/dark theme switch, the notifications bell, the Dean's name and the sign-out button. Every page shows data for the term chosen in the term selector.

The left sidebar has: Dashboard, Faculty, Courses & Sections, Rooms & Laboratories, Schedules, Rules & Preferences, Reports, AI Assistant and Settings. On phones the sidebar opens from the menu button at the top left.

The AI chat panel opens from the round ORDIQ button at the bottom right of the screen. On very wide screens it docks beside the page; on smaller screens it slides in as a drawer.

## Signing in and signing out

1. Open the sign-in page and enter the Dean username or email and the password.
2. If two-factor authentication is on, enter the 6-digit code from Google Authenticator (or another authenticator app). The first sign-in shows a QR code to scan and a set of single-use recovery codes to keep offline.
3. If two-factor authentication is turned off in Settings, the password alone signs in.

After too many wrong attempts the account locks for a while (by default 5 attempts and 15 minutes; both are set in Settings). Only one Dean account exists; there is no sign-up page.

To sign out, press the sign-out icon at the top right and confirm. ORDIQ also signs the Dean out automatically after a period of inactivity and after the maximum session length (see Settings).

## Settings page

Settings holds the system-wide switches. Every saved change is recorded in the audit log.

- **Sign-in security:** two-factor authentication (Google Authenticator) on or off; failed attempts before the account locks (3 to 10); lock duration (1 to 1,440 minutes). Turning two-factor off keeps the authenticator setup, so turning it back on needs no new QR scan.
- **Session & automatic sign-out:** sign out after inactivity (auto-expire) on or off; inactivity limit (5 to 480 minutes, default 30); maximum session length (1 to 72 hours, default 12).
- **AI Assistant:** turn the assistant on or off, and set the monthly token budget. When it is off, the chat button, the AI Assistant page and the AI menu item are hidden and nothing is sent to the AI provider.
- **Server configuration:** read-only status of the web app, the scheduling engine and the AI provider.

Changes appear in a save bar at the bottom of the page. Sign-in and session changes need the current password before they can be saved; the password box turns red if Save is pressed without it. "Discard" undoes unsaved edits and "Restore recommended values" resets the switches to the defaults.

## Dashboard

The Dashboard shows four figures for the selected term: Classes Scheduled (out of the total meetings), Conflicts Detected, Faculty Load Balance (out of 100) and Room Utilization (percent). Hovering a figure shows how it is calculated. Below them are tabs for the schedule, faculty data, courses and sections, and rooms and labs.

## Faculty page

The Faculty page lists the engineering faculty with their employment type (Full-Time Permanent, Full-Time Contract, Part-Time or Visiting) and load limits. Opening a faculty member shows three areas:

- **Availability:** days and time windows when the faculty member is available or unavailable, with a reason.
- **Qualifications:** the subjects the faculty member can teach and whether they have taught them before.
- **Preferences:** preferred days, times or rooms, with a weight and a source (faculty survey, set by the Dean, or learned from history).

## Courses & Sections page

This page has three tabs: Subjects Catalog (subject codes, units, lecture and laboratory hours), Student Sections (section codes and their student counts only; ORDIQ keeps no individual student records) and Course Offerings (which subject is offered to which section this term). Programs and terms are managed here too.

## Rooms & Laboratories page

This page lists lecture rooms and laboratories with their type, capacity and availability, including maintenance periods when a room cannot be used.

## Importing data

Master data can be typed in on each page or imported from the official Excel workbook. An import is checked first (a dry run) and every row or column problem is reported in plain words before anything is saved.

## Schedules page

The Schedules page is the schedule workspace.

- **Generate (CP-SAT):** creates three candidate schedules for the term: Candidate A (Balanced), Candidate B (Faculty First) and Candidate C (Student First). Every candidate is checked again by the independent validator against hard rules HC-01 to HC-15.
- **Views:** an hourly schedule grid and day column cards, filterable by section, faculty, room and weekday.
- **Editing:** a meeting can be moved to another day, time, room or faculty member. Each edit is validated right away and conflicts are shown with the rule explained in plain words. "Undo Edit" reverses the last change.
- **Check Schedule:** runs the validator again on the open schedule.
- **Compare:** shows the candidates side by side (quality score, conflicts, unscheduled meetings).
- **Waived exceptions:** a waivable rule (HC-04 to HC-15) can be overridden with a written reason. Double booking of a faculty member, room or section (HC-01, HC-02, HC-03) can never be waived.
- **Accept Candidate:** makes a candidate the official schedule. ORDIQ only accepts a candidate with zero unwaived hard conflicts and zero unscheduled meetings. Accepting archives the previously accepted schedule for the term.
- **Start Schedule Revision:** creates a new draft from the accepted schedule so it can be edited without touching the accepted version.
- **Import / Export:** bring in an existing schedule or export the open one.

## Rules & Preferences page

This page has five tabs:

- **Hard Constraints:** the fixed rules HC-01 to HC-15 that every schedule must meet. The rules themselves cannot be edited; the "Adjust In" column links to the page where each rule's inputs are changed (for example room capacity on Rooms & Laboratories, or faculty availability on Faculty).
- **Objective Weights:** how much each soft preference (SC-01 to SC-16) counts when the solver builds candidates.
- **Dean Directives:** extra rules for the next generation run, such as keeping a faculty member off a day, a time window for a section, avoiding or requiring a room, pinning a meeting, assigning a faculty member, or changing a weight. Each directive is hard or soft.
- **Locked Fixed Blocks:** time blocks that are already taken, such as classes run by other departments (General Education, PATHFIT, NSTP) or college events.
- **Readiness Gate:** the data readiness check (ISO/IEC 25012: completeness, accuracy, consistency, currentness). Critical gaps block schedule generation until they are fixed.

## Reports page

Reports can be downloaded as PDF or Excel (.xlsx): College Schedule Summary, Class Schedule per Section, per Faculty and per Room, Faculty Load Report, Room Utilization Report, Conflict and Exception Report, Validation & Unmet Preferences Report, Candidate Comparison, Revision History, and the Portal Encoding Export. The Portal Encoding Export is an Excel sheet laid out for the scheduling officer to encode manually; ORDIQ never connects to the university portal itself.

## AI Assistant page

The AI Assistant page has four tabs:

- **Briefing:** the term's figures (Scheduled, Conflicts, Unscheduled, Pending proposals), an optional AI summary, and a "Needs attention" list with links to where each issue is fixed.
- **Proposals:** changes the assistant proposed. Each shows the meeting now and the proposed slot, the quality change and whether it creates a conflict. Only the Dean can Apply or Reject a proposal.
- **History:** past conversations for the term, with search; a conversation can be continued in the chat panel or deleted.
- **Usage:** the AI provider and model in use, the tokens used against the monthly budget, the estimated cost, and the faculty matching model with its accuracy and a Retrain button.

## Chat panel

The chat panel answers questions about the selected term in English, Filipino or Taglish, using the live schedule data. The menu (three dots) starts a new conversation or opens a recent one. The assistant can check conflicts, summarize loads and room use, explain unscheduled classes, find alternative slots, recommend faculty, add directives, generate new candidates and propose a change. It cannot apply a proposal, accept a schedule, delete records, edit master data or create accounts; those stay with the Dean in the workspace. Faculty names are replaced with codes before anything is sent to the AI provider and restored in the reply.

## Notifications

The bell at the top shows how many urgent or warning items need attention for the selected term: data problems that block generation, no schedule yet, conflicts, unscheduled classes, faculty overloads and proposals waiting for review. Opening the bell lists each item with a link to fix it. "Mark all as read" clears the count; an item comes back as unread if it changes, and disappears once the problem is resolved. Read status is kept per browser.
