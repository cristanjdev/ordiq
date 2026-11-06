import { EMPLOYMENT_TYPES, ROOM_TYPES, WEEKDAYS } from "@ordiq/contracts";
import type { FieldOption, FormField } from "@/components/ui/record-form-dialog";
import {
  COMPONENT_LABELS,
  MEETING_PATTERN_LABELS,
  ROOM_TYPE_LABELS,
  SUBJECT_CATEGORY_LABELS,
  titleCase,
} from "@/lib/display-labels";

export { titleCase };

/**
 * Form field definitions for each master-data table. They mirror the input
 * schemas in src/server/modules/master-data/master-data.schema.ts; the server
 * validates again on save.
 */

const enumOptions = (values: readonly string[], label: (v: string) => string = titleCase): FieldOption[] =>
  values.map((value) => ({ value, label: label(value) }));

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME_PERMANENT: "Full-Time Permanent",
  FULL_TIME_NON_PERMANENT: "Full-Time Contractual",
  PART_TIME: "Part-Time",
  VISITING: "Visiting Lecturer",
};

export const WEEKDAY_OPTIONS = enumOptions(WEEKDAYS);
export const WEEKDAY_SHORT_OPTIONS = enumOptions(WEEKDAYS, (d) => titleCase(d).slice(0, 3));

export const SUBJECT_CATEGORIES = [
  "MAJOR",
  "GENERAL_ENGINEERING",
  "MATHEMATICS",
  "SCIENCE",
  "GENERAL_EDUCATION",
  "PATHFIT",
] as const;

export interface CodeNamed {
  code: string;
  name?: string;
}

export const toOptions = (items: CodeNamed[]): FieldOption[] =>
  [...items]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((i) => ({ value: i.code, label: i.name ? `${i.code} — ${i.name}` : i.code }));

export function programFields(): FormField[] {
  return [
    { name: "code", label: "Program code", kind: "text", required: true, lockedOnEdit: true, maxLength: 20, placeholder: "e.g. CE" },
    { name: "name", label: "Program name", kind: "text", required: true, maxLength: 120, placeholder: "e.g. BS Civil Engineering" },
    { name: "coordinator", label: "Program coordinator", kind: "text", required: true, maxLength: 120, wide: true },
  ];
}

export function termFields(): FormField[] {
  return [
    { name: "code", label: "Term code", kind: "text", required: true, lockedOnEdit: true, maxLength: 40, placeholder: "e.g. AY2026-2027-S2" },
    { name: "academicYear", label: "Academic year", kind: "text", required: true, placeholder: "YYYY-YYYY" },
    { name: "semester", label: "Semester", kind: "select", required: true, options: [{ value: "1", label: "1st Semester" }, { value: "2", label: "2nd Semester" }] },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(["DRAFT", "READY", "ACTIVE", "ARCHIVED"]) },
    { name: "dayStartMin", label: "Day starts", kind: "time", required: true },
    { name: "dayEndMin", label: "Day ends", kind: "time", required: true },
    { name: "slotSizeMin", label: "Slot size (minutes)", kind: "number", required: true, min: 15, max: 120, step: 15 },
    { name: "teachingDays", label: "Teaching days", kind: "multiselect", required: true, options: WEEKDAY_SHORT_OPTIONS },
  ];
}

export function facultyFields(programs: FieldOption[]): FormField[] {
  return [
    { name: "name", label: "Full name and title", kind: "text", required: true, maxLength: 120, wide: true, placeholder: "e.g. Engr. Maria Clara Santos" },
    { name: "code", label: "Faculty code", kind: "text", required: true, lockedOnEdit: true, maxLength: 30, placeholder: "e.g. FAC-045" },
    { name: "programCode", label: "Department", kind: "select", options: programs, nullable: true, nullLabel: "General (no department)" },
    { name: "employmentType", label: "Employment type", kind: "select", required: true, options: EMPLOYMENT_TYPES.map((v) => ({ value: v, label: EMPLOYMENT_TYPE_LABELS[v] ?? titleCase(v) })) },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(["ACTIVE", "ON_LEAVE", "INACTIVE"]) },
    { name: "specialization", label: "Specialization", kind: "text", required: true, maxLength: 160, wide: true },
    { name: "education", label: "Highest degree", kind: "text", required: true, maxLength: 160, wide: true },
    { name: "maxLoadUnits", label: "Max load (units)", kind: "number", required: true, min: 1, max: 36 },
    { name: "maxLoadHours", label: "Max load (hours / week)", kind: "number", required: true, min: 1, max: 48 },
  ];
}

export function roomFields(): FormField[] {
  return [
    { name: "code", label: "Room code", kind: "text", required: true, lockedOnEdit: true, maxLength: 30, placeholder: "e.g. ENG-301" },
    { name: "name", label: "Room name", kind: "text", required: true, maxLength: 120 },
    { name: "type", label: "Room type", kind: "select", required: true, options: enumOptions(ROOM_TYPES, (v) => ROOM_TYPE_LABELS[v] ?? titleCase(v)) },
    { name: "capacity", label: "Seats", kind: "number", required: true, min: 1, max: 300 },
    { name: "status", label: "Status", kind: "select", required: true, options: enumOptions(["ACTIVE", "MAINTENANCE", "INACTIVE"]) },
    { name: "equipment", label: "Equipment", kind: "tags", wide: true, placeholder: "Projector, Whiteboard, Air-conditioning", help: "Separate items with commas." },
    { name: "restrictions", label: "Restrictions / notes", kind: "textarea", maxLength: 300 },
  ];
}

export function subjectFields(programs: FieldOption[]): FormField[] {
  return [
    { name: "code", label: "Subject code", kind: "text", required: true, lockedOnEdit: true, maxLength: 30, placeholder: "e.g. CE101" },
    { name: "name", label: "Subject title", kind: "text", required: true, maxLength: 160 },
    { name: "programCode", label: "Program", kind: "select", options: programs, nullable: true, nullLabel: "Shared (all programs)" },
    { name: "category", label: "Category", kind: "select", required: true, options: enumOptions(SUBJECT_CATEGORIES, (v) => SUBJECT_CATEGORY_LABELS[v] ?? titleCase(v)) },
    { name: "yearLevel", label: "Year level", kind: "number", required: true, min: 1, max: 5 },
    { name: "units", label: "Units", kind: "number", required: true, min: 1, max: 12 },
    { name: "lectureHours", label: "Lecture hours", kind: "number", required: true, min: 0, max: 12 },
    { name: "labHours", label: "Lab hours", kind: "number", required: true, min: 0, max: 12 },
    { name: "contactHours", label: "Contact hours / week", kind: "number", required: true, min: 1, max: 18 },
    { name: "curriculumVersion", label: "Curriculum version", kind: "text", required: true, maxLength: 30 },
    { name: "isCurrentCurriculum", label: "Part of the current curriculum", kind: "checkbox", wide: true },
    { name: "description", label: "Description", kind: "textarea", maxLength: 500 },
  ];
}

export function sectionFields(programs: FieldOption[]): FormField[] {
  return [
    { name: "code", label: "Section code", kind: "text", required: true, lockedOnEdit: true, maxLength: 30, placeholder: "e.g. CE-1A" },
    { name: "programCode", label: "Program", kind: "select", required: true, options: programs },
    { name: "yearLevel", label: "Year level", kind: "number", required: true, min: 1, max: 5 },
    { name: "studentCount", label: "Number of students", kind: "number", required: true, min: 1, max: 120, help: "Section total only; no individual student records (D-21)." },
  ];
}

export function offeringFields(options: {
  sections: FieldOption[];
  subjects: FieldOption[];
  faculty: FieldOption[];
}): FormField[] {
  return [
    { name: "sectionCode", label: "Section", kind: "select", required: true, options: options.sections, lockedOnEdit: true },
    { name: "subjectCode", label: "Subject", kind: "select", required: true, options: options.subjects, lockedOnEdit: true },
    { name: "component", label: "Component", kind: "select", required: true, options: enumOptions(["LECTURE", "LAB"], (v) => COMPONENT_LABELS[v] ?? titleCase(v)) },
    { name: "requiredRoomType", label: "Room type needed", kind: "select", required: true, options: enumOptions(ROOM_TYPES, (v) => ROOM_TYPE_LABELS[v] ?? titleCase(v)) },
    { name: "meetingsPerWeek", label: "Meetings per week", kind: "number", required: true, min: 1, max: 6 },
    { name: "minutesPerMeeting", label: "Minutes per meeting", kind: "number", required: true, min: 30, max: 360, step: 30 },
    { name: "meetingPattern", label: "Meeting pattern", kind: "select", required: true, options: enumOptions(["ANY", "MWF", "TTH", "SINGLE"], (v) => MEETING_PATTERN_LABELS[v] ?? v) },
    { name: "preassignedFacultyCode", label: "Pre-assigned faculty", kind: "select", options: options.faculty, nullable: true, nullLabel: "Let the solver choose" },
    { name: "combinedClassGroup", label: "Combined-class group", kind: "text", nullable: true, maxLength: 40, help: "Offerings with the same group meet together." },
    { name: "code", label: "Offering code", kind: "text", lockedOnEdit: true, maxLength: 40, help: "Leave empty to build it from the term, section and subject." },
  ];
}

export function fixedBlockFields(sections: FieldOption[]): FormField[] {
  return [
    { name: "label", label: "Label", kind: "text", required: true, maxLength: 120, wide: true, placeholder: "e.g. NSTP / ROTC" },
    { name: "sectionCode", label: "Section", kind: "select", required: true, options: sections },
    { name: "weekday", label: "Day", kind: "select", required: true, options: WEEKDAY_OPTIONS },
    { name: "startMin", label: "Starts", kind: "time", required: true },
    { name: "endMin", label: "Ends", kind: "time", required: true },
    { name: "location", label: "Location", kind: "text", required: true, maxLength: 120, wide: true },
  ];
}

/** Directive types the Dean manages on the Rules page (PIN_MEETING and SET_WEIGHT live elsewhere). */
export const EDITABLE_DIRECTIVE_TYPES = [
  "FACULTY_NOT_ON_DAY",
  "FACULTY_TIME_WINDOW",
  "SECTION_TIME_WINDOW",
  "AVOID_ROOM",
  "REQUIRE_ROOM",
  "ASSIGN_FACULTY",
] as const;

export type EditableDirectiveType = (typeof EDITABLE_DIRECTIVE_TYPES)[number];

export const DIRECTIVE_TYPE_LABELS: Record<string, string> = {
  FACULTY_NOT_ON_DAY: "Faculty not on a day",
  FACULTY_TIME_WINDOW: "Faculty time window",
  SECTION_TIME_WINDOW: "Section time window",
  AVOID_ROOM: "Avoid a room",
  REQUIRE_ROOM: "Require a room",
  PIN_MEETING: "Pin a meeting",
  ASSIGN_FACULTY: "Assign faculty",
  SET_WEIGHT: "Objective weight",
};

/** Fields for one directive type; mirrors directiveInputSchema on the server. */
export function directiveFields(
  type: string,
  options: { faculty: FieldOption[]; sections: FieldOption[]; rooms: FieldOption[]; offerings: FieldOption[] },
): FormField[] {
  const fields: FormField[] = [];
  const faculty: FormField = { name: "facultyCode", label: "Faculty member", kind: "select", required: true, options: options.faculty };
  const section: FormField = { name: "sectionCode", label: "Section", kind: "select", required: true, options: options.sections };
  const room: FormField = { name: "roomCode", label: "Room", kind: "select", required: true, options: options.rooms };
  const offering: FormField = { name: "offeringCode", label: "Offering", kind: "select", required: true, options: options.offerings };
  const start: FormField = { name: "startMin", label: "Allowed from", kind: "time", required: true };
  const end: FormField = { name: "endMin", label: "Allowed until", kind: "time", required: true };
  switch (type) {
    case "FACULTY_NOT_ON_DAY":
      fields.push(faculty, { name: "weekday", label: "Day", kind: "select", required: true, options: WEEKDAY_OPTIONS });
      break;
    case "FACULTY_TIME_WINDOW":
      fields.push(faculty, start, end);
      break;
    case "SECTION_TIME_WINDOW":
      fields.push(section, start, end);
      break;
    case "AVOID_ROOM":
      fields.push(
        room,
        { name: "offeringCode", label: "Only for offering", kind: "select", options: options.offerings, nullable: true, nullLabel: "All offerings" },
        { name: "facultyCode", label: "Only for faculty", kind: "select", options: options.faculty, nullable: true, nullLabel: "All faculty" },
      );
      break;
    case "REQUIRE_ROOM":
      fields.push(offering, room);
      break;
    case "ASSIGN_FACULTY":
      fields.push(offering, faculty);
      break;
  }
  fields.push(
    {
      name: "hardness",
      label: "Strength",
      kind: "select",
      required: true,
      options: [
        { value: "HARD", label: "Hard: must hold once approved (HC-12)" },
        { value: "SOFT", label: "Soft: preferred, weighted" },
      ],
    },
    { name: "weight", label: "Weight (soft only)", kind: "number", required: true, min: 0, max: 100, help: "Higher weights matter more to the solver." },
  );
  return fields;
}
