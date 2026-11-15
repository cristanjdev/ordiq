import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "../../platform/audit";
import { computeScheduleAnalytics } from "../analytics/analytics.service";
import { generateSmallFixture } from "../fixtures/fixture.generator";
import { getMasterDataState, resetMasterDataState } from "../master-data/master-data.store";
import {
  buildWorkbookBuffer,
  importWorkbookPayload,
  parseWorkbookBuffer,
  type WorkbookSheetsPayload,
} from "./imports.service";

function payloadWithPastSchedule(
  pastSchedule: (fixture: ReturnType<typeof generateSmallFixture>) => object[],
): WorkbookSheetsPayload {
  const small = generateSmallFixture();
  return {
    termCode: small.term.code,
    programs: small.programs,
    faculty: small.faculty,
    subjects: small.subjects,
    sections: small.sections,
    rooms: small.rooms,
    offerings: small.offerings,
    fixedBlocks: small.fixedBlocks,
    facultyAvailability: small.facultyAvailability,
    facultyQualifications: small.facultyQualifications,
    facultyPreferences: small.facultyPreferences,
    pastSchedule: pastSchedule(small),
  };
}

describe("PastSchedule import with blank faculty or room", () => {
  beforeEach(() => {
    resetMasterDataState();
    setAuditSinkForTests({
      write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }),
    });
  });

  afterEach(() => {
    setAuditSinkForTests(null);
  });

  it("keeps blanks blank, counts the classes as scheduled, and reports load balance as unavailable", async () => {
    const payload = payloadWithPastSchedule((small) =>
      small.pastSchedule.map((row) => ({ ...row, facultyCode: "", roomCode: "" })),
    );
    // Round-trip through a real .xlsx so blank cells are exercised as they arrive from a file.
    const parsed = await parseWorkbookBuffer(await buildWorkbookBuffer(payload), payload.termCode);
    const result = await importWorkbookPayload(parsed, { actor: "dean" });

    expect(result.errors).toEqual([]);
    expect(result.status).toBe("COMMITTED");
    const imported = [...getMasterDataState().schedules.values()].find((s) => s.source === "IMPORTED");
    if (!imported) throw new Error("expected an imported schedule");
    expect(imported.entries.length).toBe(payload.pastSchedule?.length);
    expect(imported.entries.every((e) => e.facultyCode === "" && e.roomCode === "")).toBe(true);

    const { metrics } = computeScheduleAnalytics(payload.termCode, imported.id);
    expect(metrics.classesScheduled).toBe(imported.entries.length);
    expect(metrics.meetingsWithoutFaculty).toBe(imported.entries.length);
    expect(metrics.meetingsWithoutRoom).toBe(imported.entries.length);
    expect(metrics.facultyLoadBalanceScore).toBeNull();
    expect(metrics.averageFacultyUtilizationPct).toBeNull();
  });

  it("still rejects a faculty or room code that does not exist", async () => {
    const payload = payloadWithPastSchedule((small) => [
      { ...small.pastSchedule[0], facultyCode: "NO-SUCH-FACULTY" },
      { ...small.pastSchedule[1], roomCode: "NO-SUCH-ROOM" },
    ]);
    const result = await importWorkbookPayload(payload, { actor: "dean" });

    expect(result.status).toBe("FAILED");
    expect(result.errors.map((e) => `${e.sheet}.${e.column}`).sort()).toEqual([
      "PastSchedule.facultyCode",
      "PastSchedule.roomCode",
    ]);
  });
});
