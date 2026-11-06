/**
 * Dashboard data shapes (as returned by `/api/v1/*`) and pure helpers.
 * Everything shown on the dashboard comes from the API; there is no sample
 * data here (CLAUDE.md: never show the Figure 4 mockup numbers as metrics).
 */

export type WeekdayCode =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY";

export const WEEKDAY_ORDER: readonly WeekdayCode[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

export const WEEKDAY_SHORT: Record<WeekdayCode, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
};

export interface AnalyticsDto {
  termCode: string;
  scheduleId: string | null;
  candidateLabel: string;
  status: string;
  metrics: {
    classesScheduled: number;
    totalMeetings: number;
    scheduledPct: number;
    conflictsDetected: number;
    waivedExceptionsCount: number;
    facultyLoadBalanceScore: number;
    averageFacultyUtilizationPct: number;
    roomUtilizationPct: number;
    qualityScore: number;
    unmetPreferencesCount: number;
  };
  metricFormulas: Record<string, string>;
  facultyLoads: Array<{
    facultyCode: string;
    assignedUnits: number;
    regularMaxUnits: number;
    utilizationPct: number;
    statusLabel: "UNDERLOAD" | "OPTIMAL" | "OVERLOAD" | "EXCEEDS_MAX";
  }>;
  roomUtilizations: Array<{
    roomCode: string;
    utilizationPct: number;
    meetingCount: number;
  }>;
  topConflicts: Array<{
    constraintId: string;
    severity: "HARD" | "SOFT";
    message: string;
    /** Plain-language sentence; older responses may not have it. */
    description?: string;
    waived: boolean;
  }>;
  dataReadiness: {
    canGenerate: boolean;
    criticalCount: number;
    warningCount: number;
    overallScore: number;
  };
}

export interface FacultyDto {
  code: string;
  name: string;
  employmentType: string;
  specialization: string;
  maxLoadUnits: number;
  status: string;
}

export interface SubjectDto {
  code: string;
  name: string;
  units: number;
}

export interface SectionDto {
  code: string;
  programCode: string;
  yearLevel: number;
  studentCount: number;
}

export interface RoomDto {
  code: string;
  name: string;
  type: string;
  capacity: number;
  status: string;
}

export interface OfferingDto {
  code: string;
  sectionCode: string;
  subjectCode: string;
  component: "LECTURE" | "LAB";
  meetingsPerWeek: number;
  minutesPerMeeting: number;
  requiredRoomType: string;
}

export interface ScheduleEntryDto {
  id: string;
  offeringCode: string;
  facultyCode: string;
  roomCode: string;
  weekday: WeekdayCode;
  startMin: number;
  endMin: number;
}

export interface ScheduleDto {
  id: string;
  candidateLabel: string;
  status: string;
  entries: ScheduleEntryDto[];
  unscheduled?: Array<{ offeringCode: string; reasonCode: string }>;
  validationReport?: {
    violations: Array<{ offering_codes?: string[]; waived?: boolean }>;
  } | null;
}

/** 480 -> "8:00 AM" */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function formatTimeRange(startMin: number, endMin: number): string {
  return `${formatClock(startMin)} – ${formatClock(endMin)}`;
}

export const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME_PERMANENT: "Full-time (permanent)",
  FULL_TIME_NON_PERMANENT: "Full-time",
  PART_TIME: "Part-time",
  VISITING: "Visiting",
};

const CHIP_THEMES = [
  "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-950 dark:text-cyan-200",
  "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200",
  "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200",
  "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200",
  "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200",
  "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200",
  "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950 dark:text-purple-200",
  "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-200",
];

/** Stable colour per subject so the same subject looks the same everywhere. */
export function chipThemeFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CHIP_THEMES[hash % CHIP_THEMES.length] ?? CHIP_THEMES[0] ?? "";
}

/** A schedule entry joined with the master data it refers to. */
export interface DashboardMeeting {
  id: string;
  offeringCode: string;
  subjectCode: string;
  subjectName: string;
  sectionCode: string;
  component: "LECTURE" | "LAB" | null;
  facultyCode: string;
  facultyName: string;
  roomCode: string;
  weekday: WeekdayCode;
  startMin: number;
  endMin: number;
  hasConflict: boolean;
}

export function joinMeetings(
  schedule: ScheduleDto | null | undefined,
  lookups: {
    offerings: Map<string, OfferingDto>;
    subjects: Map<string, SubjectDto>;
    faculty: Map<string, FacultyDto>;
  },
): DashboardMeeting[] {
  if (!schedule) return [];
  const conflicted = new Set<string>();
  for (const v of schedule.validationReport?.violations ?? []) {
    if (v.waived) continue;
    for (const code of v.offering_codes ?? []) conflicted.add(code);
  }
  return schedule.entries
    .map((entry) => {
      const offering = lookups.offerings.get(entry.offeringCode);
      const subject = offering ? lookups.subjects.get(offering.subjectCode) : undefined;
      return {
        id: entry.id,
        offeringCode: entry.offeringCode,
        subjectCode: offering?.subjectCode ?? entry.offeringCode,
        subjectName: subject?.name ?? "",
        sectionCode: offering?.sectionCode ?? "",
        component: offering?.component ?? null,
        facultyCode: entry.facultyCode,
        facultyName: lookups.faculty.get(entry.facultyCode)?.name ?? entry.facultyCode,
        roomCode: entry.roomCode,
        weekday: entry.weekday,
        startMin: entry.startMin,
        endMin: entry.endMin,
        hasConflict: conflicted.has(entry.offeringCode),
      };
    })
    .sort(
      (a, b) =>
        WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) ||
        a.startMin - b.startMin ||
        a.sectionCode.localeCompare(b.sectionCode),
    );
}

/**
 * Fixed hour rows for the term's teaching day (7:30 AM - 8:30 PM gives the
 * 7 AM to 8 PM rows). Empty hours stay visible; the range only grows when a
 * class falls outside the teaching day. 7 AM to 6 PM when the term hours are
 * unknown.
 */
export function hourRows(
  meetings: DashboardMeeting[],
  dayStartMin = 7 * 60,
  dayEndMin = 18 * 60,
): number[] {
  let first = Math.floor(dayStartMin / 60);
  let last = Math.ceil(dayEndMin / 60);
  for (const m of meetings) {
    first = Math.min(first, Math.floor(m.startMin / 60));
    last = Math.max(last, Math.ceil(m.endMin / 60));
  }
  return Array.from({ length: Math.max(1, last - first) }, (_, i) => first + i);
}

/** Teaching days to show: Monday to Friday, plus Saturday when used. */
export function visibleWeekdays(meetings: DashboardMeeting[]): WeekdayCode[] {
  const usesSaturday = meetings.some((m) => m.weekday === "SATURDAY");
  return WEEKDAY_ORDER.filter((d) => d !== "SATURDAY" || usesSaturday);
}

export function toCsv(rows: Array<Record<string, string | number>>): string {
  const first = rows[0];
  if (!first) return "";
  const headers = Object.keys(first);
  const escape = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(","))].join(
    "\n",
  );
}
