import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import {
  facultyAvailabilityInputSchema,
  facultyInputSchema,
  facultyPreferenceInputSchema,
  facultyQualificationInputSchema,
  fixedBlockInputSchema,
  offeringInputSchema,
  programInputSchema,
  roomInputSchema,
  sectionInputSchema,
  subjectInputSchema,
  termInputSchema,
  type FacultyAvailabilityInput,
  type FacultyInput,
  type FacultyPreferenceInput,
  type FacultyQualificationInput,
  type FixedBlockInput,
  type OfferingInput,
  type ProgramInput,
  type RoomInput,
  type SectionInput,
  type SubjectInput,
  type TermInput,
} from "./master-data.schema";
import {
  allocateNextFacultyAlias,
  flagSchedulesForRecheck,
  getMasterDataState,
  type FacultyAvailabilityRecord,
  type FacultyPreferenceRecord,
  type FacultyQualificationRecord,
  type FacultyRecord,
  type FixedBlockRecord,
  type OfferingRecord,
  type ProgramRecord,
  type RoomRecord,
  type SectionRecord,
  type SubjectRecord,
  type TermRecord,
} from "./master-data.store";

export interface ActorContext {
  actor: string;
  ipAddress?: string | null;
}

// ============================================================================
// Terms
// ============================================================================

export function listTerms(): TermRecord[] {
  return Array.from(getMasterDataState().terms.values());
}

export async function upsertTerm(
  raw: TermInput,
  ctx: ActorContext,
): Promise<TermRecord> {
  const input = termInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.terms.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "TERM_UPDATED" : "TERM_CREATED",
      entity: "Term",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: TermRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.terms.set(record.code, record);
      return record;
    },
  );
}

// ============================================================================
// Programs
// ============================================================================

export function listPrograms(): ProgramRecord[] {
  return Array.from(getMasterDataState().programs.values());
}

export async function upsertProgram(
  raw: ProgramInput,
  ctx: ActorContext,
): Promise<ProgramRecord> {
  const input = programInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.programs.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "PROGRAM_UPDATED" : "PROGRAM_CREATED",
      entity: "Program",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: ProgramRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.programs.set(record.code, record);
      return record;
    },
  );
}

export async function deleteProgram(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.programs.get(code);
  if (!existing) {
    throw new AppError("PROGRAM_NOT_FOUND", `Program ${code} not found.`, 404);
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "PROGRAM_DELETED",
      entity: "Program",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.programs.delete(code);
    },
  );
}

// ============================================================================
// Faculty
// ============================================================================

export function listFaculty(): FacultyRecord[] {
  return Array.from(getMasterDataState().faculty.values());
}

export async function upsertFaculty(
  raw: FacultyInput,
  ctx: ActorContext,
): Promise<FacultyRecord> {
  const input = facultyInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.faculty.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "FACULTY_UPDATED" : "FACULTY_CREATED",
      entity: "Faculty",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: FacultyRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        code: input.code,
        alias: existing?.alias ?? allocateNextFacultyAlias(store),
        name: input.name,
        programCode: input.programCode ?? null,
        employmentType: input.employmentType,
        specialization: input.specialization,
        education: input.education,
        maxLoadUnits: input.maxLoadUnits,
        maxLoadHours: input.maxLoadHours,
        status: input.status,
      };
      store.faculty.set(record.code, record);
      flagSchedulesForRecheck();
      return record;
    },
  );
}

export async function deleteFaculty(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.faculty.get(code);
  if (!existing) {
    throw new AppError("FACULTY_NOT_FOUND", `Faculty ${code} not found.`, 404);
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "FACULTY_DELETED",
      entity: "Faculty",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.faculty.delete(code);
      flagSchedulesForRecheck();
    },
  );
}

// ============================================================================
// Subjects
// ============================================================================

export function listSubjects(): SubjectRecord[] {
  return Array.from(getMasterDataState().subjects.values());
}

export async function upsertSubject(
  raw: SubjectInput,
  ctx: ActorContext,
): Promise<SubjectRecord> {
  const input = subjectInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.subjects.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "SUBJECT_UPDATED" : "SUBJECT_CREATED",
      entity: "Subject",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: SubjectRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        code: input.code,
        name: input.name,
        description: input.description,
        programCode: input.programCode ?? null,
        yearLevel: input.yearLevel,
        category: input.category,
        units: input.units,
        contactHours: input.contactHours,
        lectureHours: input.lectureHours,
        labHours: input.labHours,
        curriculumVersion: input.curriculumVersion,
        isCurrentCurriculum: input.isCurrentCurriculum,
      };
      store.subjects.set(record.code, record);
      flagSchedulesForRecheck();
      return record;
    },
  );
}

export async function deleteSubject(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.subjects.get(code);
  if (!existing) {
    throw new AppError("SUBJECT_NOT_FOUND", `Subject ${code} not found.`, 404);
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "SUBJECT_DELETED",
      entity: "Subject",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.subjects.delete(code);
      flagSchedulesForRecheck();
    },
  );
}

// ============================================================================
// Sections
// ============================================================================

export function listSections(): SectionRecord[] {
  return Array.from(getMasterDataState().sections.values());
}

export async function upsertSection(
  raw: SectionInput,
  ctx: ActorContext,
): Promise<SectionRecord> {
  const input = sectionInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.sections.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "SECTION_UPDATED" : "SECTION_CREATED",
      entity: "Section",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: SectionRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.sections.set(record.code, record);
      flagSchedulesForRecheck();
      return record;
    },
  );
}

export async function deleteSection(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.sections.get(code);
  if (!existing) {
    throw new AppError("SECTION_NOT_FOUND", `Section ${code} not found.`, 404);
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "SECTION_DELETED",
      entity: "Section",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.sections.delete(code);
      flagSchedulesForRecheck();
    },
  );
}

// ============================================================================
// Rooms
// ============================================================================

export function listRooms(): RoomRecord[] {
  return Array.from(getMasterDataState().rooms.values());
}

export async function upsertRoom(
  raw: RoomInput,
  ctx: ActorContext,
): Promise<RoomRecord> {
  const input = roomInputSchema.parse(raw);
  const store = getMasterDataState();
  const existing = store.rooms.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "ROOM_UPDATED" : "ROOM_CREATED",
      entity: "Room",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: RoomRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.rooms.set(record.code, record);
      flagSchedulesForRecheck();
      return record;
    },
  );
}

export async function deleteRoom(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.rooms.get(code);
  if (!existing) {
    throw new AppError("ROOM_NOT_FOUND", `Room ${code} not found.`, 404);
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "ROOM_DELETED",
      entity: "Room",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.rooms.delete(code);
      flagSchedulesForRecheck();
    },
  );
}

// ============================================================================
// Offerings & Fixed Blocks
// ============================================================================

export function listOfferings(termCode?: string): OfferingRecord[] {
  const all = Array.from(getMasterDataState().offerings.values());
  return termCode ? all.filter((o) => o.termCode === termCode) : all;
}

export async function upsertOffering(
  raw: OfferingInput,
  ctx: ActorContext,
): Promise<OfferingRecord> {
  const input = offeringInputSchema.parse(raw);
  const store = getMasterDataState();
  if (!store.sections.has(input.sectionCode)) {
    throw new AppError(
      "SECTION_NOT_FOUND",
      `Offering ${input.code} references unknown section ${input.sectionCode}.`,
      400,
    );
  }
  if (!store.subjects.has(input.subjectCode)) {
    throw new AppError(
      "SUBJECT_NOT_FOUND",
      `Offering ${input.code} references unknown subject ${input.subjectCode}.`,
      400,
    );
  }
  const existing = store.offerings.get(input.code);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "OFFERING_UPDATED" : "OFFERING_CREATED",
      entity: "Offering",
      entityId: input.code,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: OfferingRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        code: input.code,
        termCode: input.termCode,
        sectionCode: input.sectionCode,
        subjectCode: input.subjectCode,
        component: input.component,
        meetingsPerWeek: input.meetingsPerWeek,
        minutesPerMeeting: input.minutesPerMeeting,
        meetingPattern: input.meetingPattern,
        requiredRoomType: input.requiredRoomType,
        preassignedFacultyCode: input.preassignedFacultyCode ?? null,
        combinedClassGroup: input.combinedClassGroup ?? null,
      };
      store.offerings.set(record.code, record);
      flagSchedulesForRecheck(record.termCode);
      return record;
    },
  );
}

export async function deleteOffering(
  code: string,
  ctx: ActorContext,
): Promise<void> {
  const store = getMasterDataState();
  const existing = store.offerings.get(code);
  if (!existing) {
    throw new AppError(
      "OFFERING_NOT_FOUND",
      `Offering ${code} not found.`,
      404,
    );
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "OFFERING_DELETED",
      entity: "Offering",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.offerings.delete(code);
      flagSchedulesForRecheck(existing.termCode);
    },
  );
}

export function listFixedBlocks(termCode?: string): FixedBlockRecord[] {
  const all = Array.from(getMasterDataState().fixedBlocks.values());
  return termCode ? all.filter((b) => b.termCode === termCode) : all;
}

export async function upsertFixedBlock(
  raw: FixedBlockInput,
  ctx: ActorContext,
): Promise<FixedBlockRecord> {
  const input = fixedBlockInputSchema.parse(raw);
  const store = getMasterDataState();
  if (!store.sections.has(input.sectionCode)) {
    throw new AppError(
      "SECTION_NOT_FOUND",
      `FixedBlock references unknown section ${input.sectionCode}.`,
      400,
    );
  }
  const key = `${input.termCode}:${input.sectionCode}:${input.weekday}:${input.startMin}`;
  const existing = store.fixedBlocks.get(key);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "FIXED_BLOCK_UPDATED" : "FIXED_BLOCK_CREATED",
      entity: "FixedBlock",
      entityId: key,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: FixedBlockRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.fixedBlocks.set(key, record);
      flagSchedulesForRecheck(record.termCode);
      return record;
    },
  );
}

export async function upsertFacultyAvailability(
  raw: FacultyAvailabilityInput,
  ctx: ActorContext,
): Promise<FacultyAvailabilityRecord> {
  const input = facultyAvailabilityInputSchema.parse(raw);
  const store = getMasterDataState();
  const key = `${input.termCode}:${input.facultyCode}:${input.weekday}:${input.startMin}`;
  const existing = store.facultyAvailability.get(key);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing
        ? "FACULTY_AVAILABILITY_UPDATED"
        : "FACULTY_AVAILABILITY_CREATED",
      entity: "FacultyAvailability",
      entityId: key,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: FacultyAvailabilityRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyAvailability.set(key, record);
      return record;
    },
  );
}

export async function upsertFacultyQualification(
  raw: FacultyQualificationInput,
  ctx: ActorContext,
): Promise<FacultyQualificationRecord> {
  const input = facultyQualificationInputSchema.parse(raw);
  const store = getMasterDataState();
  const key = `${input.facultyCode}:${input.subjectCode}`;
  const existing = store.facultyQualifications.get(key);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing
        ? "FACULTY_QUALIFICATION_UPDATED"
        : "FACULTY_QUALIFICATION_CREATED",
      entity: "FacultyQualification",
      entityId: key,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: FacultyQualificationRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyQualifications.set(key, record);
      return record;
    },
  );
}

export async function upsertFacultyPreference(
  raw: FacultyPreferenceInput,
  ctx: ActorContext,
): Promise<FacultyPreferenceRecord> {
  const input = facultyPreferenceInputSchema.parse(raw);
  const store = getMasterDataState();
  const key = `${input.termCode}:${input.facultyCode}:${input.type}:${input.value}`;
  const existing = store.facultyPreferences.get(key);

  return withAudit(
    {
      actor: ctx.actor,
      action: existing
        ? "FACULTY_PREFERENCE_UPDATED"
        : "FACULTY_PREFERENCE_CREATED",
      entity: "FacultyPreference",
      entityId: key,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: FacultyPreferenceRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyPreferences.set(key, record);
      return record;
    },
  );
}

