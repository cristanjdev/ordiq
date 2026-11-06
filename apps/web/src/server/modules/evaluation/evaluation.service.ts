import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import {
  computeScheduleAnalytics,
  resolveTargetSchedule,
} from "../analytics/analytics.service";
import {
  type EvaluationSessionRecord,
  getMasterDataState,
} from "../master-data/master-data.store";

export interface Iso25010TestCaseItem {
  id: string;
  qualityCharacteristic:
    | "functionalSuitability"
    | "performanceEfficiency"
    | "usability"
    | "reliability"
    | "security";
  stage: "STAGE_1_BASELINE" | "STAGE_2_CONFLICT_CHECK" | "STAGE_3_GENERATION";
  title: string;
  verificationTarget: string;
  /**
   * Results are recorded by the proponents who run the evaluation (Q-21 criteria pending);
   * ORDIQ never pre-asserts a pass.
   */
  status: "NOT_RECORDED";
}

export const ISO_25010_TEST_CASE_CATALOGUE: readonly Iso25010TestCaseItem[] = [
  {
    id: "TC-FS-01",
    qualityCharacteristic: "functionalSuitability",
    stage: "STAGE_1_BASELINE",
    title: "Independent Hard Constraint Validator (HC-01 to HC-15)",
    verificationTarget:
      "Plain-Python validator catches injected violations across all 15 hard constraint families.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-FS-02",
    qualityCharacteristic: "functionalSuitability",
    stage: "STAGE_1_BASELINE",
    title: "CP-SAT Multi-Profile Candidate Generation (D-19)",
    verificationTarget:
      "Produces BALANCED, FACULTY_FIRST, and STUDENT_FIRST candidates with 0 unwaived hard conflicts.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-FS-03",
    qualityCharacteristic: "functionalSuitability",
    stage: "STAGE_2_CONFLICT_CHECK",
    title: "1st Semester A.Y. 2026-2027 Manual Schedule Conflict Audit",
    verificationTarget:
      "Detects room/faculty/section overlaps and capacity violations on imported baseline schedule.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-PE-01",
    qualityCharacteristic: "performanceEfficiency",
    stage: "STAGE_1_BASELINE",
    title: "Medium College Fixture Solve Time (< 120s Target)",
    verificationTarget:
      "7-program, 44-faculty, 24-section (903-student) college snapshot solves within configured time limit.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-PE-02",
    qualityCharacteristic: "performanceEfficiency",
    stage: "STAGE_3_GENERATION",
    title: "Interactive Workspace Edit Re-Validation Latency",
    verificationTarget:
      "Each manual edit or drag-and-drop triggers POST /v1/validate with immediate conflict feedback.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-US-01",
    qualityCharacteristic: "usability",
    stage: "STAGE_3_GENERATION",
    title: "English, Filipino, and Taglish Conversational Assistant",
    verificationTarget:
      "32-prompt golden evaluation set handles natural instructions, directives, and change proposals.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-US-02",
    qualityCharacteristic: "usability",
    stage: "STAGE_3_GENERATION",
    title: "Dean Pilot Effort & Correction Burden Tracking",
    verificationTarget:
      "Tracks session duration and derives correctionCount automatically from ScheduleChange history.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-RE-01",
    qualityCharacteristic: "reliability",
    stage: "STAGE_1_BASELINE",
    title: "Optimistic Locking & Partial Candidate Diagnostics (D-07)",
    verificationTarget:
      "Prevents concurrent tab overwrites (409) and classifies unscheduled meetings with exact reason codes.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-SE-01",
    qualityCharacteristic: "security",
    stage: "STAGE_1_BASELINE",
    title: "Dean-Only Argon2id + Mandatory TOTP 2FA & Route Protection",
    verificationTarget:
      "Every unauthenticated request to any data/schedule/AI route returns 401; public signup disabled.",
    status: "NOT_RECORDED",
  },
  {
    id: "TC-SE-02",
    qualityCharacteristic: "security",
    stage: "STAGE_1_BASELINE",
    title: "Privacy Gateway Faculty.alias Egress Protection",
    verificationTarget:
      "Zero faculty names appear in any outgoing LLM request payload across all 32 golden prompts.",
    status: "NOT_RECORDED",
  },
] as const;

export interface StartEvaluationSessionInput {
  termCode: string;
  stage: "STAGE_1_BASELINE" | "STAGE_2_CONFLICT_CHECK" | "STAGE_3_GENERATION";
  scenario: string;
  participantRole?: string;
  scheduleId?: string | null;
  notes?: string;
  actor: string;
}

export interface CompleteEvaluationSessionInput {
  sessionId: string;
  scheduleId?: string | null;
  iso25010Ratings?: {
    functionalSuitability: number;
    performanceEfficiency: number;
    usability: number;
    reliability: number;
    security: number;
    maintainability: number;
  };
  notes?: string;
  actor: string;
}

export async function startEvaluationSession(
  input: StartEvaluationSessionInput,
): Promise<EvaluationSessionRecord> {
  return withAudit(
    {
      actor: input.actor,
      action: "EVALUATION_SESSION_STARTED",
      entity: "EvaluationSession",
      entityId: input.termCode,
    },
    async () => {
      const state = getMasterDataState();
      const targetSched = resolveTargetSchedule(
        input.termCode,
        input.scheduleId,
      );
      const conflictCountBefore =
        targetSched?.validationReport?.hard_violation_count ?? 0;

      const session: EvaluationSessionRecord = {
        id: crypto.randomUUID(),
        termCode: input.termCode,
        stage: input.stage,
        scenario: input.scenario,
        participantRole: input.participantRole ?? "DEAN",
        scheduleId: targetSched?.id ?? null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationMinutes: null,
        correctionCount: (targetSched?.changes ?? []).length,
        conflictCountBefore,
        conflictCountAfter: conflictCountBefore,
        iso25010Ratings: null,
        notes: input.notes ?? "",
      };
      state.evaluationSessions.set(session.id, session);
      return session;
    },
  );
}

/**
 * Complete an EvaluationSession, automatically deriving `correctionCount` from `ScheduleChange`
 * and computing `conflictCountAfter` from the schedule's current validation report.
 */
export async function completeEvaluationSession(
  input: CompleteEvaluationSessionInput,
): Promise<EvaluationSessionRecord> {
  return withAudit(
    {
      actor: input.actor,
      action: "EVALUATION_SESSION_COMPLETED",
      entity: "EvaluationSession",
      entityId: input.sessionId,
    },
    async () => {
      const state = getMasterDataState();
      const existing = state.evaluationSessions.get(input.sessionId);
      if (!existing) {
        throw new AppError(
          "EVALUATION_SESSION_NOT_FOUND",
          `Evaluation session '${input.sessionId}' not found.`,
          404,
        );
      }

      const schedId = input.scheduleId ?? existing.scheduleId;
      const targetSched = resolveTargetSchedule(existing.termCode, schedId);
      const endedAt = new Date().toISOString();
      const elapsedMs = Math.max(
        1000,
        new Date(endedAt).getTime() - new Date(existing.startedAt).getTime(),
      );
      const durationMinutes = Number((elapsedMs / 60000).toFixed(2));

      // Derive correction counts directly from ScheduleChange records (Phase 7 requirement)
      const correctionCount = (targetSched?.changes ?? []).filter(
        (c) => c.action === "ENTRY_EDITED",
      ).length;
      const conflictCountAfter =
        targetSched?.validationReport?.hard_violation_count ?? 0;

      const completed: EvaluationSessionRecord = {
        ...existing,
        scheduleId: targetSched?.id ?? existing.scheduleId,
        endedAt,
        durationMinutes,
        correctionCount,
        conflictCountAfter,
        // Ratings come only from the participant; never fill in a default score.
        iso25010Ratings: input.iso25010Ratings ?? existing.iso25010Ratings,
        notes: input.notes ?? existing.notes,
      };
      state.evaluationSessions.set(completed.id, completed);
      return completed;
    },
  );
}

export function getEvaluationEvidenceExport(termCode = "AY2026-2027-S1") {
  const state = getMasterDataState();
  const analytics = computeScheduleAnalytics(termCode);
  const sessions = Array.from(state.evaluationSessions.values()).filter(
    (s) => s.termCode === termCode,
  );

  return {
    termCode,
    generatedAt: new Date().toISOString(),
    baselineCarePolicy:
      "Baseline care: The manuscript's 22-day rework figure includes portal encoding and cannot be split. The 16.6% survey figure and the 70% estimate of student change requests are not comparable. ORDIQ reports exact counts and never implies a measured percentage reduction for either.",
    iso25010TestCases: ISO_25010_TEST_CASE_CATALOGUE,
    stage2HistoricalComparison: analytics.manualComparison,
    currentAnalyticsSummary: analytics.metrics,
    studentChangeRequestRisk: analytics.studentChangeRequestRisk,
    sessions,
  };
}

