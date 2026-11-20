import type { FormValues } from "@/components/ui/record-form-dialog";

/** The parts of a saved term that the next term's defaults are taken from. */
export interface TermDefaultsSource {
  code: string;
  academicYear: string;
  semester: 1 | 2;
  dayStartMin?: number;
  dayEndMin?: number;
  slotSizeMin?: number;
  teachingDays?: string[];
}

const ALL_TEACHING_DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** The latest term by code (codes sort by academic year, then semester). */
export function latestTerm<T extends { code: string }>(terms: readonly T[]): T | undefined {
  return [...terms].sort((a, b) => b.code.localeCompare(a.code))[0];
}

/**
 * Form values for the semester after `latest`: 1st → 2nd of the same year,
 * 2nd → 1st of the next year. Teaching hours and days carry over. The new
 * term starts as a Draft so it never replaces the Active term by itself.
 */
export function nextTermValues(latest: TermDefaultsSource | undefined): FormValues {
  const [y1, y2] = (latest?.academicYear ?? "2026-2027").split("-").map(Number);
  const nextSemester = latest?.semester === 1 ? 2 : 1;
  const year =
    latest?.semester === 2 && y1 !== undefined && y2 !== undefined
      ? `${y1 + 1}-${y2 + 1}`
      : (latest?.academicYear ?? "2026-2027");
  return {
    code: `AY${year}-S${nextSemester}`,
    academicYear: year,
    semester: String(nextSemester),
    status: "DRAFT",
    dayStartMin: latest?.dayStartMin ?? 450,
    dayEndMin: latest?.dayEndMin ?? 1230,
    slotSizeMin: latest?.slotSizeMin ?? 30,
    teachingDays: latest?.teachingDays ?? ALL_TEACHING_DAYS,
  };
}
