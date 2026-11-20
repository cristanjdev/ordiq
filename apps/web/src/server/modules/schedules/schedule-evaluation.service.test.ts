import { afterEach, describe, expect, it } from "vitest";
import { resolveTargetSchedule } from "../analytics/analytics.service";
import {
  createEmptyMasterDataState,
  replaceMasterDataState,
  resetMasterDataState,
} from "../master-data/master-data.store";
import { evaluateSchedule } from "./schedule-evaluation.service";

const TERM = "AY2026-2027-S1";

function entry(id: string, offeringCode: string, facultyCode: string, roomCode: string, startMin: number) {
  return { id, offeringCode, facultyCode, roomCode, weekday: "MONDAY", startMin, endMin: startMin + 90, pinned: false };
}

function seed() {
  const state = createEmptyMasterDataState();
  state.terms.set(TERM, { code: TERM, teachingDays: ["MONDAY"], dayStartMin: 450, dayEndMin: 1230 } as never);
  state.faculty.set("F1", { code: "F1", name: "Engr. Ana Reyes", alias: "Faculty A", maxLoadUnits: 3 } as never);
  state.faculty.set("F2", { code: "F2", name: "Engr. Ben Cruz", alias: "Faculty B", maxLoadUnits: 21 } as never);
  state.subjects.set("CE101", { code: "CE101", units: 3 } as never);
  state.subjects.set("CE102", { code: "CE102", units: 3 } as never);
  state.sections.set("CE-1A", { code: "CE-1A", studentCount: 45 } as never);
  state.sections.set("CE-1B", { code: "CE-1B", studentCount: 20 } as never);
  state.rooms.set("R1", { code: "R1", capacity: 40 } as never);
  state.rooms.set("R2", { code: "R2", capacity: 40 } as never);
  state.offerings.set("O1", { code: "O1", subjectCode: "CE101", sectionCode: "CE-1A" } as never);
  state.offerings.set("O2", { code: "O2", subjectCode: "CE102", sectionCode: "CE-1A" } as never);
  state.offerings.set("O3", { code: "O3", subjectCode: "CE101", sectionCode: "CE-1B" } as never);

  state.schedules.set("S1", {
    id: "S1",
    termCode: TERM,
    candidateLabel: "Optimal Schedule",
    status: "CANDIDATE",
    source: "GENERATED",
    recheckNeeded: false,
    version: 1,
    qualityScore: 90,
    entries: [
      // F1 teaches 6 units over a regular 3; R1 holds CE-1A (45 students, 40 seats).
      entry("e1", "O1", "F1", "R1", 450),
      entry("e2", "O1", "F1", "R1", 600),
      entry("e3", "O2", "F1", "R1", 750),
      entry("e4", "O3", "F2", "R2", 450),
    ],
    unscheduled: [{ offeringCode: "O3", meetingIndex: 1, reasonCode: "NO_COMMON_SLOT", reasonDetail: "No shared free time." }],
    validationReport: {
      valid: false,
      hard_violation_count: 1,
      waived_violation_count: 2,
      violations: [
        { code: "HC-99", message: "Raw finding", waivable: true, waived: false },
        // Already listed under Unscheduled classes, so not repeated as a conflict.
        { code: "HC-08", message: "Missing meetings", waivable: true, waived: false, offering_codes: ["O3"] },
        { code: "HC-16", message: "Evening", waivable: true, waived: true, waiver_reason: "Approved by the Dean" },
        { code: "HC-16", message: "Evening", waivable: true, waived: true, waiver_reason: "Approved by the Dean" },
      ],
      quality: {
        quality_score: 90,
        total_penalty: 10,
        unmet_preferences: [
          { code: "SC-01", description: "Faculty A prefers mornings.", faculty_code: "F1", penalty: 5 },
          { code: "SC-03", description: "A long gap between classes.", penalty: 5 },
        ],
      },
    },
  } as never);
  replaceMasterDataState(state);
  return state;
}

afterEach(() => resetMasterDataState());

describe("evaluateSchedule", () => {
  it("lists unsatisfied rules and unscheduled classes", () => {
    seed();
    const ev = evaluateSchedule("S1");
    expect(ev.unsatisfied.conflicts).toEqual([{ rule: expect.any(String), description: "Raw finding" }]);
    expect(ev.unsatisfied.unscheduled).toEqual([
      expect.objectContaining({ subjectCode: "CE101", sectionCode: "CE-1B", detail: "No shared free time." }),
    ]);
    expect(ev.counts.unsatisfied).toBe(2);
  });

  it("flags overloaded faculty, overfilled rooms, waivers and unmet faculty preferences", () => {
    seed();
    const ev = evaluateSchedule("S1");
    // F2 (3 of 21 units) is fine.
    expect(ev.risks.facultyLoad.map((f) => [f.facultyCode, f.level])).toEqual([["F1", "OVERLOAD"]]);
    // R1 is listed once per class group, not once per meeting; CE-1B in R2 (20 of 40) is fine.
    expect(ev.risks.roomCapacity.map((r) => [r.roomCode, r.students, r.subjectCodes.join()])).toEqual([
      ["R1", 45, "CE101"],
      ["R1", 45, "CE102"],
    ]);
    expect(ev.risks.waivedExceptions).toEqual([
      expect.objectContaining({ reason: "Approved by the Dean", occurrences: 2 }),
    ]);
    // Only faculty preferences count; other soft goals (gaps) are not conflicts of interest.
    expect(ev.risks.unmetFacultyPreferences).toEqual([{ facultyCode: "F1", description: "Faculty A prefers mornings." }]);
  });

  it("reports a missing schedule as not found", () => {
    seed();
    expect(() => evaluateSchedule("nope")).toThrow(/could not be found/);
  });
});

describe("resolveTargetSchedule", () => {
  it("prefers the newest generated draft over an older, higher-scoring one", () => {
    const state = seed();
    state.schedules.set("S2", {
      ...(state.schedules.get("S1") as object),
      id: "S2",
      qualityScore: 70,
    } as never);
    expect(resolveTargetSchedule(TERM)?.id).toBe("S2");
  });
});
