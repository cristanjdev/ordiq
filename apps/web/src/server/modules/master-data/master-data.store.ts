import type {
  DirectiveType,
  EmploymentType,
  EngineValidationResponse,
  HardConstraintCode,
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

export interface DirectiveRecord {
  id: string;
  termCode: string;
  type: DirectiveType;
  hardness: "HARD" | "SOFT";
  approved: boolean;
  facultyCode: string | null;
  sectionCode: string | null;
  roomCode: string | null;
  offeringCode: string | null;
  weekday: Weekday | null;
  startMin: number | null;
  endMin: number | null;
  weight: number;
  createdBy: string;
  createdAt: string;
}

export interface ScheduleEntryRecord {
  id: string;
  offeringCode: string;
  meetingIndex?: number;
  facultyCode: string;
  roomCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  pinned: boolean;
}

export interface UnscheduledMeetingRecord {
  offeringCode: string;
  meetingIndex: number;
  reasonCode: string;
  reasonDetail: string;
}

export interface ScheduleExceptionRecord {
  id: string;
  scheduleId: string;
  code: HardConstraintCode;
  offeringCode: string | null;
  facultyCode: string | null;
  roomCode: string | null;
  sectionCode: string | null;
  reason: string;
  approvedBy: string;
  createdAt: string;
}

export interface ScheduleChangeRecord {
  id: string;
  scheduleId: string;
  actor: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
}

export interface ScheduleRecord {
  id: string;
  termCode: string;
  runId?: string | null;
  parentScheduleId?: string | null;
  candidateLabel: string;
  profileName?: string;
  status: ScheduleStatus;
  source: "GENERATED" | "IMPORTED";
  solverStatus?: "PROVEN_OPTIMAL" | "BEST_FOUND" | "INFEASIBLE" | "CANCELLED";
  optimalityGapPct?: number;
  recheckNeeded: boolean;
  version: number;
  qualityScore: number | null;
  entries: ScheduleEntryRecord[];
  unscheduled?: UnscheduledMeetingRecord[];
  exceptions?: ScheduleExceptionRecord[];
  changes?: ScheduleChangeRecord[];
  validationReport?: EngineValidationResponse | null;
  acceptedAt?: string | null;
  acceptedBy?: string | null;
}

export interface GenerationRunRecord {
  id: string;
  termCode: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "SOLVER_MODEL_BUG";
  profiles: string[];
  candidateScheduleIds: string[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ChangeProposalRecord {
  id: string;
  scheduleId: string;
  termCode: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  summary: string;
  offeringCode: string;
  meetingIndex: number;
  beforeEntry: ScheduleEntryRecord;
  afterEntry: ScheduleEntryRecord;
  qualityDelta: number;
  resultingQualityScore: number;
  valid: boolean;
  createdBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  parts: unknown[];
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  termCode: string;
  title: string;
  messages: MessageRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface LlmUsageRecord {
  id: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  estimatedCostPhp: number;
  createdAt: string;
}

export interface ModelVersionRecord {
  id: string;
  versionNumber: number;
  kind: string;
  status: "ACTIVE" | "CANDIDATE" | "ARCHIVED";
  parameters: Record<string, unknown>;
  metrics: {
    sampleCount: number;
    top1Accuracy: number;
    top3Accuracy: number;
    baselineTop1Accuracy: number;
    featureNames: string[];
  };
  trainedAt: string;
}

export interface LearningEventRecord {
  id: string;
  termCode: string;
  scheduleId: string;
  type: "SCHEDULE_ACCEPTED" | "DEAN_EDIT";
  facultyCode: string;
  subjectCode: string;
  weekday: Weekday;
  startMin: number;
  weight: number;
  createdAt: string;
}

export interface EvaluationSessionRecord {
  id: string;
  termCode: string;
  stage: "STAGE_1_BASELINE" | "STAGE_2_CONFLICT_CHECK" | "STAGE_3_GENERATION";
  scenario: string;
  participantRole: string;
  scheduleId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
  correctionCount: number;
  conflictCountBefore: number;
  conflictCountAfter: number;
  iso25010Ratings: {
    functionalSuitability: number;
    performanceEfficiency: number;
    usability: number;
    reliability: number;
    security: number;
    maintainability: number;
  } | null;
  notes: string;
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
  directives: Map<string, DirectiveRecord>;
  schedules: Map<string, ScheduleRecord>;
  generationRuns: Map<string, GenerationRunRecord>;
  proposals: Map<string, ChangeProposalRecord>;
  conversations: Map<string, ConversationRecord>;
  llmUsage: LlmUsageRecord[];
  modelVersions: Map<string, ModelVersionRecord>;
  learningEvents: LearningEventRecord[];
  evaluationSessions: Map<string, EvaluationSessionRecord>;
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
    directives: new Map(),
    schedules: new Map(),
    generationRuns: new Map(),
    proposals: new Map(),
    conversations: new Map(),
    llmUsage: [],
    modelVersions: new Map(),
    learningEvents: [],
    evaluationSessions: new Map(),
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

export function allocateNextFacultyAlias(
  current: MasterDataState = state,
): string {
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
