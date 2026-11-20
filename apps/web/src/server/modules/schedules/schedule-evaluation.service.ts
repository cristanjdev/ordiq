import { hardConstraintLabel, unscheduledReasonLabel } from "@/lib/display-labels";
import { computeFacultyLoads } from "../analytics/analytics.service";
import {
  getMasterDataState,
  hasNoRoom,
  type MasterDataState,
  type ScheduleRecord,
} from "../master-data/master-data.store";
import { AppError } from "../../platform/errors";
import { describeViolation } from "./violation-text";

/*
 * Thresholds. Tried first at 90% on the college's real term: 40-student sections
 * in 40-seat rooms and part-time faculty at exactly 12 of 12 units are the norm
 * there, so 90% flagged nearly every class. Only what goes past the limit is listed.
 */
/** Faculty preference rules (preferred time / day, and the avoid-day request). */
const FACULTY_PREFERENCE_CODES = new Set(["SC-01", "SC-04"]);

export interface ScheduleEvaluationDto {
  scheduleId: string;
  candidateLabel: string;
  /** Rules the schedule does not meet. */
  unsatisfied: {
    conflicts: Array<{ rule: string; description: string }>;
    unscheduled: Array<{
      offeringCode: string;
      subjectCode: string;
      sectionCode: string;
      reason: string;
      detail: string;
    }>;
  };
  /** Not rule breaks, but worth the Dean's attention before accepting. */
  risks: {
    facultyLoad: Array<{
      facultyCode: string;
      facultyName: string;
      assignedUnits: number;
      regularMaxUnits: number;
      utilizationPct: number;
      /** OVERLOAD: above the regular load; OVER_MAX: above the regular load plus the allowed overload. */
      level: "OVER_MAX" | "OVERLOAD";
    }>;
    roomCapacity: Array<{
      roomCode: string;
      seats: number;
      students: number;
      sectionCodes: string[];
      subjectCodes: string[];
    }>;
    waivedExceptions: Array<{ rule: string; reason: string; occurrences: number }>;
    unmetFacultyPreferences: Array<{ facultyCode: string | null; description: string }>;
  };
  counts: {
    unsatisfied: number;
    risks: number;
  };
}

function unsatisfiedConflicts(sched: ScheduleRecord, state: MasterDataState) {
  // A class with unplaced meetings is listed once, under Unscheduled classes,
  // not again as an HC-08 "not all weekly meetings scheduled" conflict.
  const unscheduledOfferings = new Set((sched.unscheduled ?? []).map((u) => u.offeringCode));
  return (sched.validationReport?.violations ?? [])
    .filter((v) => !v.waived)
    .filter(
      (v) =>
        !(
          v.code === "HC-08" &&
          (v.offering_codes ?? []).length > 0 &&
          (v.offering_codes ?? []).every((code) => unscheduledOfferings.has(code))
        ),
    )
    .map((v) => ({
      rule: hardConstraintLabel(v.code),
      description: describeViolation(v, state, sched.entries),
    }));
}

function unscheduledClasses(sched: ScheduleRecord, state: MasterDataState) {
  return (sched.unscheduled ?? []).map((u) => {
    const off = state.offerings.get(u.offeringCode);
    return {
      offeringCode: u.offeringCode,
      subjectCode: off?.subjectCode ?? "",
      sectionCode: off?.sectionCode ?? "",
      reason: unscheduledReasonLabel(u.reasonCode),
      detail: u.reasonDetail,
    };
  });
}

/**
 * Rooms holding more students than seats (possible only where the Dean waived
 * the capacity rule, or in an edited schedule). Classes meeting together in the
 * same room and time (combined classes) are added up. Each room and class group
 * is listed once, however many times it meets.
 */
function roomCapacityRisks(sched: ScheduleRecord, state: MasterDataState) {
  const slots = new Map<string, Set<string>>();
  for (const e of sched.entries) {
    if (hasNoRoom(e)) continue;
    const key = `${e.roomCode}|${e.weekday}|${e.startMin}`;
    const set = slots.get(key) ?? new Set<string>();
    set.add(e.offeringCode);
    slots.set(key, set);
  }

  const seen = new Set<string>();
  const risks: ScheduleEvaluationDto["risks"]["roomCapacity"] = [];
  for (const [key, offeringCodes] of slots) {
    const roomCode = key.split("|")[0] ?? "";
    const room = state.rooms.get(roomCode);
    if (!room || room.capacity <= 0) continue;
    const groupKey = `${roomCode}|${[...offeringCodes].sort().join(",")}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);

    const sectionCodes = new Set<string>();
    const subjectCodes = new Set<string>();
    for (const code of offeringCodes) {
      const off = state.offerings.get(code);
      if (!off) continue;
      sectionCodes.add(off.sectionCode);
      subjectCodes.add(off.subjectCode);
    }
    const students = [...sectionCodes].reduce(
      (sum, code) => sum + (state.sections.get(code)?.studentCount ?? 0),
      0,
    );
    if (students <= room.capacity) continue;
    risks.push({
      roomCode,
      seats: room.capacity,
      students,
      sectionCodes: [...sectionCodes].sort(),
      subjectCodes: [...subjectCodes].sort(),
    });
  }
  return risks.sort((a, b) => b.students / b.seats - a.students / a.seats || a.roomCode.localeCompare(b.roomCode));
}

function facultyLoadRisks(sched: ScheduleRecord) {
  return computeFacultyLoads(sched.termCode, sched.id)
    .filter((f) => f.assignedUnits > f.regularMaxUnits)
    .map((f) => ({
      facultyCode: f.facultyCode,
      facultyName: f.facultyName,
      assignedUnits: f.assignedUnits,
      regularMaxUnits: f.regularMaxUnits,
      utilizationPct: f.utilizationPct,
      level: f.statusLabel === "EXCEEDS_MAX" ? ("OVER_MAX" as const) : ("OVERLOAD" as const),
    }))
    .sort((a, b) => b.utilizationPct - a.utilizationPct);
}

/** Waived rule findings, one line per rule and written reason. */
function waivedExceptions(sched: ScheduleRecord) {
  const grouped = new Map<string, { rule: string; reason: string; occurrences: number }>();
  for (const v of sched.validationReport?.violations ?? []) {
    if (!v.waived) continue;
    const reason = v.waiver_reason?.trim() || "No reason recorded";
    const key = `${v.code}|${reason}`;
    const cur = grouped.get(key) ?? { rule: hardConstraintLabel(v.code), reason, occurrences: 0 };
    cur.occurrences += 1;
    grouped.set(key, cur);
  }
  return [...grouped.values()].sort((a, b) => b.occurrences - a.occurrences);
}

function unmetFacultyPreferences(sched: ScheduleRecord) {
  return (sched.validationReport?.quality.unmet_preferences ?? [])
    .filter((p) => FACULTY_PREFERENCE_CODES.has(p.code))
    .map((p) => ({ facultyCode: p.faculty_code ?? null, description: p.description }));
}

/**
 * Evaluation of one schedule for the Dean: the rules it does not meet, and the
 * scheduling risks (heavy faculty loads, nearly full rooms, waived exceptions,
 * unmet faculty preferences) worth checking before accepting it.
 */
export function evaluateSchedule(scheduleId: string): ScheduleEvaluationDto {
  const state = getMasterDataState();
  const sched = state.schedules.get(scheduleId);
  if (!sched) {
    throw new AppError("SCHEDULE_NOT_FOUND", "This schedule could not be found.", 404);
  }

  const unsatisfied = {
    conflicts: unsatisfiedConflicts(sched, state),
    unscheduled: unscheduledClasses(sched, state),
  };
  const risks = {
    facultyLoad: facultyLoadRisks(sched),
    roomCapacity: roomCapacityRisks(sched, state),
    waivedExceptions: waivedExceptions(sched),
    unmetFacultyPreferences: unmetFacultyPreferences(sched),
  };
  return {
    scheduleId: sched.id,
    candidateLabel: sched.candidateLabel,
    unsatisfied,
    risks,
    counts: {
      unsatisfied: unsatisfied.conflicts.length + unsatisfied.unscheduled.length,
      risks:
        risks.facultyLoad.length +
        risks.roomCapacity.length +
        risks.waivedExceptions.length +
        risks.unmetFacultyPreferences.length,
    },
  };
}
