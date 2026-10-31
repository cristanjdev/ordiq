import ExcelJS from "exceljs";
import { withAudit } from "../../platform/audit";
import { sha256Hex } from "../../platform/crypto";
import type { PastScheduleRowInput } from "../fixtures/fixture.generator";
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
  weekdaySchema,
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
} from "../master-data/master-data.schema";
import {
  upsertFaculty,
  upsertFacultyAvailability,
  upsertFacultyPreference,
  upsertFacultyQualification,
  upsertFixedBlock,
  upsertOffering,
  upsertProgram,
  upsertRoom,
  upsertSection,
  upsertSubject,
  type ActorContext,
} from "../master-data/master-data.service";
import {
  getMasterDataState,
  type ImportBatchRecord,
  type ScheduleEntryRecord,
  type ScheduleRecord,
} from "../master-data/master-data.store";

export interface WorkbookRowError {
  sheet: string;
  row: number;
  column: string;
  message: string;
}

export type SheetRowObject = object;

export interface WorkbookSheetsPayload {
  termCode: string;
  programs?: SheetRowObject[];
  faculty?: SheetRowObject[];
  subjects?: SheetRowObject[];
  sections?: SheetRowObject[];
  rooms?: SheetRowObject[];
  offerings?: SheetRowObject[];
  fixedBlocks?: SheetRowObject[];
  facultyAvailability?: SheetRowObject[];
  facultyQualifications?: SheetRowObject[];
  facultyPreferences?: SheetRowObject[];
  pastSchedule?: SheetRowObject[];
}

export interface ImportSummary {
  batchId: string;
  fileHash: string;
  dryRun: boolean;
  alreadyCommitted: boolean;
  status: "DRY_RUN" | "COMMITTED" | "FAILED";
  rowCount: number;
  countsBySheet: Record<string, number>;
  errors: WorkbookRowError[];
}

interface ValidatedWorkbookData {
  termCode: string;
  programs: ProgramInput[];
  faculty: FacultyInput[];
  subjects: SubjectInput[];
  sections: SectionInput[];
  rooms: RoomInput[];
  offerings: OfferingInput[];
  fixedBlocks: FixedBlockInput[];
  facultyAvailability: FacultyAvailabilityInput[];
  facultyQualifications: FacultyQualificationInput[];
  facultyPreferences: FacultyPreferenceInput[];
  pastSchedule: PastScheduleRowInput[];
}

function asRecordArray(items?: SheetRowObject[]): Record<string, unknown>[] {
  return (items ?? []) as Record<string, unknown>[];
}

export function validateWorkbookPayload(payload: WorkbookSheetsPayload): {
  valid: ValidatedWorkbookData;
  errors: WorkbookRowError[];
  rowCount: number;
  countsBySheet: Record<string, number>;
} {
  const errors: WorkbookRowError[] = [];
  const store = getMasterDataState();

  const knownPrograms = new Set<string>(store.programs.keys());
  const knownFaculty = new Set<string>(store.faculty.keys());
  const knownSubjects = new Set<string>(store.subjects.keys());
  const knownSections = new Set<string>(store.sections.keys());
  const knownRooms = new Set<string>(store.rooms.keys());
  const knownOfferings = new Set<string>(store.offerings.keys());

  const programs: ProgramInput[] = [];
  asRecordArray(payload.programs).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = programInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Programs",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    programs.push(parsed.data);
    knownPrograms.add(parsed.data.code);
  });

  const faculty: FacultyInput[] = [];
  asRecordArray(payload.faculty).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = facultyInputSchema.safeParse({
      ...raw,
      maxLoadUnits:
        raw.maxLoadUnits !== undefined ? Number(raw.maxLoadUnits) : 21,
      maxLoadHours:
        raw.maxLoadHours !== undefined ? Number(raw.maxLoadHours) : 24,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Faculty",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (
      parsed.data.programCode &&
      !knownPrograms.has(parsed.data.programCode)
    ) {
      errors.push({
        sheet: "Faculty",
        row: rowNum,
        column: "programCode",
        message: `Faculty ${parsed.data.code} references unknown program "${parsed.data.programCode}".`,
      });
      return;
    }
    faculty.push(parsed.data);
    knownFaculty.add(parsed.data.code);
  });

  const subjects: SubjectInput[] = [];
  asRecordArray(payload.subjects).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = subjectInputSchema.safeParse({
      ...raw,
      yearLevel: Number(raw.yearLevel),
      units: Number(raw.units),
      contactHours: Number(raw.contactHours),
      lectureHours:
        raw.lectureHours !== undefined ? Number(raw.lectureHours) : 3,
      labHours: raw.labHours !== undefined ? Number(raw.labHours) : 0,
      isCurrentCurriculum:
        raw.isCurrentCurriculum === undefined
          ? true
          : Boolean(raw.isCurrentCurriculum),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Subjects",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (
      parsed.data.programCode &&
      !knownPrograms.has(parsed.data.programCode)
    ) {
      errors.push({
        sheet: "Subjects",
        row: rowNum,
        column: "programCode",
        message: `Subject ${parsed.data.code} references unknown program "${parsed.data.programCode}".`,
      });
      return;
    }
    subjects.push(parsed.data);
    knownSubjects.add(parsed.data.code);
  });

  const sections: SectionInput[] = [];
  asRecordArray(payload.sections).forEach((raw, idx) => {
    const rowNum = idx + 2;
    if ("studentId" in raw || "studentName" in raw) {
      errors.push({
        sheet: "Sections",
        row: rowNum,
        column: "studentId",
        message:
          "Individual student records are forbidden (D-21). Provide section-level studentCount only.",
      });
      return;
    }
    const parsed = sectionInputSchema.safeParse({
      ...raw,
      yearLevel: Number(raw.yearLevel),
      studentCount: Number(raw.studentCount),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Sections",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownPrograms.has(parsed.data.programCode)) {
      errors.push({
        sheet: "Sections",
        row: rowNum,
        column: "programCode",
        message: `Section ${parsed.data.code} references unknown program "${parsed.data.programCode}".`,
      });
      return;
    }
    sections.push(parsed.data);
    knownSections.add(parsed.data.code);
  });

  const rooms: RoomInput[] = [];
  asRecordArray(payload.rooms).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const equipment = Array.isArray(raw.equipment)
      ? raw.equipment.map(String)
      : typeof raw.equipment === "string" && raw.equipment.trim().length > 0
        ? raw.equipment.split(",").map((s) => s.trim())
        : [];
    const parsed = roomInputSchema.safeParse({
      ...raw,
      capacity: Number(raw.capacity),
      equipment,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Rooms",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    rooms.push(parsed.data);
    knownRooms.add(parsed.data.code);
  });

  const offerings: OfferingInput[] = [];
  asRecordArray(payload.offerings).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = offeringInputSchema.safeParse({
      ...raw,
      termCode: (raw.termCode as string | undefined) ?? payload.termCode,
      meetingsPerWeek:
        raw.meetingsPerWeek !== undefined ? Number(raw.meetingsPerWeek) : 2,
      minutesPerMeeting:
        raw.minutesPerMeeting !== undefined
          ? Number(raw.minutesPerMeeting)
          : 90,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "Offerings",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownSections.has(parsed.data.sectionCode)) {
      errors.push({
        sheet: "Offerings",
        row: rowNum,
        column: "sectionCode",
        message: `Offering ${parsed.data.code} references unknown section "${parsed.data.sectionCode}".`,
      });
      return;
    }
    if (!knownSubjects.has(parsed.data.subjectCode)) {
      errors.push({
        sheet: "Offerings",
        row: rowNum,
        column: "subjectCode",
        message: `Offering ${parsed.data.code} references unknown subject "${parsed.data.subjectCode}".`,
      });
      return;
    }
    if (
      parsed.data.preassignedFacultyCode &&
      !knownFaculty.has(parsed.data.preassignedFacultyCode)
    ) {
      errors.push({
        sheet: "Offerings",
        row: rowNum,
        column: "preassignedFacultyCode",
        message: `Offering ${parsed.data.code} references unknown faculty "${parsed.data.preassignedFacultyCode}".`,
      });
      return;
    }
    offerings.push(parsed.data);
    knownOfferings.add(parsed.data.code);
  });

  const fixedBlocks: FixedBlockInput[] = [];
  asRecordArray(payload.fixedBlocks).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = fixedBlockInputSchema.safeParse({
      ...raw,
      termCode: (raw.termCode as string | undefined) ?? payload.termCode,
      startMin: Number(raw.startMin),
      endMin: Number(raw.endMin),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "FixedBlocks",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownSections.has(parsed.data.sectionCode)) {
      errors.push({
        sheet: "FixedBlocks",
        row: rowNum,
        column: "sectionCode",
        message: `FixedBlock references unknown section "${parsed.data.sectionCode}".`,
      });
      return;
    }
    fixedBlocks.push(parsed.data);
  });

  const facultyAvailability: FacultyAvailabilityInput[] = [];
  asRecordArray(payload.facultyAvailability).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = facultyAvailabilityInputSchema.safeParse({
      ...raw,
      termCode: (raw.termCode as string | undefined) ?? payload.termCode,
      startMin: Number(raw.startMin),
      endMin: Number(raw.endMin),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "FacultyAvailability",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownFaculty.has(parsed.data.facultyCode)) {
      errors.push({
        sheet: "FacultyAvailability",
        row: rowNum,
        column: "facultyCode",
        message: `FacultyAvailability references unknown faculty "${parsed.data.facultyCode}".`,
      });
      return;
    }
    facultyAvailability.push(parsed.data);
  });

  const facultyQualifications: FacultyQualificationInput[] = [];
  asRecordArray(payload.facultyQualifications).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = facultyQualificationInputSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "FacultyQualifications",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownFaculty.has(parsed.data.facultyCode)) {
      errors.push({
        sheet: "FacultyQualifications",
        row: rowNum,
        column: "facultyCode",
        message: `FacultyQualification references unknown faculty "${parsed.data.facultyCode}".`,
      });
      return;
    }
    if (!knownSubjects.has(parsed.data.subjectCode)) {
      errors.push({
        sheet: "FacultyQualifications",
        row: rowNum,
        column: "subjectCode",
        message: `FacultyQualification references unknown subject "${parsed.data.subjectCode}".`,
      });
      return;
    }
    facultyQualifications.push(parsed.data);
  });

  const facultyPreferences: FacultyPreferenceInput[] = [];
  asRecordArray(payload.facultyPreferences).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const parsed = facultyPreferenceInputSchema.safeParse({
      ...raw,
      termCode: (raw.termCode as string | undefined) ?? payload.termCode,
      weight: raw.weight !== undefined ? Number(raw.weight) : 1.0,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          sheet: "FacultyPreferences",
          row: rowNum,
          column: issue.path.join(".") || "row",
          message: issue.message,
        });
      }
      return;
    }
    if (!knownFaculty.has(parsed.data.facultyCode)) {
      errors.push({
        sheet: "FacultyPreferences",
        row: rowNum,
        column: "facultyCode",
        message: `FacultyPreference references unknown faculty "${parsed.data.facultyCode}".`,
      });
      return;
    }
    facultyPreferences.push(parsed.data);
  });

  const pastSchedule: PastScheduleRowInput[] = [];
  asRecordArray(payload.pastSchedule).forEach((raw, idx) => {
    const rowNum = idx + 2;
    const offeringCode = String(raw.offeringCode ?? "").trim();
    const facultyCode = String(raw.facultyCode ?? "").trim();
    const roomCode = String(raw.roomCode ?? "").trim();
    const dayParsed = weekdaySchema.safeParse(raw.weekday);
    const startMin = Number(raw.startMin);
    const endMin = Number(raw.endMin);

    if (!offeringCode || !knownOfferings.has(offeringCode)) {
      errors.push({
        sheet: "PastSchedule",
        row: rowNum,
        column: "offeringCode",
        message: `PastSchedule row references unknown offering "${offeringCode}".`,
      });
    }
    if (!facultyCode || !knownFaculty.has(facultyCode)) {
      errors.push({
        sheet: "PastSchedule",
        row: rowNum,
        column: "facultyCode",
        message: `PastSchedule row references unknown faculty "${facultyCode}".`,
      });
    }
    if (!roomCode || !knownRooms.has(roomCode)) {
      errors.push({
        sheet: "PastSchedule",
        row: rowNum,
        column: "roomCode",
        message: `PastSchedule row references unknown room "${roomCode}".`,
      });
    }
    if (!dayParsed.success) {
      errors.push({
        sheet: "PastSchedule",
        row: rowNum,
        column: "weekday",
        message: `Invalid weekday "${String(raw.weekday)}".`,
      });
    }
    if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || endMin <= startMin) {
      errors.push({
        sheet: "PastSchedule",
        row: rowNum,
        column: "endMin",
        message: "startMin and endMin must be integer minutes with endMin > startMin.",
      });
    }

    if (
      offeringCode &&
      knownOfferings.has(offeringCode) &&
      facultyCode &&
      knownFaculty.has(facultyCode) &&
      roomCode &&
      knownRooms.has(roomCode) &&
      dayParsed.success &&
      Number.isInteger(startMin) &&
      Number.isInteger(endMin) &&
      endMin > startMin
    ) {
      pastSchedule.push({
        offeringCode,
        facultyCode,
        roomCode,
        weekday: dayParsed.data,
        startMin,
        endMin,
      });
    }
  });

  const countsBySheet: Record<string, number> = {
    Programs: programs.length,
    Faculty: faculty.length,
    Subjects: subjects.length,
    Sections: sections.length,
    Rooms: rooms.length,
    Offerings: offerings.length,
    FixedBlocks: fixedBlocks.length,
    FacultyAvailability: facultyAvailability.length,
    FacultyQualifications: facultyQualifications.length,
    FacultyPreferences: facultyPreferences.length,
    PastSchedule: pastSchedule.length,
  };

  const rowCount = Object.values(countsBySheet).reduce((a, b) => a + b, 0);

  return {
    valid: {
      termCode: payload.termCode,
      programs,
      faculty,
      subjects,
      sections,
      rooms,
      offerings,
      fixedBlocks,
      facultyAvailability,
      facultyQualifications,
      facultyPreferences,
      pastSchedule,
    },
    errors,
    rowCount,
    countsBySheet,
  };
}

/**
 * Executes workbook validation, dry-run preview, or atomic idempotent commit.
 * If ANY error exists on any sheet, row, or cross-reference, writes NOTHING.
 */
export async function importWorkbookPayload(
  payload: WorkbookSheetsPayload,
  options: {
    dryRun?: boolean;
    actor: string;
    ipAddress?: string | null;
  },
): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const serialized = JSON.stringify(payload);
  const fileHash = sha256Hex(serialized);
  const store = getMasterDataState();

  // Check idempotency if already committed with identical fileHash
  if (!dryRun) {
    for (const batch of store.importBatches.values()) {
      if (batch.fileHash === fileHash && batch.status === "COMMITTED") {
        return {
          batchId: batch.id,
          fileHash,
          dryRun: false,
          alreadyCommitted: true,
          status: "COMMITTED",
          rowCount: batch.rowCount,
          countsBySheet: {},
          errors: [],
        };
      }
    }
  }

  const { valid, errors, rowCount, countsBySheet } =
    validateWorkbookPayload(payload);

  const batchId = crypto.randomUUID();

  if (errors.length > 0) {
    const failedBatch: ImportBatchRecord = {
      id: batchId,
      termCode: payload.termCode,
      dataset: "WORKBOOK",
      fileHash,
      status: "FAILED",
      rowCount,
      insertedCount: 0,
      updatedCount: 0,
      errors,
      createdAt: new Date().toISOString(),
    };
    store.importBatches.set(batchId, failedBatch);
    return {
      batchId,
      fileHash,
      dryRun,
      alreadyCommitted: false,
      status: "FAILED",
      rowCount,
      countsBySheet,
      errors,
    };
  }

  if (dryRun) {
    return {
      batchId,
      fileHash,
      dryRun: true,
      alreadyCommitted: false,
      status: "DRY_RUN",
      rowCount,
      countsBySheet,
      errors: [],
    };
  }

  // Atomic commit: all validations passed
  const ctx: ActorContext = {
    actor: options.actor,
    ipAddress: options.ipAddress ?? null,
  };

  for (const p of valid.programs) {
    await upsertProgram(p, ctx);
  }
  for (const f of valid.faculty) {
    await upsertFaculty(f, ctx);
  }
  for (const s of valid.subjects) {
    await upsertSubject(s, ctx);
  }
  for (const sec of valid.sections) {
    await upsertSection(sec, ctx);
  }
  for (const r of valid.rooms) {
    await upsertRoom(r, ctx);
  }
  for (const q of valid.facultyQualifications) {
    await upsertFacultyQualification(q, ctx);
  }
  for (const a of valid.facultyAvailability) {
    await upsertFacultyAvailability(a, ctx);
  }
  for (const pref of valid.facultyPreferences) {
    await upsertFacultyPreference(pref, ctx);
  }
  for (const off of valid.offerings) {
    await upsertOffering(off, ctx);
  }
  for (const fb of valid.fixedBlocks) {
    await upsertFixedBlock(fb, ctx);
  }

  if (valid.pastSchedule.length > 0) {
    const entries: ScheduleEntryRecord[] = valid.pastSchedule.map((row) => ({
      id: crypto.randomUUID(),
      offeringCode: row.offeringCode,
      facultyCode: row.facultyCode,
      roomCode: row.roomCode,
      weekday: row.weekday,
      startMin: row.startMin,
      endMin: row.endMin,
      pinned: true,
    }));
    const importedSchedule: ScheduleRecord = {
      id: crypto.randomUUID(),
      termCode: valid.termCode,
      candidateLabel: `Imported Manual Baseline (${valid.termCode})`,
      status: "CANDIDATE",
      source: "IMPORTED",
      recheckNeeded: false,
      version: 1,
      qualityScore: null,
      entries,
    };
    store.schedules.set(importedSchedule.id, importedSchedule);
  }

  const committedBatch: ImportBatchRecord = {
    id: batchId,
    termCode: payload.termCode,
    dataset: "WORKBOOK",
    fileHash,
    status: "COMMITTED",
    rowCount,
    insertedCount: rowCount,
    updatedCount: 0,
    errors: [],
    createdAt: new Date().toISOString(),
  };
  store.importBatches.set(batchId, committedBatch);

  await withAudit(
    {
      actor: options.actor,
      action: "WORKBOOK_IMPORT_COMMITTED",
      entity: "ImportBatch",
      entityId: batchId,
      ipAddress: options.ipAddress ?? null,
    },
    async () => ({
      batchId,
      fileHash,
      rowCount,
      countsBySheet,
    }),
  );

  return {
    batchId,
    fileHash,
    dryRun: false,
    alreadyCommitted: false,
    status: "COMMITTED",
    rowCount,
    countsBySheet,
    errors: [],
  };
}

/**
 * Generates an Excel (.xlsx) workbook buffer from a WorkbookSheetsPayload.
 */
export async function buildWorkbookBuffer(
  payload: WorkbookSheetsPayload,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ORDIQ Scheduling System";
  wb.created = new Date();

  const sheetDefs: Array<{
    name: string;
    columns: string[];
    rows: Record<string, unknown>[];
  }> = [
    {
      name: "Programs",
      columns: ["code", "name", "coordinator"],
      rows: asRecordArray(payload.programs),
    },
    {
      name: "Faculty",
      columns: [
        "code",
        "name",
        "programCode",
        "employmentType",
        "specialization",
        "education",
        "maxLoadUnits",
        "maxLoadHours",
        "status",
      ],
      rows: asRecordArray(payload.faculty),
    },
    {
      name: "Subjects",
      columns: [
        "code",
        "name",
        "description",
        "programCode",
        "yearLevel",
        "category",
        "units",
        "contactHours",
        "lectureHours",
        "labHours",
        "curriculumVersion",
        "isCurrentCurriculum",
      ],
      rows: asRecordArray(payload.subjects),
    },
    {
      name: "Sections",
      columns: ["code", "programCode", "yearLevel", "studentCount"],
      rows: asRecordArray(payload.sections),
    },
    {
      name: "Rooms",
      columns: [
        "code",
        "name",
        "type",
        "capacity",
        "equipment",
        "restrictions",
        "status",
      ],
      rows: asRecordArray(payload.rooms),
    },
    {
      name: "Offerings",
      columns: [
        "code",
        "termCode",
        "sectionCode",
        "subjectCode",
        "component",
        "meetingsPerWeek",
        "minutesPerMeeting",
        "meetingPattern",
        "requiredRoomType",
        "preassignedFacultyCode",
        "combinedClassGroup",
      ],
      rows: asRecordArray(payload.offerings),
    },
    {
      name: "FixedBlocks",
      columns: [
        "termCode",
        "sectionCode",
        "weekday",
        "startMin",
        "endMin",
        "label",
        "location",
      ],
      rows: asRecordArray(payload.fixedBlocks),
    },
    {
      name: "FacultyAvailability",
      columns: [
        "facultyCode",
        "termCode",
        "weekday",
        "startMin",
        "endMin",
        "status",
        "reason",
      ],
      rows: asRecordArray(payload.facultyAvailability),
    },
    {
      name: "FacultyQualifications",
      columns: ["facultyCode", "subjectCode", "source"],
      rows: asRecordArray(payload.facultyQualifications),
    },
    {
      name: "FacultyPreferences",
      columns: [
        "facultyCode",
        "termCode",
        "type",
        "value",
        "weight",
        "source",
      ],
      rows: asRecordArray(payload.facultyPreferences),
    },
    {
      name: "PastSchedule",
      columns: [
        "offeringCode",
        "facultyCode",
        "roomCode",
        "weekday",
        "startMin",
        "endMin",
      ],
      rows: asRecordArray(payload.pastSchedule),
    },
  ];

  for (const def of sheetDefs) {
    const ws = wb.addWorksheet(def.name);
    ws.columns = def.columns.map((col) => ({
      header: col,
      key: col,
      width: 22,
    }));
    for (const r of def.rows) {
      const normalizedRow: Record<string, unknown> = {};
      for (const col of def.columns) {
        const val = r[col];
        normalizedRow[col] = Array.isArray(val) ? val.join(", ") : (val ?? "");
      }
      ws.addRow(normalizedRow);
    }
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Parses an Excel (.xlsx) buffer into a WorkbookSheetsPayload.
 */
export async function parseWorkbookBuffer(
  buffer: Buffer,
  termCode = "AY2026-2027-S1",
): Promise<WorkbookSheetsPayload> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  function readSheet(sheetName: string): Record<string, unknown>[] {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return [];
    const headers: string[] = [];
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? "").trim();
    });

    const rows: Record<string, unknown>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((h, colNumber) => {
        if (!h) return;
        const rawVal = row.getCell(colNumber).value;
        if (rawVal !== null && rawVal !== undefined && rawVal !== "") {
          hasValue = true;
          obj[h] = rawVal;
        }
      });
      if (hasValue) {
        rows.push(obj);
      }
    });
    return rows;
  }

  return {
    termCode,
    programs: readSheet("Programs"),
    faculty: readSheet("Faculty"),
    subjects: readSheet("Subjects"),
    sections: readSheet("Sections"),
    rooms: readSheet("Rooms"),
    offerings: readSheet("Offerings"),
    fixedBlocks: readSheet("FixedBlocks"),
    facultyAvailability: readSheet("FacultyAvailability"),
    facultyQualifications: readSheet("FacultyQualifications"),
    facultyPreferences: readSheet("FacultyPreferences"),
    pastSchedule: readSheet("PastSchedule"),
  };
}

