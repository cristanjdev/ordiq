import {
  componentLabel,
  employmentLabel,
  loadStatusLabel,
  profileLabel,
  roomTypeLabel,
  ruleLabel,
  scheduleStatusLabel,
  severityLabel,
  solverStatusLabel,
  titleCase,
  unscheduledReasonLabel,
} from "@/lib/display-labels";
import {
  computeFacultyLoads,
  computeRoomUtilizations,
  computeScheduleAnalytics,
  type ScheduleAnalyticsReportDto,
} from "../analytics/analytics.service";
import type {
  MasterDataState,
  ScheduleEntryRecord,
  ScheduleRecord,
} from "../master-data/master-data.store";
import { getTermReadinessReport } from "../readiness/readiness.service";
import { describeViolation } from "../schedules/violation-text";
import type { ColumnAlign, PdfSection } from "./printable-pdf";

/** What one report shows, before it is rendered as PDF or Excel. */
export interface ReportContent {
  title: string;
  intro: string;
  summary: Array<{ label: string; value: string }>;
  /** Grouped tables for the printable PDF. */
  sections: PdfSection[];
  /** One flat, filterable table for Excel. */
  sheet: { headers: string[]; rows: string[][]; align?: ColumnAlign[] };
}

export interface ReportContext {
  state: MasterDataState;
  termCode: string;
  sched: ScheduleRecord | null;
  analytics: ScheduleAnalyticsReportDto;
  entityFilter?: string;
  watermark: string;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export function clock(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 >= 12 ? "PM" : "AM"}`;
}

const timeRange = (start: number, end: number) => `${clock(start)} – ${clock(end)}`;
const day = (weekday: string) => titleCase(weekday);
const pct = (value: number) => `${Number(value.toFixed(1))}%`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hours = (minutes: number) => {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hrs`;
};

export function manilaDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return String(iso);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${dateLabel} at ${timeLabel} (Philippine Time)`;
}

export function reportAcademicPeriod(academicYear: string, semester: number): string {
  const semesterLabel = semester === 1 ? "First Semester" : semester === 2 ? "Second Semester" : "Summer Term";
  return `Academic Year ${academicYear.replace(/\s*[-–]\s*/g, "–")} · ${semesterLabel}`;
}

const byDayAndTime = (a: ScheduleEntryRecord, b: ScheduleEntryRecord) =>
  DAY_ORDER.indexOf(a.weekday) - DAY_ORDER.indexOf(b.weekday) || a.startMin - b.startMin;

/** "Monday at 9:00" or "TUESDAY at 09:00" in engine text becomes "Tuesday at 9:00 AM". */
function humanizeEngineText(text: string, state: MasterDataState): string {
  return text
    .replace(/\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b/g, (d) => titleCase(d))
    .replace(/\bat (\d{1,2}):(\d{2})\b(?!\s?[AP]M)/g, (_, h: string, m: string) => `at ${clock(Number(h) * 60 + Number(m))}`)
    .replace(/\bFaculty (FAC-[\w-]+)/g, (_, code: string) => state.faculty.get(code)?.name ?? code)
    .replace(/\b(FAC-\d+)\b/g, (code) => state.faculty.get(code)?.name ?? code);
}

interface EntryView {
  entry: ScheduleEntryRecord;
  sectionCode: string;
  subjectCode: string;
  subjectTitle: string;
  units: number;
  type: string;
  facultyName: string;
  room: string;
}

function entryViews(ctx: ReportContext): EntryView[] {
  const { state } = ctx;
  return (ctx.sched?.entries ?? []).map((entry) => {
    const off = state.offerings.get(entry.offeringCode);
    const subj = off ? state.subjects.get(off.subjectCode) : undefined;
    return {
      entry,
      sectionCode: off?.sectionCode ?? "—",
      subjectCode: off?.subjectCode ?? entry.offeringCode,
      subjectTitle: subj?.name ?? "—",
      units: subj?.units ?? 0,
      type: componentLabel(off?.component ?? "LECTURE"),
      facultyName: state.faculty.get(entry.facultyCode)?.name ?? entry.facultyCode,
      room: entry.roomCode,
    };
  });
}

/** "Engr. Maria Clara Santos" sorts under M, not E. */
const sortableName = (name: string) => name.replace(/^(Dr|Engr|Prof|Mr|Ms|Mrs|Atty|Arch)\.?\s+/i, "");

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

const NO_SCHEDULE = "No schedule has been generated for this term yet.";

// ---------------------------------------------------------------------------
// Timetables
// ---------------------------------------------------------------------------

function sectionSchedule(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const views = entryViews(ctx).filter((v) => !ctx.entityFilter || v.sectionCode === ctx.entityFilter);
  const groups = [...groupBy(views, (v) => v.sectionCode)].sort(([a], [b]) => a.localeCompare(b));
  const headers = ["Day", "Time", "Subject", "Description", "Type", "Room", "Faculty"];
  const sections: PdfSection[] = groups.map(([code, items]) => {
    const sec = state.sections.get(code);
    const program = sec ? (state.programs.get(sec.programCode)?.name ?? sec.programCode) : "";
    return {
      heading: `Section ${code}`,
      note: [program, sec ? `Year ${sec.yearLevel}` : "", sec ? `${sec.studentCount} students` : "", count(items.length, "class meeting")]
        .filter(Boolean)
        .join(" · "),
      headers,
      rows: items
        .sort((a, b) => byDayAndTime(a.entry, b.entry))
        .map((v) => [day(v.entry.weekday), timeRange(v.entry.startMin, v.entry.endMin), v.subjectCode, v.subjectTitle, v.type, v.room, v.facultyName]),
    };
  });
  const flat = groups.flatMap(([, items]) => items);
  return {
    title: "Class Schedule per Section",
    intro: "Each section's weekly classes, in day and time order, with the room and faculty member assigned.",
    summary: [
      { label: "Sections", value: String(groups.length) },
      { label: "Class meetings", value: String(flat.length) },
      { label: "Classes not scheduled", value: String(ctx.sched?.unscheduled?.length ?? 0) },
    ],
    sections: sections.length ? sections : [{ headers, rows: [], emptyText: ctx.sched ? "No classes match this filter." : NO_SCHEDULE }],
    sheet: {
      headers: ["Section", "Day", "Start", "End", "Subject", "Description", "Type", "Room", "Faculty"],
      rows: flat.map((v) => [v.sectionCode, day(v.entry.weekday), clock(v.entry.startMin), clock(v.entry.endMin), v.subjectCode, v.subjectTitle, v.type, v.room, v.facultyName]),
    },
  };
}

function facultySchedule(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const views = entryViews(ctx).filter((v) => !ctx.entityFilter || v.entry.facultyCode === ctx.entityFilter);
  const loads = new Map(computeFacultyLoads(ctx.termCode, ctx.sched?.id).map((l) => [l.facultyCode, l]));
  const groups = [...groupBy(views, (v) => v.entry.facultyCode)].sort(([, a], [, b]) =>
    sortableName(a[0]?.facultyName ?? "").localeCompare(sortableName(b[0]?.facultyName ?? "")),
  );
  const headers = ["Day", "Time", "Subject", "Description", "Section", "Type", "Room"];
  const sections: PdfSection[] = groups.map(([code, items]) => {
    const fac = state.faculty.get(code);
    const load = loads.get(code);
    return {
      heading: items[0]?.facultyName ?? code,
      note: [
        code,
        fac?.programCode ? `${fac.programCode} program` : "",
        fac ? employmentLabel(fac.employmentType) : "",
        load ? `${load.assignedUnits} of ${load.regularMaxUnits} units` : "",
        count(items.length, "class meeting"),
      ]
        .filter(Boolean)
        .join(" · "),
      headers,
      rows: items
        .sort((a, b) => byDayAndTime(a.entry, b.entry))
        .map((v) => [day(v.entry.weekday), timeRange(v.entry.startMin, v.entry.endMin), v.subjectCode, v.subjectTitle, v.sectionCode, v.type, v.room]),
    };
  });
  const flat = groups.flatMap(([, items]) => items);
  return {
    title: "Class Schedule per Faculty",
    intro: "Each faculty member's weekly teaching schedule, in day and time order, with sections and rooms.",
    summary: [
      { label: "Faculty with classes", value: String(groups.length) },
      { label: "Class meetings", value: String(flat.length) },
    ],
    sections: sections.length ? sections : [{ headers, rows: [], emptyText: ctx.sched ? "No classes match this filter." : NO_SCHEDULE }],
    sheet: {
      headers: ["Faculty Code", "Faculty", "Day", "Start", "End", "Subject", "Description", "Section", "Type", "Room"],
      rows: flat.map((v) => [v.entry.facultyCode, v.facultyName, day(v.entry.weekday), clock(v.entry.startMin), clock(v.entry.endMin), v.subjectCode, v.subjectTitle, v.sectionCode, v.type, v.room]),
    },
  };
}

function roomSchedule(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const views = entryViews(ctx).filter((v) => !ctx.entityFilter || v.room === ctx.entityFilter);
  const util = new Map(computeRoomUtilizations(ctx.termCode, ctx.sched?.id).map((r) => [r.roomCode, r]));
  const groups = [...groupBy(views, (v) => v.room)].sort(([a], [b]) => a.localeCompare(b));
  const headers = ["Day", "Time", "Subject", "Description", "Section", "Type", "Faculty"];
  const sections: PdfSection[] = groups.map(([code, items]) => {
    const room = state.rooms.get(code);
    const u = util.get(code);
    return {
      heading: room?.name && room.name !== code ? `${code} · ${room.name}` : code,
      note: [
        room ? roomTypeLabel(room.type) : "",
        room ? `${room.capacity} seats` : "",
        count(items.length, "class meeting"),
        u ? `${pct(u.utilizationPct)} of teaching hours used` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      headers,
      rows: items
        .sort((a, b) => byDayAndTime(a.entry, b.entry))
        .map((v) => [day(v.entry.weekday), timeRange(v.entry.startMin, v.entry.endMin), v.subjectCode, v.subjectTitle, v.sectionCode, v.type, v.facultyName]),
    };
  });
  const flat = groups.flatMap(([, items]) => items);
  return {
    title: "Class Schedule per Room",
    intro: "Each room and laboratory's weekly bookings, in day and time order.",
    summary: [
      { label: "Rooms in use", value: `${groups.length} of ${state.rooms.size}` },
      { label: "Class meetings", value: String(flat.length) },
    ],
    sections: sections.length ? sections : [{ headers, rows: [], emptyText: ctx.sched ? "No classes match this filter." : NO_SCHEDULE }],
    sheet: {
      headers: ["Room", "Room Name", "Day", "Start", "End", "Subject", "Description", "Section", "Type", "Faculty"],
      rows: flat.map((v) => [v.room, state.rooms.get(v.room)?.name ?? v.room, day(v.entry.weekday), clock(v.entry.startMin), clock(v.entry.endMin), v.subjectCode, v.subjectTitle, v.sectionCode, v.type, v.facultyName]),
    },
  };
}

// ---------------------------------------------------------------------------
// Load and utilization
// ---------------------------------------------------------------------------

function facultyLoad(ctx: ReportContext): ReportContent {
  const loads = computeFacultyLoads(ctx.termCode, ctx.sched?.id, ctx.entityFilter).sort((a, b) =>
    sortableName(a.facultyName).localeCompare(sortableName(b.facultyName)),
  );
  const teaching = loads.filter((l) => l.assignedUnits > 0);
  const idle = loads.filter((l) => l.assignedUnits === 0);
  const headers = ["Faculty", "Program", "Employment", "Units", "Regular max", "Overload", "Preparations", "Load", "Status"];
  const align: ColumnAlign[] = ["left", "left", "left", "right", "right", "right", "right", "right", "left"];
  const row = (l: (typeof loads)[number]) => [
    l.facultyName,
    l.programCode || "—",
    employmentLabel(l.employmentType),
    String(l.assignedUnits),
    String(l.regularMaxUnits),
    String(l.overloadUnits),
    String(l.preparationsCount),
    pct(l.utilizationPct),
    l.assignedUnits === 0 ? "No classes" : loadStatusLabel(l.statusLabel),
  ];
  const avg = teaching.length ? teaching.reduce((s, l) => s + l.utilizationPct, 0) / teaching.length : 0;
  return {
    title: "Faculty Load Report",
    intro:
      "Units assigned to each faculty member against their regular maximum. Load is assigned units ÷ regular maximum units; preparations count the different subjects a faculty member teaches.",
    summary: [
      { label: "Faculty with classes", value: `${teaching.length} of ${loads.length}` },
      { label: "Average load", value: pct(avg) },
      { label: "Over maximum", value: String(loads.filter((l) => l.statusLabel === "EXCEEDS_MAX").length) },
      { label: "With overload", value: String(loads.filter((l) => l.overloadUnits > 0).length) },
      { label: "Load balance score", value: pct(ctx.analytics.metrics.facultyLoadBalanceScore) },
    ],
    sections: [
      { heading: `Faculty with classes (${teaching.length})`, headers, align, rows: teaching.map(row), emptyText: ctx.sched ? "No faculty member has classes in this schedule." : NO_SCHEDULE },
      ...(idle.length
        ? [{ heading: `No classes this term (${idle.length})`, headers: ["Faculty", "Program", "Employment", "Regular max"], align: ["left", "left", "left", "right"] as ColumnAlign[], rows: idle.map((l) => [l.facultyName, l.programCode || "—", employmentLabel(l.employmentType), String(l.regularMaxUnits)]) }]
        : []),
    ],
    sheet: { headers: ["Faculty Code", ...headers], align: ["left", ...align], rows: loads.map((l) => [l.facultyCode, ...row(l)]) },
  };
}

function roomUtilization(ctx: ReportContext): ReportContent {
  const rooms = computeRoomUtilizations(ctx.termCode, ctx.sched?.id, ctx.entityFilter).sort(
    (a, b) => b.utilizationPct - a.utilizationPct || a.roomCode.localeCompare(b.roomCode),
  );
  const headers = ["Room", "Name", "Type", "Seats", "Classes / week", "Hours used", "Hours available", "Utilization"];
  const align: ColumnAlign[] = ["left", "left", "left", "right", "right", "right", "right", "right"];
  const rows = rooms.map((r) => [
    r.roomCode,
    r.roomName,
    roomTypeLabel(r.roomType),
    String(r.capacity),
    String(r.meetingCount),
    hours(r.usedMinutes),
    hours(r.availableMinutes),
    pct(r.utilizationPct),
  ]);
  const busiest = rooms[0];
  return {
    title: "Room Utilization Report",
    intro:
      "How much of each room's weekly teaching time is booked. Utilization is scheduled minutes ÷ available teaching minutes in the week.",
    summary: [
      { label: "Average utilization", value: pct(ctx.analytics.metrics.roomUtilizationPct) },
      { label: "Rooms in use", value: `${rooms.filter((r) => r.meetingCount > 0).length} of ${rooms.length}` },
      { label: "Busiest room", value: busiest && busiest.meetingCount > 0 ? `${busiest.roomCode} (${pct(busiest.utilizationPct)})` : "—" },
    ],
    sections: [{ headers, align, rows, emptyText: NO_SCHEDULE }],
    sheet: { headers, align, rows },
  };
}

// ---------------------------------------------------------------------------
// Summary and compliance
// ---------------------------------------------------------------------------

function collegeSummary(ctx: ReportContext): ReportContent {
  const { metrics, studentChangeRequestRisk: risk } = ctx.analytics;
  const readiness = getTermReadinessReport(ctx.termCode);
  const headers = ["Measure", "Value", "How it is calculated"];
  const rows = [
    ["Classes scheduled", `${metrics.classesScheduled} of ${metrics.totalMeetings} (${pct(metrics.scheduledPct)})`, "Class meetings placed ÷ class meetings required by this term's offerings."],
    ["Unresolved conflicts", String(metrics.conflictsDetected), "Hard-rule violations (HC-01 to HC-15) found by the independent validator and not waived."],
    ["Waived exceptions", String(metrics.waivedExceptionsCount), "Rule exceptions the Dean approved with a written reason. One approval can cover several class meetings."],
    ["Faculty load balance", pct(metrics.facultyLoadBalanceScore), "100 minus the standard deviation of faculty load percentages. Higher means loads are more even."],
    ["Average faculty load", pct(metrics.averageFacultyUtilizationPct), "Average of assigned units ÷ regular maximum units."],
    ["Room utilization", pct(metrics.roomUtilizationPct), "Average over all rooms of scheduled minutes ÷ available teaching minutes per week."],
    ["Unmet preferences", String(metrics.unmetPreferencesCount), "Soft preferences (SC-01 to SC-16) the schedule could not satisfy."],
    ["Quality score", ctx.sched?.qualityScore == null ? "—" : String(metrics.qualityScore), "Solver score from 0 to 100 that weighs the soft preferences."],
    [
      "Student change-request risk",
      `${titleCase(risk.riskLevel)} (${risk.totalRiskIndicators})`,
      `Section double-bookings (${risk.sectionConflictCount}) + classes not scheduled (${risk.unscheduledMeetingCount}) + unmet preferences (${risk.unmetApprovedPreferenceCount}). Reported as counts only.`,
    ],
  ];
  const c = readiness.counts;
  const dataRows = [
    ["Programs", String(c.programs)],
    ["Active faculty", String(c.faculty)],
    ["Subjects", String(c.subjects)],
    ["Sections", String(c.sections)],
    ["Active rooms and laboratories", String(c.rooms)],
    ["Class offerings this term", String(c.offerings)],
    ["Data readiness score", pct(readiness.iso25012Scores.overall)],
  ];
  return {
    title: "College Schedule Summary",
    intro: "Key figures for the selected schedule, with how each one is calculated. The same figures appear on the Dashboard.",
    summary: [
      { label: "Classes scheduled", value: pct(metrics.scheduledPct) },
      { label: "Unresolved conflicts", value: String(metrics.conflictsDetected) },
      { label: "Load balance", value: pct(metrics.facultyLoadBalanceScore) },
      { label: "Room utilization", value: pct(metrics.roomUtilizationPct) },
      { label: "Unmet preferences", value: String(metrics.unmetPreferencesCount) },
    ],
    sections: [
      { heading: "Schedule measures", headers, rows },
      { heading: "Term data", headers: ["Item", "Count"], align: ["left", "right"], rows: dataRows },
    ],
    sheet: { headers, rows: [...rows, ...dataRows.map(([a, b]) => [a ?? "", b ?? "", "Term data"])] },
  };
}

function conflictsAndExceptions(ctx: ReportContext): ReportContent {
  const { state, sched } = ctx;
  const violations = sched?.validationReport?.violations ?? [];
  const entries = sched?.entries ?? [];
  const exceptions = sched?.exceptions ?? [];
  const approval = (code: string, reason?: string | null) => {
    const ex = exceptions.find((e) => e.code === code && (!reason || e.reason === reason));
    return ex ? `${ex.approvedBy} · ${manilaDateTime(ex.createdAt)}` : "—";
  };
  const open = violations.filter((v) => !v.waived);
  const waived = violations.filter((v) => v.waived);
  const unscheduled = sched?.unscheduled ?? [];

  const openRows = open.map((v) => [ruleLabel(v.code), describeViolation(v, state, entries)]);
  const waivedRows = waived.map((v) => [ruleLabel(v.code), describeViolation(v, state, entries), v.waiver_reason ?? "—", approval(v.code, v.waiver_reason)]);
  // Approvals recorded without a matching finding still belong on record.
  for (const ex of exceptions) {
    if (!waived.some((v) => v.code === ex.code && v.waiver_reason === ex.reason)) {
      waivedRows.push([ruleLabel(ex.code), [ex.offeringCode, ex.sectionCode, ex.facultyCode, ex.roomCode].filter(Boolean).join(", ") || "—", ex.reason, `${ex.approvedBy} · ${manilaDateTime(ex.createdAt)}`]);
    }
  }
  const unscheduledRows = unscheduled.map((u) => {
    const off = state.offerings.get(u.offeringCode);
    const cls = off ? `${off.subjectCode} ${componentLabel(off.component).toLowerCase()}, section ${off.sectionCode}` : u.offeringCode;
    return [cls, `Meeting ${u.meetingIndex + 1}`, unscheduledReasonLabel(u.reasonCode), u.reasonDetail];
  });

  return {
    title: "Conflicts and Exceptions Report",
    intro:
      "Hard-rule problems the Dean still needs to fix, rule exceptions approved with a written reason, and classes the solver could not place.",
    summary: [
      { label: "Needs fixing", value: String(open.length) },
      { label: "Waived with approval", value: String(waivedRows.length) },
      { label: "Classes not scheduled", value: String(unscheduled.length) },
    ],
    sections: [
      { heading: `Needs fixing (${open.length})`, headers: ["Rule", "What is wrong"], rows: openRows, emptyText: sched ? "No unresolved conflicts." : NO_SCHEDULE },
      { heading: `Waived with approval (${waivedRows.length})`, headers: ["Rule", "What is waived", "Reason", "Approved by"], rows: waivedRows, emptyText: "No waived exceptions." },
      { heading: `Classes not scheduled (${unscheduled.length})`, headers: ["Class", "Meeting", "Reason", "Details"], rows: unscheduledRows, emptyText: "Every class meeting is scheduled." },
    ],
    sheet: {
      headers: ["Status", "Rule", "Details", "Reason", "Approved by"],
      rows: [
        ...openRows.map(([rule, what]) => ["Needs fixing", rule ?? "", what ?? "", "—", "—"]),
        ...waivedRows.map(([rule, what, reason, by]) => ["Waived", rule ?? "", what ?? "", reason ?? "", by ?? ""]),
        ...unscheduledRows.map(([cls, meeting, reason, detail]) => ["Not scheduled", reason ?? "", `${cls} (${meeting}): ${detail}`, "—", "—"]),
      ],
    },
  };
}

const DIMENSIONS: Array<[key: "completeness" | "accuracy" | "consistency" | "currentness", label: string, meaning: string]> = [
  ["completeness", "Completeness", "Required records and fields are filled in."],
  ["accuracy", "Accuracy", "Values are valid and within the allowed ranges."],
  ["consistency", "Consistency", "Records agree with each other, such as hours, capacities and qualifications."],
  ["currentness", "Currentness", "Curriculum and records are up to date for this term."],
];

function validationAndPreferences(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const readiness = getTermReadinessReport(ctx.termCode);
  const scores = readiness.iso25012Scores;
  const issueRows = [...readiness.issues]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "CRITICAL" ? -1 : 1))
    .map((i) => [severityLabel(i.severity), i.entityCode, i.message]);

  // The validator reports a preference once per affected meeting; show each once.
  const unmet = new Map<string, { rule: string; faculty: string; text: string; times: number }>();
  for (const u of ctx.sched?.validationReport?.quality.unmet_preferences ?? []) {
    const text = humanizeEngineText(u.description, state);
    const key = `${u.code}|${text}`;
    const existing = unmet.get(key);
    if (existing) existing.times += 1;
    else
      unmet.set(key, {
        rule: ruleLabel(u.code),
        faculty: u.faculty_code ? (state.faculty.get(u.faculty_code)?.name ?? u.faculty_code) : "—",
        text,
        times: 1,
      });
  }
  const unmetRows = [...unmet.values()].map((u) => [u.rule, u.faculty, u.text, String(u.times)]);
  const unmetTotal = [...unmet.values()].reduce((sum, u) => sum + u.times, 0);

  return {
    title: "Data Quality and Unmet Preferences Report",
    intro:
      "How ready the term's data is for scheduling (ISO/IEC 25012 data-quality dimensions), any readiness issues, and the faculty preferences the selected schedule could not meet.",
    summary: [
      ...DIMENSIONS.map(([key, label]) => ({ label, value: pct(scores[key]) })),
      { label: "Readiness issues", value: String(readiness.issues.length) },
      { label: "Unmet preferences", value: String(unmetTotal) },
    ],
    sections: [
      { heading: "Data quality", headers: ["Dimension", "Score", "What it checks"], align: ["left", "right", "left"], rows: DIMENSIONS.map(([key, label, meaning]) => [label, pct(scores[key]), meaning]) },
      { heading: `Readiness issues (${issueRows.length})`, headers: ["Severity", "Record", "Problem"], rows: issueRows, emptyText: "No readiness issues. The term's data is ready for scheduling." },
      { heading: `Unmet preferences (${unmetTotal})`, headers: ["Preference", "Faculty", "What happened", "Times"], align: ["left", "left", "left", "right"], rows: unmetRows, emptyText: ctx.sched ? "Every preference was met." : NO_SCHEDULE },
    ],
    sheet: {
      headers: ["Category", "Item", "Faculty / Record", "Details", "Times"],
      rows: [
        ...DIMENSIONS.map(([key, label, meaning]) => ["Data quality", label, "—", `${pct(scores[key])}. ${meaning}`, "—"]),
        ...issueRows.map(([sev, rec, problem]) => [`Readiness issue (${sev})`, "—", rec ?? "", problem ?? "", "—"]),
        ...unmetRows.map(([rule, fac, text, times]) => ["Unmet preference", rule ?? "", fac ?? "", text ?? "", times ?? ""]),
      ],
    },
  };
}

function candidateComparison(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const runCreated = (s: ScheduleRecord) => (s.runId ? state.generationRuns.get(s.runId)?.createdAt : undefined);
  const rank = (s: ScheduleRecord) => (s.status === "ACCEPTED" ? 0 : 1);
  const schedules = [...state.schedules.values()]
    .filter((s) => s.termCode === ctx.termCode && s.status !== "ARCHIVED")
    .sort((a, b) => rank(a) - rank(b) || (runCreated(b) ?? "").localeCompare(runCreated(a) ?? ""));
  const headers = ["Schedule", "Strategy", "Status", "Solver result", "Classes scheduled", "Conflicts", "Unmet preferences", "Load balance", "Room use", "Quality"];
  const align: ColumnAlign[] = ["left", "left", "left", "left", "right", "right", "right", "right", "right", "right"];
  const scored = schedules.map((s) => {
    const m = computeScheduleAnalytics(ctx.termCode, s.id).metrics;
    const failed = s.solverStatus === "INFEASIBLE" || s.entries.length === 0;
    const created = runCreated(s);
    return {
      s,
      failed,
      conflicts: m.conflictsDetected,
      issues: m.conflictsDetected + (m.totalMeetings - m.classesScheduled),
      row: [
        `${s.candidateLabel}\n${created ? `Created ${manilaDateTime(created)}` : s.source === "IMPORTED" ? "Imported" : ""}`.trim(),
        profileLabel(s.profileName ?? "CUSTOM"),
        scheduleStatusLabel(s.status),
        solverStatusLabel(s.solverStatus),
        `${m.classesScheduled} of ${m.totalMeetings}`,
        String(m.conflictsDetected),
        String(m.unmetPreferencesCount),
        failed ? "—" : pct(m.facultyLoadBalanceScore),
        failed ? "—" : pct(m.roomUtilizationPct),
        failed || s.qualityScore == null ? "—" : String(s.qualityScore),
      ],
    };
  });
  // Accepting needs zero conflicts and zero unscheduled classes, so rank by both.
  const best = scored
    .filter((x) => !x.failed)
    .sort((a, b) => a.issues - b.issues || (b.s.qualityScore ?? 0) - (a.s.qualityScore ?? 0))[0];
  const rows = scored.map((x) => x.row);
  return {
    title: "Candidate Comparison",
    intro:
      "The accepted schedule and every draft candidate for this term, side by side. A schedule can be accepted only with no unresolved conflicts and every class scheduled; among the rest, a higher quality score means more preferences are met. Archived schedules (earlier accepted versions) are left out.",
    summary: [
      { label: "Schedules compared", value: String(scored.length) },
      {
        label: best
          ? `Fewest open issues: ${count(best.conflicts, "conflict")}, ${count(best.issues - best.conflicts, "class", "classes")} not scheduled`
          : "Fewest open issues",
        value: best ? best.s.candidateLabel : "—",
      },
    ],
    sections: [{ headers, align, rows, emptyText: NO_SCHEDULE }],
    sheet: { headers, align, rows: rows.map((r) => r.map((c) => c.replace("\n", " — "))) },
  };
}

// ---------------------------------------------------------------------------
// Excel-only exports
// ---------------------------------------------------------------------------

function portalEncoding(ctx: ReportContext): ReportContent {
  const status = ctx.watermark ? "Draft — not official" : "Official (accepted)";
  const views = entryViews(ctx).sort(
    (a, b) => a.sectionCode.localeCompare(b.sectionCode) || a.subjectCode.localeCompare(b.subjectCode) || byDayAndTime(a.entry, b.entry),
  );
  const headers = ["Term", "Section", "Subject Code", "Subject Title", "Type", "Units", "Day", "Start", "End", "Room", "Faculty Code", "Faculty Name", "Status"];
  const rows = views.map((v) => [
    ctx.termCode,
    v.sectionCode,
    v.subjectCode,
    v.subjectTitle,
    v.type,
    String(v.units),
    day(v.entry.weekday),
    clock(v.entry.startMin),
    clock(v.entry.endMin),
    v.room,
    v.entry.facultyCode,
    v.facultyName,
    status,
  ]);
  return {
    title: "Portal Encoding Export",
    intro: "One row per class meeting, sorted by section, for the scheduling officer to encode in the university portal by hand. ORDIQ never connects to the portal.",
    summary: [{ label: "Rows to encode", value: String(rows.length) }],
    sections: [{ headers, rows, emptyText: NO_SCHEDULE }],
    sheet: { headers, rows },
  };
}

function describeEntry(e: unknown, state: MasterDataState): string {
  if (!e || typeof e !== "object") return "—";
  const entry = e as Partial<ScheduleEntryRecord>;
  if (!entry.weekday || entry.startMin == null || entry.endMin == null) return "—";
  const fac = entry.facultyCode ? (state.faculty.get(entry.facultyCode)?.name ?? entry.facultyCode) : "—";
  return `${day(entry.weekday)}, ${timeRange(entry.startMin, entry.endMin)} in ${entry.roomCode ?? "—"} with ${fac}`;
}

function revisionHistory(ctx: ReportContext): ReportContent {
  const { state } = ctx;
  const schedules = [...state.schedules.values()].filter((s) => s.termCode === ctx.termCode);
  const changes = schedules
    .flatMap((s) => (s.changes ?? []).map((c) => ({ c, s })))
    .sort((a, b) => b.c.createdAt.localeCompare(a.c.createdAt));
  const headers = ["Date and time", "Schedule", "Changed by", "Change", "Class", "Before", "After"];
  const rows = changes.map(({ c, s }) => {
    const scheduleName = `${s.candidateLabel} (${scheduleStatusLabel(s.status)})`;
    if (c.action === "REVISION_CREATED") {
      const parentId = (c.beforeJson as { parentScheduleId?: string } | null)?.parentScheduleId;
      const parent = parentId ? state.schedules.get(parentId) : undefined;
      return [manilaDateTime(c.createdAt), scheduleName, c.actor, "Revision started", "—", parent ? parent.candidateLabel : "—", s.candidateLabel];
    }
    const entry = (c.afterJson ?? c.beforeJson) as Partial<ScheduleEntryRecord> | null;
    const off = entry?.offeringCode ? state.offerings.get(entry.offeringCode) : undefined;
    const cls = off ? `${off.subjectCode} ${componentLabel(off.component).toLowerCase()}, section ${off.sectionCode}` : (entry?.offeringCode ?? "—");
    return [
      manilaDateTime(c.createdAt),
      scheduleName,
      c.actor,
      c.action === "UNDO_ENTRY_EDIT" ? "Edit undone" : c.action === "ENTRY_EDITED" ? "Class moved or reassigned" : titleCase(c.action),
      cls,
      describeEntry(c.beforeJson, state),
      describeEntry(c.afterJson, state),
    ];
  });
  return {
    title: "Revision History",
    intro: "Every manual change to this term's schedules, newest first: moves, reassignments, undos and revisions.",
    summary: [{ label: "Changes recorded", value: String(rows.length) }],
    sections: [{ headers, rows, emptyText: "No manual changes have been made to this term's schedules." }],
    sheet: { headers, rows },
  };
}

export const REPORT_BUILDERS = {
  SECTION_SCHEDULE: sectionSchedule,
  FACULTY_SCHEDULE: facultySchedule,
  ROOM_SCHEDULE: roomSchedule,
  FACULTY_LOAD: facultyLoad,
  ROOM_UTILIZATION: roomUtilization,
  COLLEGE_SUMMARY: collegeSummary,
  CONFLICTS_AND_EXCEPTIONS: conflictsAndExceptions,
  VALIDATION_AND_PREFERENCES: validationAndPreferences,
  CANDIDATE_COMPARISON: candidateComparison,
  PORTAL_ENCODING: portalEncoding,
  REVISION_HISTORY: revisionHistory,
} satisfies Record<string, (ctx: ReportContext) => ReportContent>;
