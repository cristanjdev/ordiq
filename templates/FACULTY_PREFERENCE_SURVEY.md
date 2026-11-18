# Faculty Preference Survey Template

The department secretary can use this template to collect faculty scheduling preferences through an online form (for example Google Forms or Microsoft Forms). The answers are then copied into the `FacultyPreferences` sheet of the ORDIQ import workbook (see `DATA_DICTIONARY.md`, section 10), and ORDIQ evaluates whether each preference can be met.

## How ORDIQ uses the answers

- Preferences never override the college's rules: faculty specialization, room and laboratory capacity, no conflicts, no evening classes for lower years, and complete subject hours always come first.
- Following the college's strict order of priority, the department's own preferences are met before any faculty preference. Faculty preferences are then met as far as possible without making the department's result worse.
- Each schedule lists the preferences it could not meet, so the Dean can see which ones were not possible and why.

## Privacy

- The form collects only scheduling preferences. It does not ask for personal details beyond identifying the faculty member.
- Before the answers go into ORDIQ, the secretary replaces each name with the faculty member's ORDIQ faculty code (for example `CENG-F001`). Names are not entered into the import workbook.
- The response spreadsheet stays in the Dean's office and is not shared outside it.

## Form questions

Use these questions in this order. Questions 2 to 5 are optional, so a faculty member with no preference can leave them blank.

| # | Question | Answer type | Choices |
|---|---|---|---|
| 1 | Name of faculty member | Short answer | Replaced by the faculty code before import |
| 2 | On which days do you prefer to teach? | Checkboxes | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday |
| 3 | Is there a day you would rather not teach? | Checkboxes | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday |
| 4 | What time of day do you prefer to teach? | Multiple choice | Morning (classes starting before 12:00 NN); Afternoon (classes starting at 12:00 NN or later); A specific time range (answer question 4a); No preference |
| 4a | If a specific time range, from what time to what time? | Short answer | Format `07:30-12:00`, using 24-hour time |
| 5 | Is there a classroom or laboratory you prefer? | Dropdown | The room codes in the Rooms sheet, plus "No preference" |
| 6 | How important are these preferences to you? | Linear scale 1 to 10 | 1 = slight preference, 10 = very important |

## Copying the answers into the `FacultyPreferences` sheet

Each answer becomes one row. A faculty member who picks two preferred days gets two `PREFERRED_DAY` rows.

| Form answer | `type` | `value` | `weight` |
|---|---|---|---|
| Question 2, each day checked | `PREFERRED_DAY` | Day in capitals, for example `TUESDAY` | Question 6 |
| Question 3, each day checked | `AVOID_DAY` | Day in capitals, for example `SATURDAY` | Question 6 |
| Question 4, Morning | `PREFERRED_TIME_WINDOW` | `MORNING` | Question 6 |
| Question 4, Afternoon | `PREFERRED_TIME_WINDOW` | `AFTERNOON` | Question 6 |
| Question 4a, a time range | `PREFERRED_TIME_WINDOW` | The range, for example `13:00-17:00` | Question 6 |
| Question 5, a room | `PREFERRED_ROOM` | The room code | Question 6 |

For every row, set `facultyCode` to the faculty member's code, `termCode` to the term being scheduled (for example `AY2026-2027-S1`), and `source` to `SURVEY`. "No preference" answers produce no row.

### Example

A faculty member coded `CENG-F014` prefers Tuesday and Thursday afternoons and rates the preference 6.

| facultyCode | termCode | type | value | weight | source |
|---|---|---|---|---|---|
| CENG-F014 | AY2026-2027-S1 | PREFERRED_DAY | TUESDAY | 6 | SURVEY |
| CENG-F014 | AY2026-2027-S1 | PREFERRED_DAY | THURSDAY | 6 | SURVEY |
| CENG-F014 | AY2026-2027-S1 | PREFERRED_TIME_WINDOW | AFTERNOON | 6 | SURVEY |
