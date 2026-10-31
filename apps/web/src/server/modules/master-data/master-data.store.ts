import type {
  EmploymentType,
  RoomType,
  ScheduleStatus,
  Weekday,
} from "@ordiq/contracts";

export interface TermRecord {
  id: string;
  code: string;
  academicYear: string;
  semester: 1 | 2;
  status: "DRAFT" | "READY" | "ACTIVE" | "ARCHIVED";
  slotSizeMin: number;
  teachingDays: Weekday[];
  dayStartMin: number;
  dayEndMin: number;
}

export interface ProgramRecord {
  id: string;
  code: string;
  name: string;
  coordinator: string;
}

export interface FacultyRecord {
  id: string;
  code: string;
  alias: string;
  name: string;
  programCode: string | null;
  employmentType: EmploymentType;
  specialization: string;
  education: string;
  maxLoadUnits: number;
  maxLoadHours: number;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
}

export interface SubjectRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  programCode: string | null;
  yearLevel: number;
  category:
    | "MAJOR"
    | "GENERAL_ENGINEERING"
    | "MATHEMATICS"
    | "SCIENCE"
    | "GENERAL_EDUCATION"
    | "PATHFIT";
  units: number;
  contactHours: number;
  lectureHours: number;
  labHours: number;
  curriculumVersion: string;
  isCurrentCurriculum: boolean;
}

export interface SectionRecord {
  id: string;
  code: string;
  programCode: string;
  yearLevel: number;
  studentCount: number;
}

export interface RoomRecord {
  id: string;
  code: string;
  name: string;
  type: RoomType;
  capacity: number;
  equipment: string[];
  restrictions: string;
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
}

export interface OfferingRecord {
  id: string;
  code: string;
  termCode: string;
  sectionCode: string;
  subjectCode: string;
  component: "LECTURE" | "LAB";
  meetingsPerWeek: number;
  minutesPerMeeting: number;
  meetingPattern: "MWF" | "TTH" | "SINGLE" | "ANY";
  requiredRoomType: RoomType;
  preassignedFacultyCode: string | null;
  combinedClassGroup: string | null;
}

export interface FixedBlockRecord {
  id: string;
  termCode: string;
  sectionCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  label: string;
  location: string;
}

export interface FacultyAvailabilityRecord {
  id: string;
  facultyCode: string;
  termCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  status: "AVAILABLE" | "UNAVAILABLE";
  reason: string;
}

export interface FacultyQualificationRecord {
  id: string;
  facultyCode: string;
  subjectCode: string;
  source: "DECLARED" | "HISTORY" | "DEAN";
}

export interface FacultyPreferenceRecord {
  id: string;
  facultyCode: string;
  termCode: string;
  type:
    | "PREFERRED_DAY"
    | "AVOID_DAY"
    | "PREFERRED_TIME_WINDOW"
    | "PREFERRED_ROOM";
  value: string;
  weight: number;
  source: "SURVEY" | "LEARNED" | "DEAN";
}

export interface ScheduleEntryRecord {
  id: string;
  offeringCode: string;
  facultyCode: string;
  roomCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  pinned: boolean;
}

export interface ScheduleRecord {
  id: string;
  termCode: string;
  candidateLabel: string;
  status: ScheduleStatus;
  source: "GENERATED" | "IMPORTED";
  recheckNeeded: boolean;
  version: number;
  qualityScore: number | null;
  entries: ScheduleEntryRecord[];
}

export interface ImportBatchRecord {
  id: string;
  termCode: string | null;
  dataset: string;
  fileHash: string;
  status: "DRY_RUN" | "COMMITTED" | "FAILED";
  rowCount: number;
  insertedCount: number;
  updatedCount: number;
  errors: unknown[];
  createdAt: string;
}

export interface MasterDataState {
  terms: Map<string, TermRecord>;
  programs: Map<string, ProgramRecord>;
  faculty: Map<string, FacultyRecord>;
  subjects: Map<string, SubjectRecord>;
  sections: Map<string, SectionRecord>;
  rooms: Map<string, RoomRecord>;
  offerings: Map<string, OfferingRecord>;
  fixedBlocks: Map<string, FixedBlockRecord>;
  facultyAvailability: Map<string, FacultyAvailabilityRecord>;
  facultyQualifications: Map<string, FacultyQualificationRecord>;
  facultyPreferences: Map<string, FacultyPreferenceRecord>;
  schedules: Map<string, ScheduleRecord>;
  importBatches: Map<string, ImportBatchRecord>;
  aliasCounter: number;
}

export function createEmptyMasterDataState(): MasterDataState {
  const defaultTerm: TermRecord = {
    id: crypto.randomUUID(),
    code: "AY2026-2027-S1",
    academicYear: "2026-2027",
    semester: 1,
    status: "DRAFT",
    slotSizeMin: 30,
    teachingDays: [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ],
    dayStartMin: 450,
    dayEndMin: 1230,
  };
  const terms = new Map<string, TermRecord>();
  terms.set(defaultTerm.code, defaultTerm);

  return {
    terms,
    programs: new Map(),
    faculty: new Map(),
    subjects: new Map(),
    sections: new Map(),
    rooms: new Map(),
    offerings: new Map(),
    fixedBlocks: new Map(),
    facultyAvailability: new Map(),
    facultyQualifications: new Map(),
    facultyPreferences: new Map(),
    schedules: new Map(),
    importBatches: new Map(),
    aliasCounter: 0,
  };
}

let state: MasterDataState = createEmptyMasterDataState();

export function getMasterDataState(): MasterDataState {
  return state;
}

export function resetMasterDataState(): void {
  state = createEmptyMasterDataState();
}

export function allocateNextFacultyAlias(current: MasterDataState = state): string {
  current.aliasCounter += 1;
  return `ALIAS-${String(current.aliasCounter).padStart(3, "0")}`;
}

/**
 * Architecture Rule 11: When a faculty, subject, section, or room record changes,
 * affected schedules are marked recheckNeeded = true.
 */
export function flagSchedulesForRecheck(termCode?: string): void {
  for (const [id, sched] of state.schedules.entries()) {
    if (!termCode || sched.termCode === termCode) {
      state.schedules.set(id, { ...sched, recheckNeeded: true });
    }
  }
}

