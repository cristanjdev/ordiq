import type {
  EngineProblem,
  EngineScheduledMeetingEntry,
  EngineSolution,
  EngineValidationResponse,
  SoftConstraintCode,
} from "@ordiq/contracts";
import { createEngineClient, type EngineClient } from "../../engine/engine.client";
import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import {
  getMasterDataState,
  type DirectiveRecord,
  type GenerationRunRecord,
  type ScheduleEntryRecord,
  type ScheduleRecord,
} from "../master-data/master-data.store";
import { getTermReadinessReport } from "../readiness/readiness.service";

export type CandidateProfileName = "BALANCED" | "FACULTY_FIRST" | "STUDENT_FIRST";

export const CANDIDATE_PROFILES: Record<
  CandidateProfileName,
  { label: string; weights: Record<SoftConstraintCode, number> }
> = {
  BALANCED: {
    label: "Candidate A — Balanced",
    weights: {
      "SC-01": 10,
      "SC-02": 8,
      "SC-03": 8,
      "SC-04": 5,
      "SC-05": 6,
      "SC-06": 12,
      "SC-07": 8,
      "SC-08": 6,
      "SC-09": 10,
      "SC-10": 7,
      "SC-11": 8,
      "SC-12": 6,
      "SC-13": 5,
      "SC-14": 6,
      "SC-15": 4,
      "SC-16": 7,
    },
  },
  FACULTY_FIRST: {
    label: "Candidate B — Faculty-First",
    weights: {
      "SC-01": 18,
      "SC-02": 14,
      "SC-03": 10,
      "SC-04": 10,
      "SC-05": 6,
      "SC-06": 14,
      "SC-07": 12,
      "SC-08": 4,
      "SC-09": 6,
      "SC-10": 5,
      "SC-11": 6,
      "SC-12": 4,
      "SC-13": 5,
      "SC-14": 6,
      "SC-15": 3,
      "SC-16": 8,
    },
  },
  STUDENT_FIRST: {
    label: "Candidate C — Student-First",
    weights: {
      "SC-01": 6,
      "SC-02": 6,
      "SC-03": 16,
      "SC-04": 4,
      "SC-05": 12,
      "SC-06": 10,
      "SC-07": 8,
      "SC-08": 8,
      "SC-09": 18,
      "SC-10": 14,
      "SC-11": 15,
      "SC-12": 14,
      "SC-13": 10,
      "SC-14": 10,
      "SC-15": 10,
      "SC-16": 12,
    },
  },
};

export function toEngineEntries(
  entries: ScheduleEntryRecord[],
): EngineScheduledMeetingEntry[] {
  const counterByOff = new Map<string, number>();
  return entries.map((e) => {
    const curIdx = counterByOff.get(e.offeringCode) ?? 0;
    const mIdx = e.meetingIndex !== undefined ? e.meetingIndex : curIdx;
    counterByOff.set(e.offeringCode, mIdx + 1);
    return {
      id: e.id,
      offering_code: e.offeringCode,
      meeting_index: mIdx,
      faculty_code: e.facultyCode,
      room_code: e.roomCode,
      weekday: e.weekday,
      start_min: e.startMin,
      end_min: e.endMin,
      pinned: e.pinned,
    };
  });
}

/**
 * Builds a complete stateless Problem snapshot from the current store for a given term (Phase 2A.2).
 */
export function buildProblemSnapshot(
  termCode: string,
  options?: {
    profileName?: CandidateProfileName;
    priorScheduleId?: string;
    scheduleIdForWaivers?: string;
  },
): EngineProblem {
  const store = getMasterDataState();
  const term =
    store.terms.get(termCode) ?? Array.from(store.terms.values())[0];
  if (!term) {
    throw new AppError("TERM_NOT_FOUND", `Term "${termCode}" not found.`, 404);
  }

  const profileName = options?.profileName ?? "BALANCED";
  const baseWeights = { ...CANDIDATE_PROFILES[profileName].weights };

  const directives = Array.from(store.directives.values()).filter(
    (d) => d.termCode === term.code,
  );
  // Dean weight overrides (Rules page) set the Balanced profile's weight; the
  // other profiles scale by the same ratio so they keep their own emphasis.
  const balanced: Record<string, number> = CANDIDATE_PROFILES.BALANCED.weights;
  for (const d of directives) {
    if (d.type === "SET_WEIGHT" && d.offeringCode) {
      const code = d.offeringCode as SoftConstraintCode;
      if (code in baseWeights) {
        const reference = balanced[code] ?? 0;
        baseWeights[code] =
          reference > 0 ? Math.round(baseWeights[code] * (d.weight / reference) * 100) / 100 : d.weight;
      }
    }
  }

  let priorEntries: EngineScheduledMeetingEntry[] = [];
  if (options?.priorScheduleId) {
    const priorSched = store.schedules.get(options.priorScheduleId);
    if (priorSched) {
      priorEntries = toEngineEntries(priorSched.entries);
    }
  }

  const targetSched = options?.scheduleIdForWaivers
    ? store.schedules.get(options.scheduleIdForWaivers)
    : undefined;
  const waivers = (targetSched?.exceptions ?? []).map((ex) => ({
    code: ex.code,
    offering_code: ex.offeringCode,
    faculty_code: ex.facultyCode,
    room_code: ex.roomCode,
    section_code: ex.sectionCode,
    reason: ex.reason,
    approved_by: ex.approvedBy,
  }));

  return {
    term: {
      code: term.code,
      slot_step_minutes: term.slotSizeMin,
      day_start_min: term.dayStartMin,
      day_end_min: term.dayEndMin,
      allowed_weekdays: term.teachingDays,
      official_breaks: [],
    },
    faculty: Array.from(store.faculty.values()).map((f) => ({
      code: f.code,
      name: f.alias,
      program_code: f.programCode,
      employment_type: f.employmentType,
      specialization: f.specialization,
      max_load_units: f.maxLoadUnits,
      max_load_hours: f.maxLoadHours,
      status: f.status,
    })),
    subjects: Array.from(store.subjects.values()).map((s) => ({
      code: s.code,
      name: s.name,
      program_code: s.programCode,
      year_level: s.yearLevel,
      category: s.category,
      units: s.units,
      contact_hours: s.contactHours,
      lecture_hours: s.lectureHours,
      lab_hours: s.labHours,
    })),
    sections: Array.from(store.sections.values()).map((sec) => ({
      code: sec.code,
      program_code: sec.programCode,
      year_level: sec.yearLevel,
      student_count: sec.studentCount,
    })),
    rooms: Array.from(store.rooms.values()).map((r) => ({
      code: r.code,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
      status: r.status,
    })),
    offerings: Array.from(store.offerings.values())
      .filter((o) => o.termCode === term.code)
      .map((o) => ({
        code: o.code,
        section_code: o.sectionCode,
        subject_code: o.subjectCode,
        component: o.component,
        meetings_per_week: o.meetingsPerWeek,
        minutes_per_meeting: o.minutesPerMeeting,
        meeting_pattern: o.meetingPattern,
        required_room_type: o.requiredRoomType,
        preassigned_faculty_code: o.preassignedFacultyCode,
        combined_class_group: o.combinedClassGroup,
      })),
    faculty_availability: Array.from(store.facultyAvailability.values())
      .filter((a) => a.termCode === term.code)
      .map((a) => ({
        entity_code: a.facultyCode,
        weekday: a.weekday,
        start_min: a.startMin,
        end_min: a.endMin,
        status: a.status,
      })),
    room_availability: [],
    qualifications: Array.from(store.facultyQualifications.values()).map(
      (q) => ({
        faculty_code: q.facultyCode,
        subject_code: q.subjectCode,
      }),
    ),
    fixed_blocks: Array.from(store.fixedBlocks.values())
      .filter((fb) => fb.termCode === term.code)
      .map((fb) => ({
        section_code: fb.sectionCode,
        weekday: fb.weekday,
        start_min: fb.startMin,
        end_min: fb.endMin,
        label: fb.label,
      })),
    calendar_restrictions: [],
    directives: directives.map((d) => ({
      id: d.id,
      type: d.type,
      hardness: d.hardness,
      approved: d.approved,
      faculty_code: d.facultyCode,
      section_code: d.sectionCode,
      room_code: d.roomCode,
      offering_code: d.offeringCode,
      weekday: d.weekday,
      start_min: d.startMin,
      end_min: d.endMin,
      weight: d.weight,
    })),
    faculty_preferences: Array.from(store.facultyPreferences.values())
      .filter((p) => p.termCode === term.code)
      .map((p) => ({
        faculty_code: p.facultyCode,
        type:
          p.type === "PREFERRED_TIME_WINDOW" ? "PREFERRED_TIME" : p.type,
        value: p.value,
        weight: p.weight,
        approved: true,
      })),
    soft_weights: {
      weights: baseWeights,
    },
    ml_fit_scores: {},
    prior_entries: priorEntries,
    waivers,
  };
}

/**
 * Checks an existing or imported schedule via the independent Python validator (`POST /v1/validate`),
 * updates its validationReport and qualityScore, and clears recheckNeeded (Phase 2A.8 & 2D.6).
 */
export async function checkExistingSchedule(
  scheduleId: string,
  options?: { engineClient?: EngineClient; actor?: string },
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

  const client = options?.engineClient ?? createEngineClient();
  const problem = buildProblemSnapshot(sched.termCode, {
    scheduleIdForWaivers: sched.id,
  });
  const engineEntries = toEngineEntries(sched.entries);

  const validation = await client.validateSchedule({
    problem,
    entries: engineEntries,
  });

  const updated: ScheduleRecord = {
    ...sched,
    recheckNeeded: false,
    qualityScore: validation.quality.quality_score,
    validationReport: validation,
  };
  store.schedules.set(sched.id, updated);

  return { schedule: updated, validation };
}

/**
 * Runs a full GenerationRun producing candidates across weight profiles (D-19),
 * re-validating every solver output through POST /v1/validate and marking SOLVER_MODEL_BUG
 * if the independent validator detects any unwaived non-HC-08 hard violation on solver output (Phase 2D).
 */
export async function runScheduleGeneration(
  termCode: string,
  options?: {
    profiles?: CandidateProfileName[];
    priorScheduleId?: string;
    timeLimitSeconds?: number;
    allowPartialWhenCriticalGaps?: boolean;
    engineClient?: EngineClient;
    actor?: string;
  },
): Promise<{
  run: GenerationRunRecord;
  candidates: ScheduleRecord[];
}> {
  const store = getMasterDataState();
  const readiness = getTermReadinessReport(termCode);
  if (!readiness.canGenerate && !options?.allowPartialWhenCriticalGaps) {
    throw new AppError(
      "READINESS_CRITICAL_GAPS",
      `Cannot generate schedule for ${termCode}: ${readiness.criticalCount} critical data gap(s) detected.`,
      422,
      { issues: readiness.issues },
    );
  }

  const profiles = options?.profiles ?? [
    "BALANCED",
    "FACULTY_FIRST",
    "STUDENT_FIRST",
  ];
  const client = options?.engineClient ?? createEngineClient();
  const actor = options?.actor ?? "dean";

  const runId = crypto.randomUUID();
  const run: GenerationRunRecord = {
    id: runId,
    termCode,
    status: "RUNNING",
    profiles,
    candidateScheduleIds: [],
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  store.generationRuns.set(runId, run);

  const candidates: ScheduleRecord[] = [];

  for (const profileName of profiles) {
    const problem = buildProblemSnapshot(termCode, {
      profileName,
      priorScheduleId: options?.priorScheduleId,
    });

    const jobResp = await client.startSolveJob({
      problem,
      profile_name: profileName,
      time_limit_seconds: options?.timeLimitSeconds ?? 10,
    });

    const solution: EngineSolution | null | undefined = jobResp.solution;
    if (!solution || jobResp.status === "FAILED") {
      run.status = "FAILED";
      run.error = jobResp.error ?? "Solver failed to produce a solution.";
      run.completedAt = new Date().toISOString();
      store.generationRuns.set(runId, run);
      throw new AppError("SOLVER_FAILED", run.error, 500);
    }

    // Independent validation check (Phase 2D: Re-validate every solver result before saving)
    const independentCheck = await client.validateSchedule({
      problem,
      entries: solution.entries ?? [],
    });

    // Any unwaived hard violation other than HC-08 (when partial/unscheduled meetings exist)
    // indicates a solver modeling bug (Phase 2D.5)!
    const modelBugViolations = independentCheck.violations.filter(
      (v) => !v.waived && v.code !== "HC-08",
    );
    if (modelBugViolations.length > 0) {
      run.status = "SOLVER_MODEL_BUG";
      run.error = `Independent validator rejected solver output: ${modelBugViolations.map((v) => v.code).join(", ")}`;
      run.completedAt = new Date().toISOString();
      store.generationRuns.set(runId, run);
      throw new AppError("SOLVER_MODEL_BUG", run.error, 500, {
        violations: modelBugViolations,
      });
    }

    const schedId = crypto.randomUUID();
    const mappedEntries: ScheduleEntryRecord[] = (solution.entries ?? []).map(
      (e) => ({
        id: e.id || crypto.randomUUID(),
        offeringCode: e.offering_code,
        meetingIndex: e.meeting_index,
        facultyCode: e.faculty_code,
        roomCode: e.room_code,
        weekday: e.weekday,
        startMin: e.start_min,
        endMin: e.end_min,
        pinned: e.pinned ?? false,
      }),
    );

    const mappedUnscheduled = (solution.unscheduled ?? []).map((u) => ({
      offeringCode: u.offering_code,
      meetingIndex: u.meeting_index,
      reasonCode: u.reason_code,
      reasonDetail: u.reason_detail,
    }));

    const candidate: ScheduleRecord = {
      id: schedId,
      termCode,
      runId,
      parentScheduleId: options?.priorScheduleId ?? null,
      candidateLabel: CANDIDATE_PROFILES[profileName].label,
      profileName,
      status: "CANDIDATE",
      source: "GENERATED",
      solverStatus: solution.status,
      optimalityGapPct: solution.optimality_gap_pct ?? 0,
      recheckNeeded: false,
      version: 1,
      qualityScore: independentCheck.quality.quality_score,
      entries: mappedEntries,
      unscheduled: mappedUnscheduled,
      exceptions: [],
      changes: [],
      validationReport: independentCheck,
    };

    store.schedules.set(schedId, candidate);
    run.candidateScheduleIds.push(schedId);
    candidates.push(candidate);
  }

  run.status = "DONE";
  run.completedAt = new Date().toISOString();
  store.generationRuns.set(runId, run);

  await withAudit(
    {
      actor,
      action: "GENERATION_RUN_COMPLETED",
      entity: "GenerationRun",
      entityId: runId,
    },
    async () => ({
      runId,
      termCode,
      candidateIds: run.candidateScheduleIds,
    }),
  );

  return { run, candidates };
}

export async function addDirective(
  input: Omit<DirectiveRecord, "id" | "createdAt">,
): Promise<DirectiveRecord> {
  const store = getMasterDataState();
  const id = `DIR-${crypto.randomUUID().slice(0, 8)}`;
  const record: DirectiveRecord = {
    ...input,
    id,
    createdAt: new Date().toISOString(),
  };
  return withAudit(
    {
      actor: input.createdBy,
      action: "DIRECTIVE_CREATED",
      entity: "Constraint",
      entityId: id,
    },
    async () => {
      store.directives.set(id, record);
      return record;
    },
  );
}
