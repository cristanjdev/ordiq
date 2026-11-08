/**
 * Plain-language labels for the codes stored in the database, so screens and
 * exports read "General Engineering" or "Laboratory" instead of
 * GENERAL_ENGINEERING or LAB. Unknown codes fall back to title case.
 */

export const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const lookup =
  (labels: Record<string, string>) =>
  (value: string | null | undefined, fallback = "—"): string =>
    value ? (labels[value] ?? titleCase(value)) : fallback;

export const SUBJECT_CATEGORY_LABELS: Record<string, string> = {
  MAJOR: "Major",
  GENERAL_ENGINEERING: "General Engineering",
  MATHEMATICS: "Mathematics",
  SCIENCE: "Science",
  GENERAL_EDUCATION: "General Education",
  PATHFIT: "PATHFit (P.E.)",
};

export const COMPONENT_LABELS: Record<string, string> = {
  LECTURE: "Lecture",
  LAB: "Laboratory",
};

export const ROOM_TYPE_LABELS: Record<string, string> = {
  LECTURE: "Lecture room",
  LAB: "Laboratory",
};

export const MEETING_PATTERN_LABELS: Record<string, string> = {
  ANY: "Any days",
  MWF: "Mon / Wed / Fri",
  TTH: "Tue / Thu",
  SINGLE: "Once a week",
};

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  CANDIDATE: "Draft candidate",
  ACCEPTED: "Accepted",
  ARCHIVED: "Archived",
};

export const SOLVER_STATUS_LABELS: Record<string, string> = {
  PROVEN_OPTIMAL: "Best possible",
  BEST_FOUND: "Best found in time limit",
  INFEASIBLE: "No valid schedule",
  CANCELLED: "Run cancelled",
  FAILED: "Run failed",
};

export const UNSCHEDULED_REASON_LABELS: Record<string, string> = {
  NO_QUALIFIED_FACULTY: "No qualified faculty member",
  NO_ROOM_CAPACITY: "No room large enough",
  FACULTY_LOAD_FULL: "Qualified faculty are at full load",
  NO_COMMON_SLOT: "No free time shared by faculty, room and section",
};

export const CHANGE_ACTION_LABELS: Record<string, string> = {
  ENTRY_EDITED: "Class moved or reassigned",
  UNDO_ENTRY_EDIT: "Edit undone",
  REVISION_CREATED: "Revision created",
};

export const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "Critical",
  WARNING: "Warning",
};

/** Short names for the hard rules, matching the Rules page. */
export const HARD_CONSTRAINT_NAMES: Record<string, string> = {
  "HC-01": "Faculty teaching two classes at once",
  "HC-02": "Room booked for two classes at once",
  "HC-03": "Section in two classes at once",
  "HC-04": "Room too small for the section",
  "HC-05": "Wrong room type",
  "HC-06": "Faculty not available",
  "HC-07": "Faculty over maximum load",
  "HC-08": "Class not scheduled",
  "HC-09": "Faculty not qualified for the subject",
  "HC-10": "Room not available",
  "HC-11": "Outside allowed hours or breaks",
  "HC-12": "Dean directive not followed",
  "HC-13": "Wrong class length or days",
  "HC-14": "Calendar or maintenance restriction",
  "HC-15": "Clashes with a fixed block",
};

/** Short names for the soft preferences, matching the Rules page. */
export const SOFT_CONSTRAINT_NAMES: Record<string, string> = {
  "SC-01": "Preferred days and times",
  "SC-02": "Balanced faculty loads",
  "SC-03": "Minimal gaps",
  "SC-04": "Preferred rooms",
  "SC-05": "Even spread across the week and day",
  "SC-06": "Stability on regeneration",
  "SC-07": "Faculty fit score",
  "SC-08": "Room efficiency",
  "SC-09": "No evening classes for lower years",
  "SC-10": "Lower-year priority",
  "SC-11": "Labs away from late hours",
  "SC-12": "Spread major and math subjects",
  "SC-13": "Breaks between long classes",
  "SC-14": "No late-then-early turnarounds",
  "SC-15": "PATHFIT late or before a vacant period",
  "SC-16": "Few very early starts",
};

/** "SC-04 · Preferred rooms" or "HC-06 · Faculty not available". */
export const ruleLabel = (code: string): string => {
  const name = HARD_CONSTRAINT_NAMES[code] ?? SOFT_CONSTRAINT_NAMES[code];
  return name ? `${code} · ${name}` : code;
};

/** "1st Semester, AY 2026 – 2027", matching the term picker. */
export const termDisplayLabel = (academicYear: string, semester: number): string =>
  `${semester === 1 ? "1st" : semester === 2 ? "2nd" : "Summer"} Semester, AY ${academicYear.replace("-", " – ")}`;

/** "HC-06 · Faculty not available"; unknown codes are shown as is. */
export const hardConstraintLabel = (code: string): string =>
  HARD_CONSTRAINT_NAMES[code] ? `${code} · ${HARD_CONSTRAINT_NAMES[code]}` : code;

export const subjectCategoryLabel = lookup(SUBJECT_CATEGORY_LABELS);
export const componentLabel = lookup(COMPONENT_LABELS);
export const roomTypeLabel = lookup(ROOM_TYPE_LABELS);
export const meetingPatternLabel = lookup(MEETING_PATTERN_LABELS);
export const scheduleStatusLabel = lookup(SCHEDULE_STATUS_LABELS);
export const unscheduledReasonLabel = lookup(UNSCHEDULED_REASON_LABELS);
export const changeActionLabel = lookup(CHANGE_ACTION_LABELS);
export const severityLabel = lookup(SEVERITY_LABELS);
export const weekdayLabel = lookup({});

export const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME_PERMANENT: "Full-Time Permanent",
  FULL_TIME_NON_PERMANENT: "Full-Time Contractual",
  PART_TIME: "Part-Time",
  VISITING: "Visiting Lecturer",
};

export const LOAD_STATUS_LABELS: Record<string, string> = {
  UNDERLOAD: "Underloaded",
  OPTIMAL: "Within load",
  OVERLOAD: "Overload",
  EXCEEDS_MAX: "Over maximum",
};

export const PROFILE_LABELS: Record<string, string> = {
  BALANCED: "Balanced",
  FACULTY_FIRST: "Faculty-first",
  STUDENT_FIRST: "Student-first",
  CUSTOM: "Custom / imported",
};

export const employmentLabel = lookup(EMPLOYMENT_LABELS);
export const loadStatusLabel = lookup(LOAD_STATUS_LABELS);
export const profileLabel = lookup(PROFILE_LABELS);

/** A schedule without a solver status was imported, not generated. */
export const solverStatusLabel = (value: string | null | undefined): string =>
  value ? (SOLVER_STATUS_LABELS[value] ?? titleCase(value)) : "Imported (no solver run)";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const formatUnits = (units: number) => plural(units, "unit", "units");

export const formatHours = (hours: number) => plural(hours, "hr", "hrs");

/** "3 hrs lecture", "3 hrs laboratory" or "2 hrs lecture + 3 hrs laboratory". */
export function formatHoursSplit(lectureHours: number, labHours: number): string {
  const parts = [
    lectureHours > 0 ? `${formatHours(lectureHours)} lecture` : null,
    labHours > 0 ? `${formatHours(labHours)} laboratory` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" + ") : "No class hours";
}

/** "Mon / Wed / Fri · 3 meetings × 1 hr" style summary of an offering. */
export function formatMeetingPlan(pattern: string, meetingsPerWeek: number, minutesPerMeeting: number): string {
  return `${meetingPatternLabel(pattern)} · ${plural(meetingsPerWeek, "meeting", "meetings")} × ${formatDuration(minutesPerMeeting)}`;
}

/** 90 → "1 hr 30 min", 120 → "2 hrs", 45 → "45 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? formatHours(h) : `${formatHours(h)} ${m} min`;
}

export const ordinalYear = (year: number) => {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
};
