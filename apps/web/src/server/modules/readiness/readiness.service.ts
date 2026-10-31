import { getMasterDataState } from "../master-data/master-data.store";

export type Iso25012Dimension =
  | "completeness"
  | "accuracy"
  | "consistency"
  | "currentness";

export type ReadinessSeverity = "CRITICAL" | "WARNING";

export interface ReadinessIssue {
  code:
    | "EMPTY_TERM_OFFERINGS"
    | "MISSING_FACULTY_AVAILABILITY"
    | "SUBJECT_NO_QUALIFIED_FACULTY"
    | "SECTION_EXCEEDS_ROOM_CAPACITY"
    | "REQUIRED_HOURS_EXCEED_FACULTY_CAPACITY"
    | "REQUIRED_HOURS_EXCEED_ROOM_CAPACITY"
    | "OFFERING_CONTACT_HOURS_MISMATCH"
    | "OUTDATED_CURRICULUM_RECORD";
  severity: ReadinessSeverity;
  dimension: Iso25012Dimension;
  entityCode: string;
  message: string;
}

export interface Iso25012Scores {
  completeness: number;
  accuracy: number;
  consistency: number;
  currentness: number;
  overall: number;
}

export interface TermReadinessReport {
  termCode: string;
  canGenerate: boolean;
  criticalCount: number;
  warningCount: number;
  iso25012Scores: Iso25012Scores;
  counts: {
    programs: number;
    faculty: number;
    subjects: number;
    sections: number;
    rooms: number;
    offerings: number;
    fixedBlocks: number;
  };
  issues: ReadinessIssue[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Computes the Phase 1D Data Readiness Report for a term across ISO/IEC 25012
 * quality dimensions (completeness, accuracy, consistency, currentness).
 * Blocks schedule generation (`canGenerate = false`) whenever any CRITICAL issue exists.
 */
export function getTermReadinessReport(
  termCode = "AY2026-2027-S1",
): TermReadinessReport {
  const store = getMasterDataState();
  const issues: ReadinessIssue[] = [];

  const term = store.terms.get(termCode);
  const activeFaculty = Array.from(store.faculty.values()).filter(
    (f) => f.status === "ACTIVE",
  );
  const subjects = Array.from(store.subjects.values());
  const sections = Array.from(store.sections.values());
  const activeRooms = Array.from(store.rooms.values()).filter(
    (r) => r.status === "ACTIVE",
  );
  const offerings = Array.from(store.offerings.values()).filter(
    (o) => o.termCode === termCode,
  );
  const fixedBlocks = Array.from(store.fixedBlocks.values()).filter(
    (b) => b.termCode === termCode,
  );
  const availability = Array.from(store.facultyAvailability.values()).filter(
    (a) => a.termCode === termCode && a.status === "AVAILABLE",
  );
  const qualifications = Array.from(store.facultyQualifications.values());

  // 1. Check empty offerings (Completeness - CRITICAL)
  if (offerings.length === 0) {
    issues.push({
      code: "EMPTY_TERM_OFFERINGS",
      severity: "CRITICAL",
      dimension: "completeness",
      entityCode: termCode,
      message: `No course offerings are registered for term ${termCode}.`,
    });
  }

  // 2. Check missing faculty availability (Completeness - WARNING or CRITICAL)
  const facultyWithAvailability = new Set(
    availability.map((a) => a.facultyCode),
  );
  for (const fac of activeFaculty) {
    if (!facultyWithAvailability.has(fac.code)) {
      issues.push({
        code: "MISSING_FACULTY_AVAILABILITY",
        severity: "WARNING",
        dimension: "completeness",
        entityCode: fac.code,
        message: `Faculty member ${fac.code} (${fac.name}) has no declared AVAILABLE time windows for ${termCode}.`,
      });
    }
  }

  // 3. Check offered subjects with no qualified faculty (Completeness - CRITICAL)
  const activeFacultyCodes = new Set(activeFaculty.map((f) => f.code));
  const qualifiedSubjectCodes = new Set(
    qualifications
      .filter((q) => activeFacultyCodes.has(q.facultyCode))
      .map((q) => q.subjectCode),
  );
  const offeredSubjectCodes = new Set(offerings.map((o) => o.subjectCode));
  for (const subjCode of offeredSubjectCodes) {
    if (!qualifiedSubjectCodes.has(subjCode)) {
      issues.push({
        code: "SUBJECT_NO_QUALIFIED_FACULTY",
        severity: "CRITICAL",
        dimension: "completeness",
        entityCode: subjCode,
        message: `Offered subject ${subjCode} has no qualified active faculty member (HC-09).`,
      });
    }
  }

  // 4. Check sections larger than any suitable room (Consistency / Accuracy - CRITICAL)
  const maxLectureCap = Math.max(
    0,
    ...activeRooms
      .filter((r) => r.type === "LECTURE")
      .map((r) => r.capacity),
  );
  const maxLabCap = Math.max(
    0,
    ...activeRooms.filter((r) => r.type === "LAB").map((r) => r.capacity),
  );

  for (const off of offerings) {
    const sec = store.sections.get(off.sectionCode);
    if (!sec) continue;
    const maxCap =
      off.requiredRoomType === "LAB" ? maxLabCap : maxLectureCap;
    if (sec.studentCount > maxCap) {
      issues.push({
        code: "SECTION_EXCEEDS_ROOM_CAPACITY",
        severity: "CRITICAL",
        dimension: "accuracy",
        entityCode: off.code,
        message: `Section ${sec.code} (${sec.studentCount} students) exceeds the largest ${off.requiredRoomType} room capacity (${maxCap} seats) for offering ${off.code} (HC-04).`,
      });
    }
  }

  // 5. Check required contact hours above total faculty or room capacity (Consistency - CRITICAL)
  const totalRequiredMinutes = offerings.reduce(
    (sum, o) => sum + o.meetingsPerWeek * o.minutesPerMeeting,
    0,
  );
  const totalFacultyAvailableMinutes = activeFaculty.reduce(
    (sum, f) => sum + f.maxLoadHours * 60,
    0,
  );
  const teachingDaysCount = term?.teachingDays.length ?? 6;
  const minutesPerDay =
    (term?.dayEndMin ?? 1230) - (term?.dayStartMin ?? 450);
  const totalRoomAvailableMinutes =
    activeRooms.length * teachingDaysCount * Math.max(0, minutesPerDay);

  if (
    offerings.length > 0 &&
    totalRequiredMinutes > totalFacultyAvailableMinutes
  ) {
    issues.push({
      code: "REQUIRED_HOURS_EXCEED_FACULTY_CAPACITY",
      severity: "CRITICAL",
      dimension: "consistency",
      entityCode: termCode,
      message: `Total required offering hours (${(totalRequiredMinutes / 60).toFixed(1)} hrs) exceed total active faculty maximum load capacity (${(totalFacultyAvailableMinutes / 60).toFixed(1)} hrs).`,
    });
  }

  if (
    offerings.length > 0 &&
    totalRequiredMinutes > totalRoomAvailableMinutes
  ) {
    issues.push({
      code: "REQUIRED_HOURS_EXCEED_ROOM_CAPACITY",
      severity: "CRITICAL",
      dimension: "consistency",
      entityCode: termCode,
      message: `Total required offering hours (${(totalRequiredMinutes / 60).toFixed(1)} hrs) exceed total weekly room availability (${(totalRoomAvailableMinutes / 60).toFixed(1)} hrs).`,
    });
  }

  // 6. Check contact hours that do not match the subject (Consistency - WARNING)
  const minutesBySectionSubject = new Map<string, number>();
  for (const off of offerings) {
    const key = `${off.sectionCode}::${off.subjectCode}`;
    const prev = minutesBySectionSubject.get(key) ?? 0;
    minutesBySectionSubject.set(
      key,
      prev + off.meetingsPerWeek * off.minutesPerMeeting,
    );
  }
  for (const [key, scheduledMinutes] of minutesBySectionSubject.entries()) {
    const [sectionCode, subjectCode] = key.split("::") as [string, string];
    const subj = store.subjects.get(subjectCode);
    if (!subj) continue;
    const expectedMinutes = subj.contactHours * 60;
    if (scheduledMinutes !== expectedMinutes) {
      issues.push({
        code: "OFFERING_CONTACT_HOURS_MISMATCH",
        severity: "WARNING",
        dimension: "consistency",
        entityCode: `${sectionCode}:${subjectCode}`,
        message: `Offerings for section ${sectionCode} in subject ${subjectCode} total ${scheduledMinutes} min/week, but subject contactHours requires ${expectedMinutes} min/week (HC-08).`,
      });
    }
  }

  // 7. Flag outdated curriculum records (Currentness - WARNING)
  for (const subj of subjects) {
    if (!subj.isCurrentCurriculum) {
      issues.push({
        code: "OUTDATED_CURRICULUM_RECORD",
        severity: "WARNING",
        dimension: "currentness",
        entityCode: subj.code,
        message: `Subject ${subj.code} (${subj.name}, curriculum ${subj.curriculumVersion}) is marked as an outdated curriculum record.`,
      });
    }
  }

  const penaltyFor = (dim: Iso25012Dimension): number =>
    issues
      .filter((i) => i.dimension === dim)
      .reduce((acc, i) => acc + (i.severity === "CRITICAL" ? 25 : 8), 0);

  const completeness = clampScore(100 - penaltyFor("completeness"));
  const accuracy = clampScore(100 - penaltyFor("accuracy"));
  const consistency = clampScore(100 - penaltyFor("consistency"));
  const currentness = clampScore(100 - penaltyFor("currentness"));
  const overall = clampScore(
    (completeness + accuracy + consistency + currentness) / 4,
  );

  const criticalCount = issues.filter((i) => i.severity === "CRITICAL").length;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;

  return {
    termCode,
    canGenerate: criticalCount === 0 && offerings.length > 0,
    criticalCount,
    warningCount,
    iso25012Scores: {
      completeness,
      accuracy,
      consistency,
      currentness,
      overall,
    },
    counts: {
      programs: store.programs.size,
      faculty: activeFaculty.length,
      subjects: subjects.length,
      sections: sections.length,
      rooms: activeRooms.length,
      offerings: offerings.length,
      fixedBlocks: fixedBlocks.length,
    },
    issues,
  };
}

