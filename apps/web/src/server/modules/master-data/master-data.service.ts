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
  facultyAvailabilityKey,
  facultyPreferenceKey,
  facultyQualificationKey,
  fixedBlockKey,
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

/** Refuse a delete that would orphan dependent records (409). */
function assertNotReferenced(code: string, message: string, referenced: boolean): void {
  if (referenced) {
    throw new AppError(code, message, 409);
  }
}

function removeWhere<T>(map: Map<string, T>, predicate: (record: T) => boolean): void {
  for (const [key, record] of map) {
    if (predicate(record)) map.delete(key);
  }
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
      // HC-11 / HC-13 depend on the term's teaching days, hours and slot size.
      if (
        existing &&
        (existing.dayStartMin !== record.dayStartMin ||
          existing.dayEndMin !== record.dayEndMin ||
          existing.slotSizeMin !== record.slotSizeMin ||
          existing.teachingDays.join() !== record.teachingDays.join())
      ) {
        flagSchedulesForRecheck(record.code);
      }
      return record;
    },
  );
}

/**
 * Delete a term that nothing refers to yet. Terms with offerings, schedules or
 * other records are kept (archive them instead), so history is never lost.
 */
export async function deleteTerm(code: string, ctx: ActorContext): Promise<void> {
  const store = getMasterDataState();
  const existing = store.terms.get(code);
  if (!existing) {
    throw new AppError("TERM_NOT_FOUND", `Term ${code} not found.`, 404);
  }
  const count = <T extends { termCode: string }>(items: Iterable<T>) =>
    [...items].filter((r) => r.termCode === code).length;
  const uses: Array<[string, number]> = [
    ["offerings", count(store.offerings.values())],
    ["schedules", count(store.schedules.values())],
    ["fixed blocks", count(store.fixedBlocks.values())],
    ["availability windows", count(store.facultyAvailability.values())],
    ["preferences", count(store.facultyPreferences.values())],
    ["directives", count(store.directives.values())],
    ["generation runs", count(store.generationRuns.values())],
    ["evaluation sessions", count(store.evaluationSessions.values())],
    ["conversations", count(store.conversations.values())],
    ["learning events", count(store.learningEvents)],
  ];
  const inUse = uses.filter(([, n]) => n > 0);
  if (inUse.length > 0) {
    throw new AppError(
      "TERM_IN_USE",
      `Term ${code} still has ${inUse.map(([label, n]) => `${n} ${label}`).join(", ")}. Set its status to Archived instead.`,
      409,
    );
  }
  await withAudit(
    {
      actor: ctx.actor,
      action: "TERM_DELETED",
      entity: "Term",
      entityId: code,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      store.terms.delete(code);
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
  assertNotReferenced(
    "PROGRAM_IN_USE",
    `Program ${code} still has sections. Move or delete them first.`,
    Array.from(store.sections.values()).some((s) => s.programCode === code),
  );
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
      for (const fac of store.faculty.values()) {
        if (fac.programCode === code) {
          store.faculty.set(fac.code, { ...fac, programCode: null });
        }
      }
      for (const subj of store.subjects.values()) {
        if (subj.programCode === code) {
          store.subjects.set(subj.code, { ...subj, programCode: null });
        }
      }
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
      // Records that only describe this faculty member go with it.
      removeWhere(store.facultyAvailability, (r) => r.facultyCode === code);
      removeWhere(store.facultyQualifications, (r) => r.facultyCode === code);
      removeWhere(store.facultyPreferences, (r) => r.facultyCode === code);
      for (const off of store.offerings.values()) {
        if (off.preassignedFacultyCode === code) {
          store.offerings.set(off.code, { ...off, preassignedFacultyCode: null });
        }
      }
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
  assertNotReferenced(
    "SUBJECT_IN_USE",
    `Subject ${code} still has course offerings. Delete them first.`,
    Array.from(store.offerings.values()).some((o) => o.subjectCode === code),
  );
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
      removeWhere(store.facultyQualifications, (r) => r.subjectCode === code);
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
  assertNotReferenced(
    "SECTION_IN_USE",
    `Section ${code} still has course offerings. Delete them first.`,
    Array.from(store.offerings.values()).some((o) => o.sectionCode === code),
  );
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
      removeWhere(store.fixedBlocks, (r) => r.sectionCode === code);
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

/** Edit options for records identified by a natural key instead of a code. */
export interface KeyedUpsertOptions {
  /**
   * Id of the record being edited. When the edit changes its key (for example
   * the day or start time), the old entry is replaced instead of duplicated.
   */
  replaceId?: string;
}

/** Find the record being replaced (by id) and the record already at the new key. */
function resolveKeyed<T extends { id: string }>(
  map: Map<string, T>,
  key: string,
  replaceId: string | undefined,
): { previousKey: string | null; existing: T | null } {
  let previousKey: string | null = null;
  let previous: T | null = null;
  if (replaceId) {
    for (const [k, record] of map) {
      if (record.id === replaceId) {
        previousKey = k;
        previous = record;
        break;
      }
    }
    if (!previous) {
      throw new AppError("RECORD_NOT_FOUND", "The record being edited no longer exists.", 404);
    }
  }
  const atKey = map.get(key) ?? null;
  if (atKey && previous && atKey.id !== previous.id) {
    throw new AppError(
      "DUPLICATE_RECORD",
      "Another record already uses this combination. Edit or delete that one instead.",
      409,
    );
  }
  return { previousKey, existing: atKey ?? previous };
}

function deleteById<T extends { id: string }>(map: Map<string, T>, id: string): void {
  for (const [key, record] of map) {
    if (record.id === id) {
      map.delete(key);
      return;
    }
  }
}

function requireFaculty(code: string): void {
  if (!getMasterDataState().faculty.has(code)) {
    throw new AppError("FACULTY_NOT_FOUND", `Faculty ${code} not found.`, 400);
  }
}

function requireTerm(code: string): void {
  if (!getMasterDataState().terms.has(code)) {
    throw new AppError("TERM_NOT_FOUND", `Term ${code} not found.`, 400);
  }
}

export async function upsertFixedBlock(
  raw: FixedBlockInput,
  ctx: ActorContext,
  options: KeyedUpsertOptions = {},
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
  requireTerm(input.termCode);
  const key = fixedBlockKey(input);
  const { previousKey, existing } = resolveKeyed(store.fixedBlocks, key, options.replaceId);

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
      if (previousKey && previousKey !== key) store.fixedBlocks.delete(previousKey);
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

export async function deleteFixedBlock(id: string, ctx: ActorContext): Promise<void> {
  const store = getMasterDataState();
  const record = [...store.fixedBlocks.values()].find((r) => r.id === id);
  if (!record) throw new AppError("FIXED_BLOCK_NOT_FOUND", "Fixed block not found.", 404);
  await withAudit(
    {
      actor: ctx.actor,
      action: "FIXED_BLOCK_DELETED",
      entity: "FixedBlock",
      entityId: fixedBlockKey(record),
      before: record,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      deleteById(store.fixedBlocks, id);
      flagSchedulesForRecheck(record.termCode);
    },
  );
}

// ============================================================================
// Faculty availability, qualifications and preferences
// ============================================================================

export function listFacultyAvailability(filter: {
  facultyCode?: string;
  termCode?: string;
}): FacultyAvailabilityRecord[] {
  return Array.from(getMasterDataState().facultyAvailability.values()).filter(
    (r) =>
      (!filter.facultyCode || r.facultyCode === filter.facultyCode) &&
      (!filter.termCode || r.termCode === filter.termCode),
  );
}

export async function upsertFacultyAvailability(
  raw: FacultyAvailabilityInput,
  ctx: ActorContext,
  options: KeyedUpsertOptions = {},
): Promise<FacultyAvailabilityRecord> {
  const input = facultyAvailabilityInputSchema.parse(raw);
  requireFaculty(input.facultyCode);
  requireTerm(input.termCode);
  const store = getMasterDataState();
  const key = facultyAvailabilityKey(input);
  const { previousKey, existing } = resolveKeyed(store.facultyAvailability, key, options.replaceId);

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
      if (previousKey && previousKey !== key) store.facultyAvailability.delete(previousKey);
      const record: FacultyAvailabilityRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyAvailability.set(key, record);
      // HC-06 depends on availability.
      flagSchedulesForRecheck(record.termCode);
      return record;
    },
  );
}

export async function deleteFacultyAvailability(id: string, ctx: ActorContext): Promise<void> {
  const store = getMasterDataState();
  const record = [...store.facultyAvailability.values()].find((r) => r.id === id);
  if (!record) throw new AppError("AVAILABILITY_NOT_FOUND", "Availability window not found.", 404);
  await withAudit(
    {
      actor: ctx.actor,
      action: "FACULTY_AVAILABILITY_DELETED",
      entity: "FacultyAvailability",
      entityId: facultyAvailabilityKey(record),
      before: record,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      deleteById(store.facultyAvailability, id);
      flagSchedulesForRecheck(record.termCode);
    },
  );
}

export function listFacultyQualifications(filter: {
  facultyCode?: string;
}): FacultyQualificationRecord[] {
  return Array.from(getMasterDataState().facultyQualifications.values()).filter(
    (r) => !filter.facultyCode || r.facultyCode === filter.facultyCode,
  );
}

export async function upsertFacultyQualification(
  raw: FacultyQualificationInput,
  ctx: ActorContext,
  options: KeyedUpsertOptions = {},
): Promise<FacultyQualificationRecord> {
  const input = facultyQualificationInputSchema.parse(raw);
  requireFaculty(input.facultyCode);
  const store = getMasterDataState();
  if (!store.subjects.has(input.subjectCode)) {
    throw new AppError("SUBJECT_NOT_FOUND", `Subject ${input.subjectCode} not found.`, 400);
  }
  const key = facultyQualificationKey(input);
  const { previousKey, existing } = resolveKeyed(
    store.facultyQualifications,
    key,
    options.replaceId,
  );

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
      if (previousKey && previousKey !== key) store.facultyQualifications.delete(previousKey);
      const record: FacultyQualificationRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyQualifications.set(key, record);
      // HC-09 depends on qualifications.
      flagSchedulesForRecheck();
      return record;
    },
  );
}

export async function deleteFacultyQualification(id: string, ctx: ActorContext): Promise<void> {
  const store = getMasterDataState();
  const record = [...store.facultyQualifications.values()].find((r) => r.id === id);
  if (!record) throw new AppError("QUALIFICATION_NOT_FOUND", "Qualification not found.", 404);
  await withAudit(
    {
      actor: ctx.actor,
      action: "FACULTY_QUALIFICATION_DELETED",
      entity: "FacultyQualification",
      entityId: facultyQualificationKey(record),
      before: record,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      deleteById(store.facultyQualifications, id);
      flagSchedulesForRecheck();
    },
  );
}

export function listFacultyPreferences(filter: {
  facultyCode?: string;
  termCode?: string;
}): FacultyPreferenceRecord[] {
  return Array.from(getMasterDataState().facultyPreferences.values()).filter(
    (r) =>
      (!filter.facultyCode || r.facultyCode === filter.facultyCode) &&
      (!filter.termCode || r.termCode === filter.termCode),
  );
}

export async function upsertFacultyPreference(
  raw: FacultyPreferenceInput,
  ctx: ActorContext,
  options: KeyedUpsertOptions = {},
): Promise<FacultyPreferenceRecord> {
  const input = facultyPreferenceInputSchema.parse(raw);
  requireFaculty(input.facultyCode);
  requireTerm(input.termCode);
  const store = getMasterDataState();
  const key = facultyPreferenceKey(input);
  const { previousKey, existing } = resolveKeyed(store.facultyPreferences, key, options.replaceId);

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
      if (previousKey && previousKey !== key) store.facultyPreferences.delete(previousKey);
      const record: FacultyPreferenceRecord = {
        id: existing?.id ?? crypto.randomUUID(),
        ...input,
      };
      store.facultyPreferences.set(key, record);
      return record;
    },
  );
}

export async function deleteFacultyPreference(id: string, ctx: ActorContext): Promise<void> {
  const store = getMasterDataState();
  const record = [...store.facultyPreferences.values()].find((r) => r.id === id);
  if (!record) throw new AppError("PREFERENCE_NOT_FOUND", "Preference not found.", 404);
  await withAudit(
    {
      actor: ctx.actor,
      action: "FACULTY_PREFERENCE_DELETED",
      entity: "FacultyPreference",
      entityId: facultyPreferenceKey(record),
      before: record,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      deleteById(store.facultyPreferences, id);
    },
  );
}
