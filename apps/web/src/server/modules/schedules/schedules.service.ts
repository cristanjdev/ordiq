import {
  NON_WAIVABLE_HARD_CONSTRAINTS,
  type EngineAlternativesResponse,
  type EngineValidationResponse,
  type HardConstraintCode,
  type Weekday,
} from "@ordiq/contracts";
import { createEngineClient, type EngineClient } from "../../engine/engine.client";
import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import {
  buildProblemSnapshot,
  checkExistingSchedule,
  toEngineEntries,
} from "../generation/generation.service";
import {
  getMasterDataState,
  type ScheduleChangeRecord,
  type ScheduleEntryRecord,
  type ScheduleExceptionRecord,
  type ScheduleRecord,
} from "../master-data/master-data.store";
import {
  recordLearningEvent,
  trainAndEvaluateFitModel,
} from "../ml/ml.service";

export interface EditScheduleEntryInput {
  scheduleId: string;
  entryId: string;
  expectedVersion: number;
  facultyCode?: string;
  roomCode?: string;
  weekday?: Weekday;
  startMin?: number;
  endMin?: number;
  pinned?: boolean;
  actor: string;
  engineClient?: EngineClient;
}

export interface AddExceptionInput {
  scheduleId: string;
  code: HardConstraintCode;
  offeringCode?: string | null;
  facultyCode?: string | null;
  roomCode?: string | null;
  sectionCode?: string | null;
  reason: string;
  actor: string;
  engineClient?: EngineClient;
}

/**
 * Edits or drags-and-drops a schedule entry with optimistic locking (`expectedVersion`),
 * records the before/after in `ScheduleChange`, increments `version`, and immediately
 * re-validates the candidate through the Python validator (`POST /v1/validate`).
 */
export async function editScheduleEntry(
  input: EditScheduleEntryInput,
): Promise<{
  schedule: ScheduleRecord;
  validation: EngineValidationResponse;
}> {
  const store = getMasterDataState();
  const sched = store.schedules.get(input.scheduleId);
  if (!sched) {
    throw new AppError(
      "SCHEDULE_NOT_FOUND",
      `Schedule "${input.scheduleId}" not found.`,
      404,
    );
  }

  if (sched.status === "ACCEPTED" || sched.status === "ARCHIVED") {
    throw new AppError(
      "SCHEDULE_IMMUTABLE",
      `Schedule "${sched.id}" is ${sched.status}. Start a revision instead of editing in place.`,
      409,
    );
  }

  // Optimistic locking check (Exit Criterion 5: Two tabs editing the same candidate cannot silently overwrite)
  if (sched.version !== input.expectedVersion) {
    throw new AppError(
      "SCHEDULE_VERSION_CONFLICT",
      `Optimistic lock conflict on schedule "${sched.id}": expected version ${input.expectedVersion}, but current version is ${sched.version}.`,
      409,
      { expectedVersion: input.expectedVersion, actualVersion: sched.version },
    );
  }

  const entryIndex = sched.entries.findIndex((e) => e.id === input.entryId);
  if (entryIndex === -1) {
    throw new AppError(
      "ENTRY_NOT_FOUND",
      `Entry "${input.entryId}" not found in schedule "${sched.id}".`,
      404,
    );
  }

  const beforeEntry = sched.entries[entryIndex];
  if (!beforeEntry) {
    throw new AppError(
      "ENTRY_NOT_FOUND",
      `Entry "${input.entryId}" not found in schedule "${sched.id}".`,
      404,
    );
  }
  const afterEntry: ScheduleEntryRecord = {
    ...beforeEntry,
    facultyCode: input.facultyCode ?? beforeEntry.facultyCode,
    roomCode: input.roomCode ?? beforeEntry.roomCode,
    weekday: input.weekday ?? beforeEntry.weekday,
    startMin: input.startMin ?? beforeEntry.startMin,
    endMin: input.endMin ?? beforeEntry.endMin,
    pinned: input.pinned ?? beforeEntry.pinned,
  };

  const nextEntries = [...sched.entries];
  nextEntries[entryIndex] = afterEntry;

  const changeRecord: ScheduleChangeRecord = {
    id: crypto.randomUUID(),
    scheduleId: sched.id,
    actor: input.actor,
    action: "ENTRY_EDITED",
    beforeJson: beforeEntry,
    afterJson: afterEntry,
    createdAt: new Date().toISOString(),
  };

  const nextChanges = [...(sched.changes ?? []), changeRecord];
  const updatedDraft: ScheduleRecord = {
    ...sched,
    version: sched.version + 1,
    entries: nextEntries,
    changes: nextChanges,
  };
  store.schedules.set(sched.id, updatedDraft);

  const checked = await checkExistingSchedule(sched.id, {
    engineClient: input.engineClient,
    actor: input.actor,
  });

  // Phase 5C: Record LearningEvent from Dean edit
  const editedOffering = store.offerings.get(afterEntry.offeringCode);
  if (editedOffering && afterEntry.facultyCode !== "EXTERNAL") {
    recordLearningEvent({
      termCode: sched.termCode,
      scheduleId: sched.id,
      type: "DEAN_EDIT",
      facultyCode: afterEntry.facultyCode,
      subjectCode: editedOffering.subjectCode,
      weekday: afterEntry.weekday,
      startMin: afterEntry.startMin,
      endMin: afterEntry.endMin,
    });
  }

  await withAudit(
    {
      actor: input.actor,
      action: "SCHEDULE_ENTRY_EDITED",
      entity: "Schedule",
      entityId: sched.id,
      before: beforeEntry,
      extractAfter: () => afterEntry,
    },
    async () => checked.schedule,
  );

  return checked;
}

/**
 * Undoes the most recent edit on a candidate schedule and re-validates.
 */
export async function undoLastScheduleChange(
  scheduleId: string,
  options: { actor: string; engineClient?: EngineClient },
): Promise<{
  schedule: ScheduleRecord;
  validation: EngineValidationResponse;
}> {
  const store = getMasterDataState();
  const sched = store.schedules.get(scheduleId);
  if (!sched) {
    throw new AppError(
      "SCHEDULE_NOT_FOUND",
      `Schedule "${scheduleId}" not found.`,
      404,
    );
  }
  const changes = sched.changes ?? [];
  if (changes.length === 0) {
    throw new AppError(
      "NOTHING_TO_UNDO",
      `Schedule "${scheduleId}" has no recorded changes to undo.`,
      422,
    );
  }

  const lastChange = changes[changes.length - 1];
  if (!lastChange) {
    throw new AppError(
      "NOTHING_TO_UNDO",
      `Schedule "${scheduleId}" has no recorded changes to undo.`,
      422,
    );
  }
  const prevEntry = lastChange.beforeJson as ScheduleEntryRecord;
  const nextEntries = sched.entries.map((e) =>
    e.id === prevEntry.id ? prevEntry : e,
  );

  const undoRecord: ScheduleChangeRecord = {
    id: crypto.randomUUID(),
    scheduleId: sched.id,
    actor: options.actor,
    action: "UNDO_ENTRY_EDIT",
    beforeJson: lastChange.afterJson,
    afterJson: prevEntry,
    createdAt: new Date().toISOString(),
  };

  const updated: ScheduleRecord = {
    ...sched,
    version: sched.version + 1,
    entries: nextEntries,
    changes: [...changes.slice(0, -1), undoRecord],
  };
  store.schedules.set(sched.id, updated);

  return checkExistingSchedule(sched.id, {
    engineClient: options.engineClient,
    actor: options.actor,
  });
}

/**
 * Adds a documented exception waiver for a waivable constraint (D-18).
 * Strictly rejects HC-01, HC-02, HC-03 (never waivable) and empty reasons.
 */
export async function addScheduleException(
  input: AddExceptionInput,
): Promise<{
  exception: ScheduleExceptionRecord;
  schedule: ScheduleRecord;
  validation: EngineValidationResponse;
}> {
  if (NON_WAIVABLE_HARD_CONSTRAINTS.includes(input.code)) {
    throw new AppError(
      "NON_WAIVABLE_CONSTRAINT",
      `Constraint ${input.code} (double-booking) is never waivable (D-18).`,
      422,
      { code: input.code },
    );
  }

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 5) {
    throw new AppError(
      "WAIVER_REASON_REQUIRED",
      "A documented reason of at least 5 characters is required to waive a rule (D-18).",
      422,
    );
  }

  const store = getMasterDataState();
  const sched = store.schedules.get(input.scheduleId);
  if (!sched) {
    throw new AppError(
      "SCHEDULE_NOT_FOUND",
      `Schedule "${input.scheduleId}" not found.`,
      404,
    );
  }

  const exception: ScheduleExceptionRecord = {
    id: crypto.randomUUID(),
    scheduleId: sched.id,
    code: input.code,
    offeringCode: input.offeringCode ?? null,
    facultyCode: input.facultyCode ?? null,
    roomCode: input.roomCode ?? null,
    sectionCode: input.sectionCode ?? null,
    reason: trimmedReason,
    approvedBy: input.actor,
    createdAt: new Date().toISOString(),
  };

  const nextExceptions = [...(sched.exceptions ?? []), exception];
  store.schedules.set(sched.id, {
    ...sched,
    version: sched.version + 1,
    exceptions: nextExceptions,
  });

  const checked = await checkExistingSchedule(sched.id, {
    engineClient: input.engineClient,
    actor: input.actor,
  });

  await withAudit(
    {
      actor: input.actor,
      action: "SCHEDULE_EXCEPTION_ADDED",
      entity: "ScheduleException",
      entityId: exception.id,
    },
    async () => exception,
  );

  return {
    exception,
    schedule: checked.schedule,
    validation: checked.validation,
  };
}

/**
 * Accepts a candidate schedule for portal encoding.
 * Blocked while ANY unwaived violation or unscheduled meeting remains (Phase 3 Exit Criterion 2).
 */
export async function acceptCandidateSchedule(
  scheduleId: string,
  options: { actor: string; engineClient?: EngineClient },
): Promise<ScheduleRecord> {
  const checked = await checkExistingSchedule(scheduleId, {
    engineClient: options.engineClient,
    actor: options.actor,
  });

  const { schedule, validation } = checked;
  const unscheduledCount = schedule.unscheduled?.length ?? 0;

  if (!validation.valid || validation.hard_violation_count > 0 || unscheduledCount > 0) {
    throw new AppError(
      "SCHEDULE_NOT_ACCEPTABLE",
      `Cannot accept schedule "${schedule.id}": ${validation.hard_violation_count} unwaived violation(s) and ${unscheduledCount} unscheduled meeting(s) remain.`,
      422,
      {
        hardViolationCount: validation.hard_violation_count,
        unscheduledCount,
        violations: validation.violations.filter((v) => !v.waived),
      },
    );
  }

  const store = getMasterDataState();
  // Archive any previously ACCEPTED schedule for the same term
  for (const [id, existing] of store.schedules.entries()) {
    if (
      existing.termCode === schedule.termCode &&
      existing.status === "ACCEPTED" &&
      id !== schedule.id
    ) {
      store.schedules.set(id, { ...existing, status: "ARCHIVED" });
    }
  }

  const accepted: ScheduleRecord = {
    ...schedule,
    status: "ACCEPTED",
    version: schedule.version + 1,
    acceptedAt: new Date().toISOString(),
    acceptedBy: options.actor,
  };
  store.schedules.set(accepted.id, accepted);

  // Phase 5C: Record LearningEvents from accepted schedule and retrain ML fit model
  for (const entry of accepted.entries) {
    if (entry.facultyCode === "EXTERNAL") continue;
    const off = store.offerings.get(entry.offeringCode);
    if (off) {
      recordLearningEvent({
        termCode: accepted.termCode,
        scheduleId: accepted.id,
        type: "SCHEDULE_ACCEPTED",
        facultyCode: entry.facultyCode,
        subjectCode: off.subjectCode,
        weekday: entry.weekday,
        startMin: entry.startMin,
        endMin: entry.endMin,
      });
    }
  }
  await trainAndEvaluateFitModel(options.actor, accepted.termCode);

  await withAudit(
    {
      actor: options.actor,
      action: "SCHEDULE_ACCEPTED",
      entity: "Schedule",
      entityId: accepted.id,
    },
    async () => accepted,
  );

  return accepted;
}

/**
 * Starts a revision from an ACCEPTED schedule by cloning it into a new CANDIDATE
 * with `parentScheduleId` set, keeping the accepted schedule untouched (Section 5 lifecycle).
 */
export async function createRevisionFromAccepted(
  acceptedScheduleId: string,
  options: { actor: string },
): Promise<ScheduleRecord> {
  const store = getMasterDataState();
  const parent = store.schedules.get(acceptedScheduleId);
  if (!parent) {
    throw new AppError(
      "SCHEDULE_NOT_FOUND",
      `Schedule "${acceptedScheduleId}" not found.`,
      404,
    );
  }

  const newId = crypto.randomUUID();
  const revision: ScheduleRecord = {
    ...parent,
    id: newId,
    parentScheduleId: parent.id,
    candidateLabel: `${parent.candidateLabel} (Revision)`,
    status: "CANDIDATE",
    version: 1,
    acceptedAt: null,
    acceptedBy: null,
    entries: parent.entries.map((e) => ({ ...e, id: crypto.randomUUID() })),
    exceptions: (parent.exceptions ?? []).map((ex) => ({
      ...ex,
      id: crypto.randomUUID(),
      scheduleId: newId,
    })),
    changes: [
      {
        id: crypto.randomUUID(),
        scheduleId: newId,
        actor: options.actor,
        action: "REVISION_CREATED",
        beforeJson: { parentScheduleId: parent.id },
        afterJson: { newScheduleId: newId },
        createdAt: new Date().toISOString(),
      },
    ],
  };

  store.schedules.set(newId, revision);

  await withAudit(
    {
      actor: options.actor,
      action: "SCHEDULE_REVISION_CREATED",
      entity: "Schedule",
      entityId: newId,
    },
    async () => revision,
  );

  return revision;
}

/**
 * Compares two or more candidate schedules side-by-side (Phase 3 task 10).
 */
export function compareCandidateSchedules(scheduleIds: string[]) {
  const store = getMasterDataState();
  return scheduleIds.map((id) => {
    const sched = store.schedules.get(id);
    if (!sched) {
      throw new AppError("SCHEDULE_NOT_FOUND", `Schedule "${id}" not found.`, 404);
    }
    const hoursByFac = new Map<string, number>();
    const roomsUsed = new Set<string>();
    for (const e of sched.entries) {
      const h = (e.endMin - e.startMin) / 60;
      hoursByFac.set(e.facultyCode, (hoursByFac.get(e.facultyCode) ?? 0) + h);
      roomsUsed.add(e.roomCode);
    }
    const loadValues = Array.from(hoursByFac.values());
    const avgLoadHours =
      loadValues.length > 0
        ? Number(
            (
              loadValues.reduce((a, b) => a + b, 0) / loadValues.length
            ).toFixed(2),
          )
        : 0;
    const totalRooms = Math.max(1, store.rooms.size);
    const roomUtilizationPct = Number(
      ((roomsUsed.size / totalRooms) * 100).toFixed(1),
    );

    return {
      scheduleId: sched.id,
      candidateLabel: sched.candidateLabel,
      profileName: sched.profileName ?? "CUSTOM",
      status: sched.status,
      solverStatus: sched.solverStatus ?? "BEST_FOUND",
      qualityScore: sched.qualityScore ?? 0,
      hardViolationCount: sched.validationReport?.hard_violation_count ?? 0,
      waivedViolationCount: sched.validationReport?.waived_violation_count ?? 0,
      unscheduledCount: sched.unscheduled?.length ?? 0,
      unmetPreferenceCount:
        sched.validationReport?.quality.unmet_preferences?.length ?? 0,
      avgFacultyLoadHours: avgLoadHours,
      roomUtilizationPct,
    };
  });
}

/**
 * Queries feasible alternative slots for a meeting in a schedule via POST /v1/alternatives.
 */
export async function getMeetingAlternatives(
  scheduleId: string,
  offeringCode: string,
  meetingIndex = 0,
  options?: { engineClient?: EngineClient },
): Promise<EngineAlternativesResponse> {
  const store = getMasterDataState();
  const sched = store.schedules.get(scheduleId);
  if (!sched) {
    throw new AppError(
      "SCHEDULE_NOT_FOUND",
      `Schedule "${scheduleId}" not found.`,
      404,
    );
  }
  const client = options?.engineClient ?? createEngineClient();
  const problem = buildProblemSnapshot(sched.termCode, {
    scheduleIdForWaivers: sched.id,
  });
  return client.findAlternatives({
    problem,
    current_entries: toEngineEntries(sched.entries),
    offering_code: offeringCode,
    meeting_index: meetingIndex,
    max_results: 5,
  });
}
