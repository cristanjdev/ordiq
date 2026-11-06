import {
  getMasterDataState,
  type ScheduleRecord,
} from "../master-data/master-data.store";
import { getTermReadinessReport } from "../readiness/readiness.service";
import { describeViolation } from "../schedules/violation-text";

export interface FacultyLoadItemDto {
  facultyCode: string;
  facultyName: string;
  facultyAlias: string;
  programCode: string;
  employmentType: string;
  regularMaxUnits: number;
  maxOverloadUnits: number;
  assignedUnits: number;
  overloadUnits: number;
  preparationsCount: number;
  utilizationPct: number;
  statusLabel: "UNDERLOAD" | "OPTIMAL" | "OVERLOAD" | "EXCEEDS_MAX";
}

export interface RoomUtilizationItemDto {
  roomCode: string;
  roomName: string;
  roomType: "LECTURE" | "LAB";
  capacity: number;
  usedMinutes: number;
  availableMinutes: number;
  utilizationPct: number;
  meetingCount: number;
}

export interface StudentChangeRequestRiskDto {
  sectionConflictCount: number;
  unscheduledMeetingCount: number;
  unmetApprovedPreferenceCount: number;
  totalRiskIndicators: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH";
  baselineMethodNote: string;
}

export interface ManualComparisonDto {
  manualScheduleId: string;
  manualCandidateLabel: string;
  manualHardViolations: number;
  currentHardViolations: number;
  manualUnscheduledCount: number;
  currentUnscheduledCount: number;
  manualQualityScore: number;
  currentQualityScore: number;
  hardViolationsEliminated: number;
}

export interface ScheduleAnalyticsReportDto {
  termCode: string;
  scheduleId: string | null;
  candidateLabel: string;
  status: string;
  source: string;
  version: number;
  metrics: {
    classesScheduled: number;
    totalMeetings: number;
    scheduledPct: number;
    conflictsDetected: number;
    waivedExceptionsCount: number;
    facultyLoadBalanceScore: number;
    averageFacultyUtilizationPct: number;
    roomUtilizationPct: number;
    qualityScore: number;
    unmetPreferencesCount: number;
  };
  metricFormulas: {
    classesScheduled: string;
    conflictsDetected: string;
    facultyLoadBalanceScore: string;
    roomUtilizationPct: string;
    studentChangeRequestRisk: string;
  };
  facultyLoads: FacultyLoadItemDto[];
  roomUtilizations: RoomUtilizationItemDto[];
  topConflicts: Array<{
    constraintId: string;
    severity: "HARD" | "SOFT";
    message: string;
    /** Plain-language sentence for the Dean. */
    description: string;
    waived: boolean;
  }>;
  studentChangeRequestRisk: StudentChangeRequestRiskDto;
  dataReadiness: {
    canGenerate: boolean;
    criticalCount: number;
    warningCount: number;
    overallScore: number;
  };
  manualComparison: ManualComparisonDto | null;
}

/**
 * Resolve the target schedule for analytics:
 * 1. Explicit `scheduleId` if provided
 * 2. Otherwise the `ACCEPTED` schedule for `termCode`
 * 3. Otherwise the highest-quality `GENERATED` candidate for `termCode`
 * 4. Otherwise any schedule for `termCode`
 */
export function resolveTargetSchedule(
  termCode: string,
  scheduleId?: string | null,
): ScheduleRecord | null {
  const state = getMasterDataState();
  if (scheduleId) {
    return state.schedules.get(scheduleId) ?? null;
  }
  const termSchedules = Array.from(state.schedules.values()).filter(
    (s) => s.termCode === termCode,
  );
  if (termSchedules.length === 0) return null;

  const accepted = termSchedules.find((s) => s.status === "ACCEPTED");
  if (accepted) return accepted;

  const generated = termSchedules
    .filter((s) => s.source === "GENERATED")
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
  if (generated[0]) return generated[0];

  return termSchedules[0] ?? null;
}

/**
 * Single source of truth for faculty load figures across Dashboard, AI tools, and Reports.
 */
export function computeFacultyLoads(
  termCode: string,
  scheduleId?: string | null,
  facultyCodeFilter?: string | null,
): FacultyLoadItemDto[] {
  const state = getMasterDataState();
  const sched = resolveTargetSchedule(termCode, scheduleId);
  const entries = sched?.entries ?? [];

  const facultyOfferings = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.facultyCode === "EXTERNAL") continue;
    const set = facultyOfferings.get(entry.facultyCode) ?? new Set<string>();
    set.add(entry.offeringCode);
    facultyOfferings.set(entry.facultyCode, set);
  }

  const results: FacultyLoadItemDto[] = [];
  for (const fac of state.faculty.values()) {
    if (facultyCodeFilter && fac.code !== facultyCodeFilter) continue;
    const assignedOfferingCodes =
      facultyOfferings.get(fac.code) ?? new Set<string>();
    let assignedUnits = 0;
    const distinctSubjects = new Set<string>();

    for (const offCode of assignedOfferingCodes) {
      const off = state.offerings.get(offCode);
      if (!off) continue;
      distinctSubjects.add(off.subjectCode);
      const subj = state.subjects.get(off.subjectCode);
      assignedUnits += subj?.units ?? 3;
    }

    const regularMaxUnits = fac.maxLoadUnits || 21;
    const maxOverloadUnits = 6;
    const overloadUnits = Math.max(0, assignedUnits - regularMaxUnits);
    const utilizationPct =
      regularMaxUnits > 0
        ? Number(((assignedUnits / regularMaxUnits) * 100).toFixed(1))
        : 0;

    let statusLabel: FacultyLoadItemDto["statusLabel"] = "OPTIMAL";
    if (assignedUnits > regularMaxUnits + maxOverloadUnits) {
      statusLabel = "EXCEEDS_MAX";
    } else if (assignedUnits > regularMaxUnits) {
      statusLabel = "OVERLOAD";
    } else if (utilizationPct < 50) {
      statusLabel = "UNDERLOAD";
    }

    results.push({
      facultyCode: fac.code,
      facultyName: fac.name,
      facultyAlias: fac.alias,
      programCode: fac.programCode ?? "GEN",
      employmentType: fac.employmentType,
      regularMaxUnits,
      maxOverloadUnits,
      assignedUnits,
      overloadUnits,
      preparationsCount: distinctSubjects.size,
      utilizationPct,
      statusLabel,
    });
  }

  return results.sort((a, b) => a.facultyCode.localeCompare(b.facultyCode));
}

/**
 * Single source of truth for room utilization figures across Dashboard, AI tools, and Reports.
 */
export function computeRoomUtilizations(
  termCode: string,
  scheduleId?: string | null,
  roomCodeFilter?: string | null,
): RoomUtilizationItemDto[] {
  const state = getMasterDataState();
  const term = state.terms.get(termCode);
  const sched = resolveTargetSchedule(termCode, scheduleId);
  const entries = sched?.entries ?? [];

  const teachingDaysCount = term?.teachingDays.length ?? 6;
  const dailyMinutes = Math.max(
    60,
    (term?.dayEndMin ?? 1230) - (term?.dayStartMin ?? 450),
  );
  const availableMinutes = teachingDaysCount * dailyMinutes;

  const roomMinutes = new Map<string, { minutes: number; count: number }>();
  for (const entry of entries) {
    if (entry.roomCode === "EXTERNAL") continue;
    const duration = Math.max(0, entry.endMin - entry.startMin);
    const cur = roomMinutes.get(entry.roomCode) ?? { minutes: 0, count: 0 };
    cur.minutes += duration;
    cur.count += 1;
    roomMinutes.set(entry.roomCode, cur);
  }

  const results: RoomUtilizationItemDto[] = [];
  for (const room of state.rooms.values()) {
    if (roomCodeFilter && room.code !== roomCodeFilter) continue;
    const usage = roomMinutes.get(room.code) ?? { minutes: 0, count: 0 };
    const utilizationPct = Number(
      Math.min(100, (usage.minutes / availableMinutes) * 100).toFixed(1),
    );
    results.push({
      roomCode: room.code,
      roomName: room.name,
      roomType: room.type,
      capacity: room.capacity,
      usedMinutes: usage.minutes,
      availableMinutes,
      utilizationPct,
      meetingCount: usage.count,
    });
  }

  return results.sort((a, b) => a.roomCode.localeCompare(b.roomCode));
}

/**
 * Compute comprehensive schedule analytics for Dashboard, AI tools, and Reports.
 */
export function computeScheduleAnalytics(
  termCode: string,
  scheduleId?: string | null,
): ScheduleAnalyticsReportDto {
  const state = getMasterDataState();
  const sched = resolveTargetSchedule(termCode, scheduleId);
  const readiness = getTermReadinessReport(termCode);
  const facultyLoads = computeFacultyLoads(termCode, sched?.id);
  const roomUtilizations = computeRoomUtilizations(termCode, sched?.id);

  let totalOfferingMeetings = 0;
  for (const off of state.offerings.values()) {
    if (off.termCode !== termCode) continue;
    totalOfferingMeetings += off.meetingsPerWeek;
  }

  const classesScheduled = (sched?.entries ?? []).filter(
    (e) => e.facultyCode !== "EXTERNAL",
  ).length;
  const unscheduledCount = sched?.unscheduled?.length ?? 0;
  const totalMeetings = Math.max(
    totalOfferingMeetings,
    classesScheduled + unscheduledCount,
  );
  const scheduledPct =
    totalMeetings > 0
      ? Number(((classesScheduled / totalMeetings) * 100).toFixed(1))
      : 0;

  const violations = sched?.validationReport?.violations ?? [];
  const unwaivedHardViolations = violations.filter((v) => !v.waived);
  const waivedExceptionsCount = (sched?.exceptions ?? []).length;

  const activeFacLoads = facultyLoads.filter((f) => f.assignedUnits > 0);
  const avgFacUtil =
    activeFacLoads.length > 0
      ? activeFacLoads.reduce((acc, f) => acc + f.utilizationPct, 0) /
        activeFacLoads.length
      : 0;
  const variance =
    activeFacLoads.length > 0
      ? activeFacLoads.reduce(
          (acc, f) => acc + Math.pow(f.utilizationPct - avgFacUtil, 2),
          0,
        ) / activeFacLoads.length
      : 0;
  const stdDev = Math.sqrt(variance);
  const facultyLoadBalanceScore =
    activeFacLoads.length > 0
      ? Number(Math.max(0, Math.min(100, 100 - stdDev)).toFixed(1))
      : 100;

  const avgRoomUtil =
    roomUtilizations.length > 0
      ? Number(
          (
            roomUtilizations.reduce((acc, r) => acc + r.utilizationPct, 0) /
            roomUtilizations.length
          ).toFixed(1),
        )
      : 0;

  const unmetPreferences =
    sched?.validationReport?.quality.unmet_preferences ?? [];

  const sectionConflicts = unwaivedHardViolations.filter(
    (v) => v.code === "HC-03",
  ).length;
  const totalRiskIndicators =
    sectionConflicts + unscheduledCount + unmetPreferences.length;
  const riskLevel: StudentChangeRequestRiskDto["riskLevel"] =
    sectionConflicts > 0 || unscheduledCount > 0
      ? "HIGH"
      : unmetPreferences.length > 5
        ? "MODERATE"
        : "LOW";

  const manualSched = Array.from(state.schedules.values()).find(
    (s) => s.termCode === termCode && s.source === "IMPORTED",
  );
  let manualComparison: ManualComparisonDto | null = null;
  if (manualSched && sched) {
    const manualHard =
      manualSched.validationReport?.hard_violation_count ??
      (manualSched.validationReport?.violations ?? []).filter((v) => !v.waived)
        .length;
    const currentHard = unwaivedHardViolations.length;
    manualComparison = {
      manualScheduleId: manualSched.id,
      manualCandidateLabel: manualSched.candidateLabel,
      manualHardViolations: manualHard,
      currentHardViolations: currentHard,
      manualUnscheduledCount: manualSched.unscheduled?.length ?? 0,
      currentUnscheduledCount: unscheduledCount,
      manualQualityScore: manualSched.qualityScore ?? 0,
      currentQualityScore: sched.qualityScore ?? 0,
      hardViolationsEliminated: Math.max(0, manualHard - currentHard),
    };
  }

  return {
    termCode,
    scheduleId: sched?.id ?? null,
    candidateLabel: sched?.candidateLabel ?? "No Candidate Selected",
    status: sched?.status ?? "NONE",
    source: sched?.source ?? "NONE",
    version: sched?.version ?? 0,
    metrics: {
      classesScheduled,
      totalMeetings,
      scheduledPct,
      conflictsDetected: unwaivedHardViolations.length,
      waivedExceptionsCount,
      facultyLoadBalanceScore,
      averageFacultyUtilizationPct: Number(avgFacUtil.toFixed(1)),
      roomUtilizationPct: avgRoomUtil,
      qualityScore: sched?.qualityScore ?? 0,
      unmetPreferencesCount: unmetPreferences.length,
    },
    metricFormulas: {
      classesScheduled:
        "Count of placed college class meetings divided by total required lecture/lab meetings across term offerings.",
      conflictsDetected:
        "Count of unwaived hard constraint violations (HC-01 to HC-15) verified by the independent Python validator.",
      facultyLoadBalanceScore:
        "100 minus the population standard deviation of assigned faculty teaching load utilization percentages (assignedUnits / regularMaxUnits * 100).",
      roomUtilizationPct:
        "Mean percentage of weekly scheduled room minutes divided by available teaching window minutes across all college rooms.",
      studentChangeRequestRisk:
        "Sum of section double-bookings (HC-03), unplaced meetings, and unmet approved preferences. Reported as raw indicator counts (not compared as a percentage against the manuscript's non-comparable 16.6% survey or 22-day portal rework figures).",
    },
    facultyLoads,
    roomUtilizations,
    // Unresolved conflicts first, so waived ones never push them out.
    topConflicts: [...unwaivedHardViolations, ...violations.filter((v) => v.waived)]
      .slice(0, 10)
      .map((v) => ({
      constraintId: v.code,
      severity: "HARD",
      message: v.message,
      description: describeViolation(v, state, sched?.entries ?? []),
      waived: v.waived ?? false,
    })),
    studentChangeRequestRisk: {
      sectionConflictCount: sectionConflicts,
      unscheduledMeetingCount: unscheduledCount,
      unmetApprovedPreferenceCount: unmetPreferences.length,
      totalRiskIndicators,
      riskLevel,
      baselineMethodNote:
        "Baseline care: The manuscript's 22-day rework figure includes portal encoding, and the 16.6% survey vs. 70% estimate of student change requests are not directly comparable. ORDIQ reports exact indicator counts only.",
    },
    dataReadiness: {
      canGenerate: readiness.canGenerate,
      criticalCount: readiness.criticalCount,
      warningCount: readiness.warningCount,
      overallScore: readiness.iso25012Scores.overall,
    },
    manualComparison,
  };
}
