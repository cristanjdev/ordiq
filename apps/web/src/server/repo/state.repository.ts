import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createEmptyMasterDataState,
  facultyAvailabilityKey,
  facultyPreferenceKey,
  facultyQualificationKey,
  fixedBlockKey,
  type ChangeProposalRecord,
  type ConversationRecord,
  type DirectiveRecord,
  type EvaluationSessionRecord,
  type FacultyAvailabilityRecord,
  type FacultyPreferenceRecord,
  type FacultyQualificationRecord,
  type FacultyRecord,
  type FixedBlockRecord,
  type GenerationRunRecord,
  type ImportBatchRecord,
  type LearningEventRecord,
  type LlmUsageRecord,
  type MasterDataState,
  type ModelVersionRecord,
  type OfferingRecord,
  type ProgramRecord,
  type RoomRecord,
  type ScheduleEntryRecord,
  type ScheduleRecord,
  type SectionRecord,
  type SubjectRecord,
  type TermRecord,
} from "../modules/master-data/master-data.store";

/**
 * State repository (D-25).
 *
 * The domain services work on one in-memory `MasterDataState`. This module is
 * the only code that maps that state to PostgreSQL: it loads every table into
 * a fresh state, and writes back exactly the records that changed since the
 * last load or save (a unit of work), inside the caller's transaction.
 *
 * Change detection compares a JSON fingerprint per record, so in-place
 * mutations (`conv.messages.push(...)`) are caught as well as `Map.set`.
 */

type Db = PrismaClient | Prisma.TransactionClient;
type Row = Record<string, unknown>;

/** Fingerprints of what the database holds, per collection, per record id. */
export type StateSnapshot = Map<CollectionName, Map<string, string>>;

export interface ChangedRecord {
  key: string;
  record: unknown;
}

export interface StateChanges {
  upserts: Map<CollectionName, ChangedRecord[]>;
  deletes: Map<CollectionName, string[]>;
  aliasCounter: number;
  count: number;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();
const now = (): string => new Date().toISOString();

/** Omit a key when the column is NULL, for record fields declared optional (`?:`). */
function optional<K extends string, V>(key: K, value: V | null): { [P in K]?: V } {
  return (value === null ? {} : { [key]: value }) as { [P in K]?: V };
}

interface Collection<R> {
  /** Table name (`@@map`). */
  table: string;
  /** Records currently in the state, with the Map key each one is stored under. */
  entries(state: MasterDataState): Iterable<[string, R]>;
  id(record: R): string;
  /** Snake-case row for `jsonb_populate_recordset`; `updated_at`/`created_at` are added if absent. */
  toRow(record: R, key: string): Row;
  load(db: Db, state: MasterDataState): Promise<void>;
  /** Child rows written alongside a parent (schedule entries, messages). */
  children?: {
    table: string;
    parentColumn: string;
    rows(record: R): Row[];
  };
}

function mapEntries<R>(map: Map<string, R>): Iterable<[string, R]> {
  return map.entries();
}

function arrayEntries<R extends { id: string }>(list: R[]): Iterable<[string, R]> {
  return list.map((r) => [r.id, r] as [string, R]);
}

// ---------------------------------------------------------------------------
// Collections, in foreign-key order: parents before children. Saves upsert in
// this order and delete in reverse.
// ---------------------------------------------------------------------------

const terms: Collection<TermRecord> = {
  table: "terms",
  entries: (s) => mapEntries(s.terms),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    academic_year: r.academicYear,
    semester: r.semester,
    status: r.status,
    slot_size_min: r.slotSizeMin,
    teaching_days: r.teachingDays,
    day_start_min: r.dayStartMin,
    day_end_min: r.dayEndMin,
  }),
  async load(db, s) {
    for (const t of await db.term.findMany({ orderBy: { createdAt: "asc" } })) {
      s.terms.set(t.code, {
        id: t.id,
        code: t.code,
        academicYear: t.academicYear,
        semester: t.semester as TermRecord["semester"],
        status: t.status as TermRecord["status"],
        slotSizeMin: t.slotSizeMin,
        teachingDays: t.teachingDays as TermRecord["teachingDays"],
        dayStartMin: t.dayStartMin,
        dayEndMin: t.dayEndMin,
      });
    }
  },
};

const programs: Collection<ProgramRecord> = {
  table: "programs",
  entries: (s) => mapEntries(s.programs),
  id: (r) => r.id,
  toRow: (r) => ({ id: r.id, code: r.code, name: r.name, coordinator: r.coordinator }),
  async load(db, s) {
    for (const p of await db.program.findMany({ orderBy: { code: "asc" } })) {
      s.programs.set(p.code, { id: p.id, code: p.code, name: p.name, coordinator: p.coordinator });
    }
  },
};

const subjects: Collection<SubjectRecord> = {
  table: "subjects",
  entries: (s) => mapEntries(s.subjects),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    program_code: r.programCode,
    year_level: r.yearLevel,
    category: r.category,
    units: r.units,
    contact_hours: r.contactHours,
    lecture_hours: r.lectureHours,
    lab_hours: r.labHours,
    curriculum_version: r.curriculumVersion,
    is_current_curriculum: r.isCurrentCurriculum,
  }),
  async load(db, s) {
    for (const r of await db.subject.findMany({ orderBy: { code: "asc" } })) {
      s.subjects.set(r.code, {
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        programCode: r.programCode,
        yearLevel: r.yearLevel,
        category: r.category as SubjectRecord["category"],
        units: r.units,
        contactHours: r.contactHours,
        lectureHours: r.lectureHours,
        labHours: r.labHours,
        curriculumVersion: r.curriculumVersion,
        isCurrentCurriculum: r.isCurrentCurriculum,
      });
    }
  },
};

const faculty: Collection<FacultyRecord> = {
  table: "faculty",
  entries: (s) => mapEntries(s.faculty),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    alias: r.alias,
    name: r.name,
    program_code: r.programCode,
    employment_type: r.employmentType,
    specialization: r.specialization,
    education: r.education,
    max_load_units: r.maxLoadUnits,
    max_load_hours: r.maxLoadHours,
    status: r.status,
  }),
  async load(db, s) {
    for (const r of await db.faculty.findMany({ orderBy: { code: "asc" } })) {
      s.faculty.set(r.code, {
        id: r.id,
        code: r.code,
        alias: r.alias,
        name: r.name,
        programCode: r.programCode,
        employmentType: r.employmentType as FacultyRecord["employmentType"],
        specialization: r.specialization,
        education: r.education,
        maxLoadUnits: r.maxLoadUnits,
        maxLoadHours: r.maxLoadHours,
        status: r.status as FacultyRecord["status"],
      });
    }
  },
};

const sections: Collection<SectionRecord> = {
  table: "sections",
  entries: (s) => mapEntries(s.sections),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    program_code: r.programCode,
    year_level: r.yearLevel,
    student_count: r.studentCount,
  }),
  async load(db, s) {
    for (const r of await db.section.findMany({ orderBy: { code: "asc" } })) {
      s.sections.set(r.code, {
        id: r.id,
        code: r.code,
        programCode: r.programCode,
        yearLevel: r.yearLevel,
        studentCount: r.studentCount,
      });
    }
  },
};

const rooms: Collection<RoomRecord> = {
  table: "rooms",
  entries: (s) => mapEntries(s.rooms),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    capacity: r.capacity,
    equipment: r.equipment,
    restrictions: r.restrictions,
    status: r.status,
  }),
  async load(db, s) {
    for (const r of await db.room.findMany({ orderBy: { code: "asc" } })) {
      s.rooms.set(r.code, {
        id: r.id,
        code: r.code,
        name: r.name,
        type: r.type as RoomRecord["type"],
        capacity: r.capacity,
        equipment: r.equipment as string[],
        restrictions: r.restrictions,
        status: r.status as RoomRecord["status"],
      });
    }
  },
};

const offerings: Collection<OfferingRecord> = {
  table: "offerings",
  entries: (s) => mapEntries(s.offerings),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    code: r.code,
    term_code: r.termCode,
    section_code: r.sectionCode,
    subject_code: r.subjectCode,
    component: r.component,
    meetings_per_week: r.meetingsPerWeek,
    minutes_per_meeting: r.minutesPerMeeting,
    meeting_pattern: r.meetingPattern,
    required_room_type: r.requiredRoomType,
    preassigned_faculty_code: r.preassignedFacultyCode,
    combined_class_group: r.combinedClassGroup,
  }),
  async load(db, s) {
    for (const r of await db.offering.findMany({ orderBy: { code: "asc" } })) {
      s.offerings.set(r.code, {
        id: r.id,
        code: r.code,
        termCode: r.termCode,
        sectionCode: r.sectionCode,
        subjectCode: r.subjectCode,
        component: r.component as OfferingRecord["component"],
        meetingsPerWeek: r.meetingsPerWeek,
        minutesPerMeeting: r.minutesPerMeeting,
        meetingPattern: r.meetingPattern as OfferingRecord["meetingPattern"],
        requiredRoomType: r.requiredRoomType as OfferingRecord["requiredRoomType"],
        preassignedFacultyCode: r.preassignedFacultyCode,
        combinedClassGroup: r.combinedClassGroup,
      });
    }
  },
};

const fixedBlocks: Collection<FixedBlockRecord> = {
  table: "fixed_blocks",
  entries: (s) => mapEntries(s.fixedBlocks),
  id: (r) => r.id,
  toRow: (r, key) => ({
    id: r.id,
    natural_key: key,
    term_code: r.termCode,
    section_code: r.sectionCode,
    weekday: r.weekday,
    start_min: r.startMin,
    end_min: r.endMin,
    label: r.label,
    location: r.location,
  }),
  async load(db, s) {
    for (const r of await db.fixedBlock.findMany({ orderBy: { naturalKey: "asc" } })) {
      const record: FixedBlockRecord = {
        id: r.id,
        termCode: r.termCode,
        sectionCode: r.sectionCode,
        weekday: r.weekday as FixedBlockRecord["weekday"],
        startMin: r.startMin,
        endMin: r.endMin,
        label: r.label,
        location: r.location,
      };
      s.fixedBlocks.set(r.naturalKey || fixedBlockKey(record), record);
    }
  },
};

const facultyAvailability: Collection<FacultyAvailabilityRecord> = {
  table: "faculty_availability",
  entries: (s) => mapEntries(s.facultyAvailability),
  id: (r) => r.id,
  toRow: (r, key) => ({
    id: r.id,
    natural_key: key,
    faculty_code: r.facultyCode,
    term_code: r.termCode,
    weekday: r.weekday,
    start_min: r.startMin,
    end_min: r.endMin,
    status: r.status,
    reason: r.reason,
  }),
  async load(db, s) {
    for (const r of await db.facultyAvailability.findMany({ orderBy: { naturalKey: "asc" } })) {
      const record: FacultyAvailabilityRecord = {
        id: r.id,
        facultyCode: r.facultyCode,
        termCode: r.termCode,
        weekday: r.weekday as FacultyAvailabilityRecord["weekday"],
        startMin: r.startMin,
        endMin: r.endMin,
        status: r.status as FacultyAvailabilityRecord["status"],
        reason: r.reason,
      };
      s.facultyAvailability.set(r.naturalKey || facultyAvailabilityKey(record), record);
    }
  },
};

const facultyQualifications: Collection<FacultyQualificationRecord> = {
  table: "faculty_qualifications",
  entries: (s) => mapEntries(s.facultyQualifications),
  id: (r) => r.id,
  toRow: (r, key) => ({
    id: r.id,
    natural_key: key,
    faculty_code: r.facultyCode,
    subject_code: r.subjectCode,
    source: r.source,
  }),
  async load(db, s) {
    for (const r of await db.facultyQualification.findMany({ orderBy: { naturalKey: "asc" } })) {
      const record: FacultyQualificationRecord = {
        id: r.id,
        facultyCode: r.facultyCode,
        subjectCode: r.subjectCode,
        source: r.source as FacultyQualificationRecord["source"],
      };
      s.facultyQualifications.set(r.naturalKey || facultyQualificationKey(record), record);
    }
  },
};

const facultyPreferences: Collection<FacultyPreferenceRecord> = {
  table: "faculty_preferences",
  entries: (s) => mapEntries(s.facultyPreferences),
  id: (r) => r.id,
  toRow: (r, key) => ({
    id: r.id,
    natural_key: key,
    faculty_code: r.facultyCode,
    term_code: r.termCode,
    type: r.type,
    value: r.value,
    weight: r.weight,
    source: r.source,
  }),
  async load(db, s) {
    for (const r of await db.facultyPreference.findMany({ orderBy: { naturalKey: "asc" } })) {
      const record: FacultyPreferenceRecord = {
        id: r.id,
        facultyCode: r.facultyCode,
        termCode: r.termCode,
        type: r.type as FacultyPreferenceRecord["type"],
        value: r.value,
        weight: r.weight,
        source: r.source as FacultyPreferenceRecord["source"],
      };
      s.facultyPreferences.set(r.naturalKey || facultyPreferenceKey(record), record);
    }
  },
};

const directives: Collection<DirectiveRecord> = {
  table: "directives",
  entries: (s) => mapEntries(s.directives),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    type: r.type,
    hardness: r.hardness,
    approved: r.approved,
    faculty_code: r.facultyCode,
    section_code: r.sectionCode,
    room_code: r.roomCode,
    offering_code: r.offeringCode,
    weekday: r.weekday,
    start_min: r.startMin,
    end_min: r.endMin,
    weight: r.weight,
    created_by: r.createdBy,
    created_at: r.createdAt,
  }),
  async load(db, s) {
    for (const r of await db.directive.findMany({ orderBy: { createdAt: "asc" } })) {
      s.directives.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        type: r.type as DirectiveRecord["type"],
        hardness: r.hardness as DirectiveRecord["hardness"],
        approved: r.approved,
        facultyCode: r.facultyCode,
        sectionCode: r.sectionCode,
        roomCode: r.roomCode,
        offeringCode: r.offeringCode,
        weekday: r.weekday as DirectiveRecord["weekday"],
        startMin: r.startMin,
        endMin: r.endMin,
        weight: r.weight,
        createdBy: r.createdBy,
        createdAt: isoReq(r.createdAt),
      });
    }
  },
};

const generationRuns: Collection<GenerationRunRecord> = {
  table: "generation_runs",
  entries: (s) => mapEntries(s.generationRuns),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    status: r.status,
    profiles: r.profiles,
    candidate_schedule_ids: r.candidateScheduleIds,
    error: r.error,
    created_at: r.createdAt,
    completed_at: r.completedAt,
  }),
  async load(db, s) {
    for (const r of await db.generationRun.findMany({ orderBy: { createdAt: "asc" } })) {
      s.generationRuns.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        status: r.status as GenerationRunRecord["status"],
        profiles: r.profiles as string[],
        candidateScheduleIds: r.candidateScheduleIds as string[],
        error: r.error,
        createdAt: isoReq(r.createdAt),
        completedAt: iso(r.completedAt),
      });
    }
  },
};

function entryRow(e: ScheduleEntryRecord, position: number): Row {
  return {
    id: e.id,
    position,
    offering_code: e.offeringCode,
    meeting_index: e.meetingIndex ?? null,
    faculty_code: e.facultyCode,
    room_code: e.roomCode,
    weekday: e.weekday,
    start_min: e.startMin,
    end_min: e.endMin,
    pinned: e.pinned,
  };
}

const schedules: Collection<ScheduleRecord> = {
  table: "schedules",
  entries: (s) => mapEntries(s.schedules),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    run_id: r.runId ?? null,
    parent_schedule_id: r.parentScheduleId ?? null,
    candidate_label: r.candidateLabel,
    profile_name: r.profileName ?? null,
    status: r.status,
    source: r.source,
    solver_status: r.solverStatus ?? null,
    optimality_gap_pct: r.optimalityGapPct ?? null,
    recheck_needed: r.recheckNeeded,
    version: r.version,
    quality_score: r.qualityScore,
    unscheduled: r.unscheduled ?? null,
    exceptions: r.exceptions ?? null,
    changes: r.changes ?? null,
    validation_report: r.validationReport ?? null,
    accepted_at: r.acceptedAt ?? null,
    accepted_by: r.acceptedBy ?? null,
  }),
  children: {
    table: "schedule_entries",
    parentColumn: "schedule_id",
    rows: (r) => r.entries.map((e, i) => ({ schedule_id: r.id, ...entryRow(e, i) })),
  },
  async load(db, s) {
    const rows = await db.schedule.findMany({
      orderBy: { createdAt: "asc" },
      include: { entries: { orderBy: { position: "asc" } } },
    });
    for (const r of rows) {
      s.schedules.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        ...optional("runId", r.runId),
        ...optional("parentScheduleId", r.parentScheduleId),
        candidateLabel: r.candidateLabel,
        ...optional("profileName", r.profileName),
        status: r.status as ScheduleRecord["status"],
        source: r.source as ScheduleRecord["source"],
        ...optional("solverStatus", r.solverStatus as ScheduleRecord["solverStatus"] | null),
        ...optional("optimalityGapPct", r.optimalityGapPct),
        recheckNeeded: r.recheckNeeded,
        version: r.version,
        qualityScore: r.qualityScore,
        entries: r.entries.map((e) => ({
          id: e.id,
          offeringCode: e.offeringCode,
          ...optional("meetingIndex", e.meetingIndex),
          facultyCode: e.facultyCode,
          roomCode: e.roomCode,
          weekday: e.weekday as ScheduleEntryRecord["weekday"],
          startMin: e.startMin,
          endMin: e.endMin,
          pinned: e.pinned,
        })),
        ...optional("unscheduled", r.unscheduled as ScheduleRecord["unscheduled"] | null),
        ...optional("exceptions", r.exceptions as ScheduleRecord["exceptions"] | null),
        ...optional("changes", r.changes as ScheduleRecord["changes"] | null),
        ...optional(
          "validationReport",
          r.validationReport as ScheduleRecord["validationReport"] | null,
        ),
        ...optional("acceptedAt", iso(r.acceptedAt)),
        ...optional("acceptedBy", r.acceptedBy),
      });
    }
  },
};

const proposals: Collection<ChangeProposalRecord> = {
  table: "change_proposals",
  entries: (s) => mapEntries(s.proposals),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    schedule_id: r.scheduleId,
    term_code: r.termCode,
    status: r.status,
    summary: r.summary,
    offering_code: r.offeringCode,
    meeting_index: r.meetingIndex,
    before_entry: r.beforeEntry,
    after_entry: r.afterEntry,
    quality_delta: r.qualityDelta,
    resulting_quality_score: r.resultingQualityScore,
    valid: r.valid,
    created_by: r.createdBy,
    created_at: r.createdAt,
    resolved_at: r.resolvedAt,
  }),
  async load(db, s) {
    for (const r of await db.changeProposal.findMany({ orderBy: { createdAt: "asc" } })) {
      s.proposals.set(r.id, {
        id: r.id,
        scheduleId: r.scheduleId,
        termCode: r.termCode,
        status: r.status as ChangeProposalRecord["status"],
        summary: r.summary,
        offeringCode: r.offeringCode,
        meetingIndex: r.meetingIndex,
        beforeEntry: r.beforeEntry as unknown as ScheduleEntryRecord,
        afterEntry: r.afterEntry as unknown as ScheduleEntryRecord,
        qualityDelta: r.qualityDelta,
        resultingQualityScore: r.resultingQualityScore,
        valid: r.valid,
        createdBy: r.createdBy,
        createdAt: isoReq(r.createdAt),
        resolvedAt: iso(r.resolvedAt),
      });
    }
  },
};

const conversations: Collection<ConversationRecord> = {
  table: "conversations",
  entries: (s) => mapEntries(s.conversations),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    title: r.title,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }),
  children: {
    table: "messages",
    parentColumn: "conversation_id",
    rows: (r) =>
      r.messages.map((m, i) => ({
        id: m.id,
        conversation_id: r.id,
        position: i,
        role: m.role,
        content: m.content,
        parts: m.parts,
        created_at: m.createdAt,
      })),
  },
  async load(db, s) {
    const rows = await db.conversation.findMany({
      orderBy: { createdAt: "asc" },
      include: { messages: { orderBy: { position: "asc" } } },
    });
    for (const r of rows) {
      s.conversations.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        title: r.title,
        messages: r.messages.map((m) => ({
          id: m.id,
          conversationId: m.conversationId,
          role: m.role as "user" | "assistant",
          content: m.content,
          parts: m.parts as unknown[],
          createdAt: isoReq(m.createdAt),
        })),
        createdAt: isoReq(r.createdAt),
        updatedAt: isoReq(r.updatedAt),
      });
    }
  },
};

const llmUsage: Collection<LlmUsageRecord> = {
  table: "llm_usage",
  entries: (s) => arrayEntries(s.llmUsage),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    provider: r.provider,
    model: r.model,
    tokens_in: r.tokensIn,
    tokens_out: r.tokensOut,
    estimated_cost_php: r.estimatedCostPhp,
    created_at: r.createdAt,
  }),
  async load(db, s) {
    for (const r of await db.llmUsage.findMany({ orderBy: { createdAt: "asc" } })) {
      s.llmUsage.push({
        id: r.id,
        provider: r.provider,
        model: r.model,
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        estimatedCostPhp: r.estimatedCostPhp,
        createdAt: isoReq(r.createdAt),
      });
    }
  },
};

const modelVersions: Collection<ModelVersionRecord> = {
  table: "model_versions",
  entries: (s) => mapEntries(s.modelVersions),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    version_number: r.versionNumber,
    kind: r.kind,
    status: r.status,
    parameters: r.parameters,
    metrics: r.metrics,
    trained_at: r.trainedAt,
  }),
  async load(db, s) {
    for (const r of await db.modelVersion.findMany({ orderBy: { versionNumber: "asc" } })) {
      s.modelVersions.set(r.id, {
        id: r.id,
        versionNumber: r.versionNumber,
        kind: r.kind,
        status: r.status as ModelVersionRecord["status"],
        parameters: r.parameters as Record<string, unknown>,
        metrics: r.metrics as unknown as ModelVersionRecord["metrics"],
        trainedAt: isoReq(r.trainedAt),
      });
    }
  },
};

const learningEvents: Collection<LearningEventRecord> = {
  table: "learning_events",
  entries: (s) => arrayEntries(s.learningEvents),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    schedule_id: r.scheduleId,
    type: r.type,
    faculty_code: r.facultyCode,
    subject_code: r.subjectCode,
    weekday: r.weekday,
    start_min: r.startMin,
    weight: r.weight,
    created_at: r.createdAt,
  }),
  async load(db, s) {
    for (const r of await db.learningEvent.findMany({ orderBy: { createdAt: "asc" } })) {
      s.learningEvents.push({
        id: r.id,
        termCode: r.termCode,
        scheduleId: r.scheduleId,
        type: r.type as LearningEventRecord["type"],
        facultyCode: r.facultyCode,
        subjectCode: r.subjectCode,
        weekday: r.weekday as LearningEventRecord["weekday"],
        startMin: r.startMin,
        weight: r.weight,
        createdAt: isoReq(r.createdAt),
      });
    }
  },
};

const evaluationSessions: Collection<EvaluationSessionRecord> = {
  table: "evaluation_sessions",
  entries: (s) => mapEntries(s.evaluationSessions),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    stage: r.stage,
    scenario: r.scenario,
    participant_role: r.participantRole,
    schedule_id: r.scheduleId,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    duration_minutes: r.durationMinutes,
    correction_count: r.correctionCount,
    conflict_count_before: r.conflictCountBefore,
    conflict_count_after: r.conflictCountAfter,
    iso25010_ratings: r.iso25010Ratings,
    notes: r.notes,
  }),
  async load(db, s) {
    for (const r of await db.evaluationSession.findMany({ orderBy: { startedAt: "asc" } })) {
      s.evaluationSessions.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        stage: r.stage as EvaluationSessionRecord["stage"],
        scenario: r.scenario,
        participantRole: r.participantRole,
        scheduleId: r.scheduleId,
        startedAt: isoReq(r.startedAt),
        endedAt: iso(r.endedAt),
        durationMinutes: r.durationMinutes,
        correctionCount: r.correctionCount,
        conflictCountBefore: r.conflictCountBefore,
        conflictCountAfter: r.conflictCountAfter,
        iso25010Ratings: r.iso25010Ratings as EvaluationSessionRecord["iso25010Ratings"],
        notes: r.notes,
      });
    }
  },
};

const importBatches: Collection<ImportBatchRecord> = {
  table: "import_batches",
  entries: (s) => mapEntries(s.importBatches),
  id: (r) => r.id,
  toRow: (r) => ({
    id: r.id,
    term_code: r.termCode,
    dataset: r.dataset,
    file_hash: r.fileHash,
    status: r.status,
    row_count: r.rowCount,
    inserted_count: r.insertedCount,
    updated_count: r.updatedCount,
    errors: r.errors,
    created_at: r.createdAt,
  }),
  async load(db, s) {
    for (const r of await db.importBatch.findMany({ orderBy: { createdAt: "asc" } })) {
      s.importBatches.set(r.id, {
        id: r.id,
        termCode: r.termCode,
        dataset: r.dataset,
        fileHash: r.fileHash,
        status: r.status as ImportBatchRecord["status"],
        rowCount: r.rowCount,
        insertedCount: r.insertedCount,
        updatedCount: r.updatedCount,
        errors: r.errors as unknown[],
        createdAt: isoReq(r.createdAt),
      });
    }
  },
};

const COLLECTIONS = {
  terms,
  programs,
  subjects,
  faculty,
  sections,
  rooms,
  offerings,
  fixedBlocks,
  facultyAvailability,
  facultyQualifications,
  facultyPreferences,
  directives,
  generationRuns,
  schedules,
  proposals,
  conversations,
  llmUsage,
  modelVersions,
  learningEvents,
  evaluationSessions,
  importBatches,
} as const;

export type CollectionName = keyof typeof COLLECTIONS;
const ORDER = Object.keys(COLLECTIONS) as CollectionName[];

function collection(name: CollectionName): Collection<unknown> {
  return COLLECTIONS[name] as unknown as Collection<unknown>;
}

// ---------------------------------------------------------------------------
// Snapshots and change sets
// ---------------------------------------------------------------------------

function fingerprint(key: string, record: unknown): string {
  return `${key}\u0000${JSON.stringify(record)}`;
}

/** Fingerprint every record of a state, keyed by collection and record id. */
export function takeSnapshot(state: MasterDataState): StateSnapshot {
  const snapshot: StateSnapshot = new Map();
  for (const name of ORDER) {
    const col = collection(name);
    const prints = new Map<string, string>();
    for (const [key, record] of col.entries(state)) {
      prints.set(col.id(record), fingerprint(key, record));
    }
    snapshot.set(name, prints);
  }
  return snapshot;
}

/** Records that differ from the snapshot: new or changed rows, and removed ids. */
export function diffState(
  snapshot: StateSnapshot,
  state: MasterDataState,
  savedAliasCounter: number,
): StateChanges {
  const upserts = new Map<CollectionName, ChangedRecord[]>();
  const deletes = new Map<CollectionName, string[]>();
  let count = 0;

  for (const name of ORDER) {
    const col = collection(name);
    const before = snapshot.get(name) ?? new Map<string, string>();
    const seen = new Set<string>();
    const changed: ChangedRecord[] = [];
    for (const [key, record] of col.entries(state)) {
      const id = col.id(record);
      seen.add(id);
      if (before.get(id) !== fingerprint(key, record)) changed.push({ key, record });
    }
    const removed = [...before.keys()].filter((id) => !seen.has(id));
    if (changed.length) upserts.set(name, changed);
    if (removed.length) deletes.set(name, removed);
    count += changed.length + removed.length;
  }

  if (state.aliasCounter !== savedAliasCounter) count += 1;
  return { upserts, deletes, aliasCounter: state.aliasCounter, count };
}

// ---------------------------------------------------------------------------
// Database I/O
// ---------------------------------------------------------------------------

/**
 * Bulk upsert in one statement per table: rows travel as a single JSONB
 * parameter and are expanded server-side with `jsonb_populate_recordset`, so a
 * save costs one round trip per changed table regardless of row count.
 */
/** Every column named by any row (missing keys become NULL in the recordset). */
function columnsOf(rows: Row[]): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

async function bulkUpsert(db: Db, table: string, rows: Row[], conflict: string[]): Promise<void> {
  if (rows.length === 0) return;
  const columns = columnsOf(rows);
  const quoted = columns.map((c) => `"${c}"`).join(", ");
  const updates = columns
    .filter((c) => !conflict.includes(c) && c !== "created_at")
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");
  const sql =
    `INSERT INTO "${table}" (${quoted}) ` +
    `SELECT ${quoted} FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb) ` +
    `ON CONFLICT (${conflict.map((c) => `"${c}"`).join(", ")}) ` +
    (updates ? `DO UPDATE SET ${updates}` : "DO NOTHING");
  await db.$executeRawUnsafe(sql, JSON.stringify(rows));
}

async function deleteByIds(db: Db, table: string, column: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${column}" = ANY($1::text[])`, ids);
}

/** Column names every row of `table` must carry (NOT NULL timestamps without DB defaults). */
const TIMESTAMPED = new Set([
  "terms",
  "programs",
  "subjects",
  "faculty",
  "sections",
  "rooms",
  "offerings",
  "fixed_blocks",
  "faculty_availability",
  "faculty_qualifications",
  "faculty_preferences",
  "directives",
  "generation_runs",
  "schedules",
]);

/** Write a change set. Must run inside the caller's transaction. */
export async function applyChanges(db: Db, changes: StateChanges): Promise<void> {
  const stamp = now();

  // Children first, so foreign keys never block a delete.
  for (const name of [...ORDER].reverse()) {
    const ids = changes.deletes.get(name);
    if (!ids) continue;
    const col = collection(name);
    if (col.children) await deleteByIds(db, col.children.table, col.children.parentColumn, ids);
    await deleteByIds(db, col.table, "id", ids);
  }

  for (const name of ORDER) {
    const changed = changes.upserts.get(name);
    if (!changed) continue;
    const col = collection(name);
    const rows: Row[] = [];
    const childRows: Row[] = [];
    const parentIds: string[] = [];
    for (const { key, record } of changed) {
      const row = col.toRow(record, key);
      if (TIMESTAMPED.has(col.table)) {
        row.updated_at ??= stamp;
        row.created_at ??= stamp;
      }
      rows.push(row);
      if (col.children) {
        parentIds.push(col.id(record));
        childRows.push(...col.children.rows(record));
      }
    }
    await bulkUpsert(db, col.table, rows, ["id"]);
    if (col.children) {
      // Child lists are replaced wholesale: entries and messages are ordered
      // value lists owned by their parent, not independently edited rows.
      await deleteByIds(db, col.children.table, col.children.parentColumn, parentIds);
      for (let i = 0; i < childRows.length; i += 2000) {
        await bulkInsert(db, col.children.table, childRows.slice(i, i + 2000));
      }
    }
  }
}

async function bulkInsert(db: Db, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const quoted = columnsOf(rows)
    .map((c) => `"${c}"`)
    .join(", ");
  await db.$executeRawUnsafe(
    `INSERT INTO "${table}" (${quoted}) ` +
      `SELECT ${quoted} FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
    JSON.stringify(rows),
  );
}

export interface LoadedState {
  state: MasterDataState;
  /** Fingerprints of what the database holds (excludes defaults added in memory). */
  snapshot: StateSnapshot;
  version: number;
  aliasCounter: number;
}

/** Ensure the single `system_state` row exists and return it. */
export async function readSystemState(db: Db): Promise<{ version: number; aliasCounter: number }> {
  await db.$executeRawUnsafe(
    `INSERT INTO "system_state" ("id", "version", "alias_counter", "updated_at") ` +
      `VALUES (1, 0, 0, now()) ON CONFLICT ("id") DO NOTHING`,
  );
  const row = await db.systemState.findUniqueOrThrow({ where: { id: 1 } });
  return { version: row.version, aliasCounter: row.aliasCounter };
}

/** Load every table into a fresh state. */
export async function loadState(db: Db): Promise<LoadedState> {
  const system = await readSystemState(db);
  const state = createEmptyMasterDataState();
  const defaults = state.terms;
  state.terms = new Map();
  state.aliasCounter = system.aliasCounter;

  await Promise.all(ORDER.map((name) => collection(name).load(db, state)));
  const snapshot = takeSnapshot(state);

  // A brand-new database still gets the default term; it is not in the
  // snapshot, so the first save writes it.
  if (state.terms.size === 0) state.terms = defaults;

  return { state, snapshot, version: system.version, aliasCounter: system.aliasCounter };
}

/**
 * Bump the shared version if nobody else committed since `expectedVersion`.
 * Returns false on a concurrent write (optimistic concurrency).
 */
export async function claimNextVersion(
  db: Db,
  expectedVersion: number,
  aliasCounter: number,
): Promise<boolean> {
  const updated = await db.$executeRawUnsafe(
    `UPDATE "system_state" SET "version" = "version" + 1, "alias_counter" = $1, "updated_at" = now() ` +
      `WHERE "id" = 1 AND "version" = $2`,
    aliasCounter,
    expectedVersion,
  );
  return updated === 1;
}
