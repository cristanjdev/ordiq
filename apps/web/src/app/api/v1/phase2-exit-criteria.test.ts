import { beforeEach, describe, expect, it } from "vitest";
import { EngineClient } from "../../../server/engine/engine.client";
import {
  generateMediumCollegeFixture,
  generateSmallFixture,
  loadFixtureIntoStore,
} from "../../../server/modules/fixtures/fixture.generator";
import {
  checkExistingSchedule,
  runScheduleGeneration,
} from "../../../server/modules/generation/generation.service";
import { upsertRoom } from "../../../server/modules/master-data/master-data.service";
import {
  getMasterDataState,
  resetMasterDataState,
} from "../../../server/modules/master-data/master-data.store";
import { setAuditSinkForTests } from "../../../server/platform/audit";

describe("Phase 2: Scheduling Engine & Web Integration Exit Criteria", () => {
  beforeEach(() => {
    resetMasterDataState();
    setAuditSinkForTests({
      async write(input) {
        return {
          ...input,
          id: crypto.randomUUID(),
          createdAt: new Date(),
        };
      },
    });
  });

  it(
    "Exit Criteria 1, 4, 5, 7, 8: Imported manual schedule conflict check, 3-profile candidate generation on small & medium fixtures, and room capacity change revalidation",
    async () => {
      const small = generateSmallFixture();
      await loadFixtureIntoStore(small, { actor: "dean" });

      // Exit Criterion 4: Imported manual schedule produces a conflict/quality report
      const importedSched = Array.from(
        getMasterDataState().schedules.values(),
      )[0];
      if (!importedSched) throw new Error("Expected imported schedule");
      const checked = await checkExistingSchedule(importedSched.id);
      expect(checked.validation).toBeDefined();
      expect(checked.schedule.qualityScore).toBeGreaterThan(0);

      // Generate 3 candidates from weight profiles (D-19: BALANCED, FACULTY_FIRST, STUDENT_FIRST)
      const genSmall = await runScheduleGeneration(small.term.code, {
        profiles: ["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"],
        timeLimitSeconds: 5,
      });
      expect(genSmall.run.status).toBe("DONE");
      expect(genSmall.candidates).toHaveLength(3);
      for (const cand of genSmall.candidates) {
        expect(cand.validationReport?.valid).toBe(true);
        expect(cand.validationReport?.hard_violation_count).toBe(0);
        expect(cand.unscheduled).toEqual([]);
      }

      // Exit Criterion 5: Changing a room's capacity flags affected schedules with recheckNeeded = true
      // and re-checking surfaces the exact HC-04 room capacity violations
      const firstCandidate = genSmall.candidates[0];
      if (!firstCandidate) throw new Error("Expected first candidate");
      const usedRoomCode = firstCandidate.entries[0]?.roomCode ?? "EN-LEC-01";
      await upsertRoom(
        {
          code: usedRoomCode,
          name: "Shrunk Room",
          type: "LECTURE",
          capacity: 10, // Smaller than section studentCount (38-42)
          equipment: [],
          restrictions: "",
          status: "ACTIVE",
        },
        { actor: "dean" },
      );

      expect(
        getMasterDataState().schedules.get(firstCandidate.id)?.recheckNeeded,
      ).toBe(true);

      const rechecked = await checkExistingSchedule(firstCandidate.id);
      expect(rechecked.schedule.recheckNeeded).toBe(false);
      expect(rechecked.validation.valid).toBe(false);
      expect(
        rechecked.validation.violations.some(
          (v) => v.code === "HC-04" && v.room_codes?.includes(usedRoomCode),
        ),
      ).toBe(true);

      // Exit Criterion 7 & 8: Medium college fixture solves within SOLVER_TIME_LIMIT_SECONDS with 0 violations
      const medium = generateMediumCollegeFixture();
      await loadFixtureIntoStore(medium, { actor: "dean" });
      const genMedium = await runScheduleGeneration(medium.term.code, {
        profiles: ["BALANCED"],
        timeLimitSeconds: 10,
      });
      expect(genMedium.run.status).toBe("DONE");
      expect(genMedium.candidates[0]?.validationReport?.valid).toBe(true);
      expect(
        genMedium.candidates[0]?.validationReport?.hard_violation_count,
      ).toBe(0);
    },
    60_000,
  );

  it(
    "Phase 2D: Marks run as SOLVER_MODEL_BUG if the independent validator rejects solver output",
    async () => {
      const small = generateSmallFixture();
      await loadFixtureIntoStore(small, { actor: "dean" });

      // Create a mock EngineClient where solver returns a double-booked entry (HC-01)
      // and independent validator flags HC-01
      const buggyClient = {
        async startSolveJob() {
          return {
            job_id: "job-buggy",
            status: "DONE",
            progress_pct: 100,
            solution: {
              status: "PROVEN_OPTIMAL",
              profile_name: "BALANCED",
              entries: [
                {
                  id: "E1",
                  offering_code: small.offerings[0]?.code ?? "OFF-1",
                  meeting_index: 0,
                  faculty_code: small.faculty[0]?.code ?? "FAC-001",
                  room_code: small.rooms[0]?.code ?? "EN-LEC-01",
                  weekday: "MONDAY",
                  start_min: 450,
                  end_min: 540,
                  pinned: false,
                },
                {
                  id: "E2",
                  offering_code: small.offerings[1]?.code ?? "OFF-2",
                  meeting_index: 0,
                  faculty_code: small.faculty[0]?.code ?? "FAC-001",
                  room_code: small.rooms[1]?.code ?? "EN-LEC-02",
                  weekday: "MONDAY",
                  start_min: 450,
                  end_min: 540,
                  pinned: false,
                },
              ],
              unscheduled: [],
            },
          };
        },
        async validateSchedule(
          req: Parameters<EngineClient["validateSchedule"]>[0],
        ) {
          const realClient = new EngineClient();
          return realClient.validateSchedule(req);
        },
      } as unknown as EngineClient;

      await expect(
        runScheduleGeneration(small.term.code, {
          profiles: ["BALANCED"],
          engineClient: buggyClient,
        }),
      ).rejects.toMatchObject({
        code: "SOLVER_MODEL_BUG",
      });

      const runs = Array.from(getMasterDataState().generationRuns.values());
      expect(runs[0]?.status).toBe("SOLVER_MODEL_BUG");
    },
    20_000,
  );
});
