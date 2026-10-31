import type { Weekday } from "@ordiq/contracts";
import { z } from "zod";
import { createEngineClient } from "../../engine/engine.client";
import {
  computeFacultyLoads,
  computeRoomUtilizations,
  computeScheduleAnalytics,
  resolveTargetSchedule,
} from "../analytics/analytics.service";
import {
  addDirective,
  buildProblemSnapshot,
  checkExistingSchedule,
  runScheduleGeneration,
  toEngineEntries,
} from "../generation/generation.service";
import {
  type ChangeProposalRecord,
  getMasterDataState,
  type ScheduleEntryRecord,
} from "../master-data/master-data.store";
import { getSubjectFacultyRecommendations } from "../ml/ml.service";
import { getTermReadinessReport } from "../readiness/readiness.service";
import {
  compareCandidateSchedules,
  getMeetingAlternatives,
} from "../schedules/schedules.service";
import { serializeToolResultForLlm } from "./privacy-gateway";

const engineClient = createEngineClient();

/**
 * Closed list of the 14 permitted AI tools (Phase 4C).
 * No tool exists to apply a proposal, accept a schedule, delete data, or edit master data.
 */
export const ALLOWED_AI_TOOL_NAMES = [
  "get_data_readiness",
  "check_conflicts",
  "compare_candidates",
  "get_schedule_summary",
  "get_entries",
  "get_unscheduled",
  "get_unmet_preferences",
  "get_faculty_load",
  "get_room_utilization",
  "find_alternative_slots",
  "get_recommendations",
  "add_directive",
  "generate_schedule",
  "propose_change",
] as const;

export type AiToolName = (typeof ALLOWED_AI_TOOL_NAMES)[number];

export const FORBIDDEN_WRITE_ACTIONS = [
  "apply_proposal",
  "accept_schedule",
  "delete_data",
  "edit_master_data",
  "drop_table",
  "delete_schedule",
  "update_faculty",
  "create_account",
] as const;

const WeekdayEnum = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
]);

export const AiToolSchemas = {
  get_data_readiness: z.object({
    termCode: z.string().min(1),
  }),
  check_conflicts: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    facultyCode: z.string().optional(),
    roomCode: z.string().optional(),
    sectionCode: z.string().optional(),
  }),
  compare_candidates: z.object({
    termCode: z.string().min(1),
    scheduleIdA: z.string().optional(),
    scheduleIdB: z.string().optional(),
  }),
  get_schedule_summary: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
  }),
  get_entries: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    facultyCode: z.string().optional(),
    roomCode: z.string().optional(),
    sectionCode: z.string().optional(),
    weekday: WeekdayEnum.optional(),
  }),
  get_unscheduled: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
  }),
  get_unmet_preferences: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    facultyCode: z.string().optional(),
  }),
  get_faculty_load: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    facultyCode: z.string().optional(),
  }),
  get_room_utilization: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    roomCode: z.string().optional(),
  }),
  find_alternative_slots: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    offeringCode: z.string().min(1),
    meetingIndex: z.number().int().min(0).default(0),
  }),
  get_recommendations: z.object({
    termCode: z.string().min(1),
    subjectCode: z.string().min(1),
    topK: z.number().int().min(1).max(10).default(5),
  }),
  add_directive: z.object({
    termCode: z.string().min(1),
    type: z.enum([
      "FACULTY_NOT_ON_DAY",
      "FACULTY_TIME_WINDOW",
      "SECTION_TIME_WINDOW",
      "AVOID_ROOM",
      "REQUIRE_ROOM",
      "PIN_MEETING",
      "ASSIGN_FACULTY",
      "SET_WEIGHT",
    ]),
    hardness: z.enum(["HARD", "SOFT"]).default("SOFT"),
    facultyCode: z.string().nullable().optional(),
    sectionCode: z.string().nullable().optional(),
    roomCode: z.string().nullable().optional(),
    offeringCode: z.string().nullable().optional(),
    weekday: WeekdayEnum.nullable().optional(),
    startMin: z.number().int().nullable().optional(),
    endMin: z.number().int().nullable().optional(),
    weight: z.number().int().min(1).max(20).default(8),
  }),
  generate_schedule: z.object({
    termCode: z.string().min(1),
    profiles: z
      .array(z.enum(["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"]))
      .default(["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"]),
  }),
  propose_change: z.object({
    termCode: z.string().min(1),
    scheduleId: z.string().optional(),
    offeringCode: z.string().min(1),
    meetingIndex: z.number().int().min(0).default(0),
    weekday: WeekdayEnum.optional(),
    startMin: z.number().int().optional(),
    endMin: z.number().int().optional(),
    roomCode: z.string().optional(),
    facultyCode: z.string().optional(),
  }),
} as const;

export interface AiToolExecutionResult {
  toolName: AiToolName;
  rawResult: unknown;
  sanitizedResultForLlm: unknown;
  structuredPart: {
    kind:
      | "readiness_card"
      | "conflict_list"
      | "comparison_card"
      | "schedule_card"
      | "entries_list"
      | "unscheduled_list"
      | "unmet_preferences_list"
      | "chart_card"
      | "alternatives_list"
      | "recommendations_card"
      | "directive_card"
      | "run_progress"
      | "proposal_card";
    title: string;
    data: unknown;
  };
}

/**
 * Execute one of the 14 permitted AI tools and serialize its result through the Privacy Gateway allowlist.
 */
export async function executeAiTool(
  toolName: AiToolName,
  rawArgs: unknown,
  actor = "dean@mseuf.edu.ph",
): Promise<AiToolExecutionResult> {
  const state = getMasterDataState();

  switch (toolName) {
    case "get_data_readiness": {
      const args = AiToolSchemas.get_data_readiness.parse(rawArgs);
      const report = getTermReadinessReport(args.termCode);
      return {
        toolName,
        rawResult: report,
        sanitizedResultForLlm: serializeToolResultForLlm(report),
        structuredPart: {
          kind: "readiness_card",
          title: `Data Readiness (${args.termCode})`,
          data: report,
        },
      };
    }

    case "check_conflicts": {
      const args = AiToolSchemas.check_conflicts.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      if (!target) {
        const empty = {
          scheduleId: null,
          hardViolationCount: 0,
          violations: [],
        };
        return {
          toolName,
          rawResult: empty,
          sanitizedResultForLlm: serializeToolResultForLlm(empty),
          structuredPart: {
            kind: "conflict_list",
            title: "Schedule Conflict Check",
            data: empty,
          },
        };
      }

      const checked = await checkExistingSchedule(target.id, { actor });
      let violations = checked.validation.violations;
      const filterFac = args.facultyCode;
      if (filterFac) {
        violations = violations.filter((v) =>
          (v.faculty_codes ?? []).includes(filterFac),
        );
      }
      const filterRoom = args.roomCode;
      if (filterRoom) {
        violations = violations.filter((v) =>
          (v.room_codes ?? []).includes(filterRoom),
        );
      }
      const filterSection = args.sectionCode;
      if (filterSection) {
        violations = violations.filter((v) =>
          (v.section_codes ?? []).includes(filterSection),
        );
      }

      const payload = {
        scheduleId: checked.schedule.id,
        candidateLabel: checked.schedule.candidateLabel,
        hardViolationCount: violations.filter((v) => !v.waived).length,
        violations: violations.map((v) => ({
          constraintId: v.code,
          severity: "HARD",
          message: v.message,
          waivable: v.waivable,
          waived: v.waived ?? false,
          recordIds: [
            ...(v.offering_codes ?? []),
            ...(v.faculty_codes ?? []),
            ...(v.room_codes ?? []),
            ...(v.section_codes ?? []),
          ],
        })),
      };

      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "conflict_list",
          title: `Conflict Check — ${checked.schedule.candidateLabel}`,
          data: payload,
        },
      };
    }

    case "compare_candidates": {
      const args = AiToolSchemas.compare_candidates.parse(rawArgs);
      const termScheds = Array.from(state.schedules.values()).filter(
        (s) => s.termCode === args.termCode,
      );
      const idA = args.scheduleIdA ?? termScheds[0]?.id;
      const idB = args.scheduleIdB ?? termScheds[1]?.id ?? termScheds[0]?.id;

      if (!idA || !idB) {
        const empty = { comparison: null };
        return {
          toolName,
          rawResult: empty,
          sanitizedResultForLlm: serializeToolResultForLlm(empty),
          structuredPart: {
            kind: "comparison_card",
            title: "Candidate Comparison",
            data: empty,
          },
        };
      }

      const items = compareCandidateSchedules([idA, idB]);
      const payload = {
        candidateA: items[0],
        candidateB: items[1] ?? items[0],
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "comparison_card",
          title: `Comparison: ${payload.candidateA?.candidateLabel} vs ${payload.candidateB?.candidateLabel}`,
          data: payload,
        },
      };
    }

    case "get_schedule_summary": {
      const args = AiToolSchemas.get_schedule_summary.parse(rawArgs);
      const analytics = computeScheduleAnalytics(args.termCode, args.scheduleId);
      const summary = {
        termCode: analytics.termCode,
        scheduleId: analytics.scheduleId,
        candidateLabel: analytics.candidateLabel,
        status: analytics.status,
        version: analytics.version,
        qualityScore: analytics.metrics.qualityScore,
        hardViolationCount: analytics.metrics.conflictsDetected,
        unscheduledCount:
          analytics.studentChangeRequestRisk.unscheduledMeetingCount,
        totalScheduledMeetings: analytics.metrics.classesScheduled,
        totalMeetings: analytics.metrics.totalMeetings,
        roomUtilization: analytics.metrics.roomUtilizationPct,
      };
      return {
        toolName,
        rawResult: summary,
        sanitizedResultForLlm: serializeToolResultForLlm(summary),
        structuredPart: {
          kind: "schedule_card",
          title: `Schedule Summary — ${analytics.candidateLabel}`,
          data: summary,
        },
      };
    }

    case "get_entries": {
      const args = AiToolSchemas.get_entries.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      let entries = target?.entries ?? [];
      if (args.facultyCode) {
        entries = entries.filter((e) => e.facultyCode === args.facultyCode);
      }
      if (args.roomCode) {
        entries = entries.filter((e) => e.roomCode === args.roomCode);
      }
      if (args.weekday) {
        entries = entries.filter((e) => e.weekday === args.weekday);
      }
      if (args.sectionCode) {
        entries = entries.filter((e) => {
          const off = state.offerings.get(e.offeringCode);
          return off?.sectionCode === args.sectionCode;
        });
      }
      const payload = {
        scheduleId: target?.id ?? null,
        entries: entries.slice(0, 30),
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "entries_list",
          title: `Schedule Entries (${entries.length} matched)`,
          data: payload,
        },
      };
    }

    case "get_unscheduled": {
      const args = AiToolSchemas.get_unscheduled.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      const unscheduled = target?.unscheduled ?? [];
      const payload = {
        scheduleId: target?.id ?? null,
        unscheduledCount: unscheduled.length,
        unscheduled,
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "unscheduled_list",
          title: `Unscheduled Meetings (${unscheduled.length})`,
          data: payload,
        },
      };
    }

    case "get_unmet_preferences": {
      const args = AiToolSchemas.get_unmet_preferences.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      let unmet =
        target?.validationReport?.quality.unmet_preferences ?? [];
      if (args.facultyCode) {
        unmet = unmet.filter((u) => u.faculty_code === args.facultyCode);
      }
      const payload = {
        scheduleId: target?.id ?? null,
        unmetPreferences: unmet.map((u) => ({
          preferenceId: u.code,
          facultyCode: u.faculty_code,
          message: u.description,
          penalty: u.penalty,
        })),
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "unmet_preferences_list",
          title: `Unmet Preferences (${unmet.length})`,
          data: payload,
        },
      };
    }

    case "get_faculty_load": {
      const args = AiToolSchemas.get_faculty_load.parse(rawArgs);
      const facultyLoads = computeFacultyLoads(
        args.termCode,
        args.scheduleId,
        args.facultyCode,
      );
      const payload = {
        termCode: args.termCode,
        facultyLoads: facultyLoads.slice(0, 25),
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "chart_card",
          title: "Faculty Teaching Load Summary",
          data: payload,
        },
      };
    }

    case "get_room_utilization": {
      const args = AiToolSchemas.get_room_utilization.parse(rawArgs);
      const roomUtilizations = computeRoomUtilizations(
        args.termCode,
        args.scheduleId,
        args.roomCode,
      );
      const payload = {
        termCode: args.termCode,
        roomUtilizations,
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "chart_card",
          title: "Room Utilization Summary",
          data: payload,
        },
      };
    }

    case "find_alternative_slots": {
      const args = AiToolSchemas.find_alternative_slots.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      if (!target) {
        const empty = {
          offeringCode: args.offeringCode,
          alternatives: [],
        };
        return {
          toolName,
          rawResult: empty,
          sanitizedResultForLlm: serializeToolResultForLlm(empty),
          structuredPart: {
            kind: "alternatives_list",
            title: "Alternative Slots",
            data: empty,
          },
        };
      }
      const altRes = await getMeetingAlternatives(
        target.id,
        args.offeringCode,
        args.meetingIndex,
      );
      const payload = {
        scheduleId: target.id,
        offeringCode: args.offeringCode,
        meetingIndex: args.meetingIndex,
        alternatives: altRes.alternatives.map((a) => ({
          weekday: a.weekday,
          startMin: a.start_min,
          endMin: a.end_min,
          roomCode: a.room_code,
          facultyCode: a.faculty_code,
          qualityDelta: a.quality_delta,
          resultingQualityScore: a.resulting_quality_score,
        })),
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "alternatives_list",
          title: `Feasible Alternatives for ${args.offeringCode}`,
          data: payload,
        },
      };
    }

    case "get_recommendations": {
      const args = AiToolSchemas.get_recommendations.parse(rawArgs);
      const rec = await getSubjectFacultyRecommendations(
        args.subjectCode,
        args.topK,
      );
      return {
        toolName,
        rawResult: rec,
        sanitizedResultForLlm: serializeToolResultForLlm(rec),
        structuredPart: {
          kind: "recommendations_card",
          title: `Best-Fit Faculty Recommendations for ${args.subjectCode}`,
          data: rec,
        },
      };
    }

    case "add_directive": {
      const args = AiToolSchemas.add_directive.parse(rawArgs);
      const directive = await addDirective({
        termCode: args.termCode,
        type: args.type,
        hardness: args.hardness,
        approved: true,
        facultyCode: args.facultyCode ?? null,
        sectionCode: args.sectionCode ?? null,
        roomCode: args.roomCode ?? null,
        offeringCode: args.offeringCode ?? null,
        weekday: (args.weekday as Weekday | null | undefined) ?? null,
        startMin: args.startMin ?? null,
        endMin: args.endMin ?? null,
        weight: args.weight,
        createdBy: actor,
      });
      const payload = {
        directiveId: directive.id,
        termCode: directive.termCode,
        type: directive.type,
        hardness: directive.hardness,
        facultyCode: directive.facultyCode,
        weekday: directive.weekday,
        startMin: directive.startMin,
        endMin: directive.endMin,
        weight: directive.weight,
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "directive_card",
          title: `Added Scheduling Directive (${directive.type})`,
          data: payload,
        },
      };
    }

    case "generate_schedule": {
      const args = AiToolSchemas.generate_schedule.parse(rawArgs);
      const runRes = await runScheduleGeneration(args.termCode, {
        profiles: args.profiles,
        timeLimitSeconds: 5,
        actor,
      });
      const payload = {
        runId: runRes.run.id,
        termCode: runRes.run.termCode,
        status: runRes.run.status,
        candidateScheduleIds: runRes.run.candidateScheduleIds,
        counts: {
          offerings: runRes.candidates.length,
        },
      };
      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "run_progress",
          title: `Generated ${runRes.candidates.length} Candidate Schedules`,
          data: payload,
        },
      };
    }

    case "propose_change": {
      const args = AiToolSchemas.propose_change.parse(rawArgs);
      const target = resolveTargetSchedule(args.termCode, args.scheduleId);
      if (!target) {
        throw new Error(
          `No schedule found for term ${args.termCode} to propose a change.`,
        );
      }

      const targetEntry =
        target.entries.find(
          (e) =>
            e.offeringCode === args.offeringCode &&
            (e.meetingIndex ?? 0) === args.meetingIndex,
        ) ??
        target.entries.find((e) => e.offeringCode === args.offeringCode) ??
        target.entries[0];

      if (!targetEntry) {
        throw new Error(
          `Meeting ${args.offeringCode} not found in schedule ${target.candidateLabel}.`,
        );
      }

      const duration = targetEntry.endMin - targetEntry.startMin;
      const nextStart = args.startMin ?? targetEntry.startMin;
      const nextEnd = args.endMin ?? nextStart + duration;
      const afterEntry: ScheduleEntryRecord = {
        ...targetEntry,
        weekday: (args.weekday as Weekday | undefined) ?? targetEntry.weekday,
        startMin: nextStart,
        endMin: nextEnd,
        roomCode: args.roomCode ?? targetEntry.roomCode,
        facultyCode: args.facultyCode ?? targetEntry.facultyCode,
      };

      // Validate the candidate change without mutating the schedule
      const problem = buildProblemSnapshot(args.termCode);
      const trialEntries = target.entries.map((e) =>
        e.id === targetEntry.id ? afterEntry : e,
      );
      const valRes = await engineClient.validateSchedule({
        problem,
        entries: toEngineEntries(trialEntries),
      });

      const oldScore = target.qualityScore ?? 100;
      const newScore = valRes.quality.quality_score;
      const qualityDelta = Number((newScore - oldScore).toFixed(2));

      const proposal: ChangeProposalRecord = {
        id: crypto.randomUUID(),
        scheduleId: target.id,
        termCode: args.termCode,
        status: "PENDING",
        summary: `Move ${targetEntry.offeringCode} to ${afterEntry.weekday} ${afterEntry.startMin}-${afterEntry.endMin} in ${afterEntry.roomCode} (${afterEntry.facultyCode})`,
        offeringCode: targetEntry.offeringCode,
        meetingIndex: args.meetingIndex,
        beforeEntry: targetEntry,
        afterEntry,
        qualityDelta,
        resultingQualityScore: newScore,
        valid: valRes.valid && valRes.hard_violation_count === 0,
        createdBy: actor,
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      state.proposals.set(proposal.id, proposal);

      const payload = {
        proposalId: proposal.id,
        scheduleId: proposal.scheduleId,
        summary: proposal.summary,
        offeringCode: proposal.offeringCode,
        meetingIndex: proposal.meetingIndex,
        beforeEntry: proposal.beforeEntry,
        afterEntry: proposal.afterEntry,
        qualityDelta: proposal.qualityDelta,
        resultingQualityScore: proposal.resultingQualityScore,
        valid: proposal.valid,
        status: proposal.status,
      };

      return {
        toolName,
        rawResult: payload,
        sanitizedResultForLlm: serializeToolResultForLlm(payload),
        structuredPart: {
          kind: "proposal_card",
          title: `Change Proposal — ${proposal.offeringCode}`,
          data: payload,
        },
      };
    }
  }
}
