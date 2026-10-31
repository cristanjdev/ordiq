import { beforeEach, describe, expect, it } from "vitest";
import {
  generateSmallFixture,
  loadFixtureIntoStore,
} from "../../../server/modules/fixtures/fixture.generator";
import { runScheduleGeneration } from "../../../server/modules/generation/generation.service";
import { upsertRoom } from "../../../server/modules/master-data/master-data.service";
import { resetMasterDataState } from "../../../server/modules/master-data/master-data.store";
import {
  acceptCandidateSchedule,
  addScheduleException,
  compareCandidateSchedules,
  createRevisionFromAccepted,
  editScheduleEntry,
  getMeetingAlternatives,
  undoLastScheduleChange,
} from "../../../server/modules/schedules/schedules.service";
import { setAuditSinkForTests } from "../../../server/platform/audit";

describe("Phase 3: Schedule Workspace Exit Criteria", () => {
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
    "Exit Criteria 1, 2, 3, 4, 5, 6: Instant conflict detection on edit, optimistic locking across tabs, undo, non-waivable HC-01..HC-03, waivable rules with reason, accept gate, and revision flow",
    async () => {
      const small = generateSmallFixture();
      await loadFixtureIntoStore(small, { actor: "dean" });

      const gen = await runScheduleGeneration(small.term.code, {
        profiles: ["BALANCED", "FACULTY_FIRST"],
        timeLimitSeconds: 5,
      });
      const candidate = gen.candidates[0];
      const secondCandidate = gen.candidates[1];
      if (!candidate || !secondCandidate) {
        throw new Error("Expected candidates");
      }

      // Side-by-side candidate comparison
      const comparison = compareCandidateSchedules([
        candidate.id,
        secondCandidate.id,
      ]);
      expect(comparison).toHaveLength(2);

      // Query feasible alternative slots for the first meeting
      const firstEntry = candidate.entries[0];
      const secondEntry = candidate.entries[2];
      if (!firstEntry || !secondEntry) {
        throw new Error("Expected schedule entries");
      }
      const altRes = await getMeetingAlternatives(
        candidate.id,
        firstEntry.offeringCode,
        firstEntry.meetingIndex ?? 0,
      );
      expect(altRes.alternatives.length).toBeGreaterThan(0);

      // Exit Criterion 1: An edit that causes a conflict (moving secondEntry into firstEntry's room & time)
      // immediately returns the HC-02 room conflict
      const conflictEdit = await editScheduleEntry({
        scheduleId: candidate.id,
        entryId: secondEntry.id,
        expectedVersion: candidate.version,
        roomCode: firstEntry.roomCode,
        weekday: firstEntry.weekday,
        startMin: firstEntry.startMin,
        endMin: firstEntry.endMin,
        actor: "dean",
      });
      expect(conflictEdit.validation.valid).toBe(false);
      expect(
        conflictEdit.validation.violations.some((v) => v.code === "HC-02"),
      ).toBe(true);

      // Exit Criterion 5: Two tabs editing the same candidate with a stale version (version 1 instead of 2)
      // cannot silently overwrite each other
      await expect(
        editScheduleEntry({
          scheduleId: candidate.id,
          entryId: firstEntry.id,
          expectedVersion: 1, // Stale version! Current is 2
          pinned: true,
          actor: "dean",
        }),
      ).rejects.toMatchObject({
        code: "SCHEDULE_VERSION_CONFLICT",
        statusCode: 409,
      });

      // Exit Criterion 2: A schedule with an unwaived violation cannot be accepted
      await expect(
        acceptCandidateSchedule(candidate.id, { actor: "dean" }),
      ).rejects.toMatchObject({
        code: "SCHEDULE_NOT_ACCEPTABLE",
        statusCode: 422,
      });

      // Exit Criterion 3: HC-01 to HC-03 cannot be waived through UI or API
      for (const nonWaivableCode of ["HC-01", "HC-02", "HC-03"] as const) {
        await expect(
          addScheduleException({
            scheduleId: candidate.id,
            code: nonWaivableCode,
            reason: "Attempting to waive double-booking",
            actor: "dean",
          }),
        ).rejects.toMatchObject({
          code: "NON_WAIVABLE_CONSTRAINT",
          statusCode: 422,
        });
      }

      // Undo the conflicting edit and verify history (Exit Criterion 6)
      const undone = await undoLastScheduleChange(candidate.id, {
        actor: "dean",
      });
      expect(undone.validation.valid).toBe(true);
      expect(undone.schedule.changes?.length).toBeGreaterThanOrEqual(1);

      // Exit Criterion 4: Trigger a waivable violation (HC-04 room capacity) and waive it with a documented reason
      await upsertRoom(
        {
          code: firstEntry.roomCode,
          name: "Compact Room",
          type: "LECTURE",
          capacity: 25,
          equipment: [],
          restrictions: "",
          status: "ACTIVE",
        },
        { actor: "dean" },
      );

      // Without waiver, accept is blocked by HC-04
      await expect(
        acceptCandidateSchedule(candidate.id, { actor: "dean" }),
      ).rejects.toMatchObject({
        code: "SCHEDULE_NOT_ACCEPTABLE",
      });

      // Add documented exception for HC-04 on firstEntry.roomCode
      const waived = await addScheduleException({
        scheduleId: candidate.id,
        code: "HC-04",
        roomCode: firstEntry.roomCode,
        reason: "Dean approved extra chairs for 1st Sem AY 2026-2027",
        actor: "dean",
      });
      expect(waived.validation.valid).toBe(true);
      expect(waived.validation.waived_violation_count).toBeGreaterThan(0);
      expect(waived.schedule.exceptions?.[0]?.reason).toBe(
        "Dean approved extra chairs for 1st Sem AY 2026-2027",
      );

      // Now accept succeeds!
      const accepted = await acceptCandidateSchedule(candidate.id, {
        actor: "dean",
      });
      expect(accepted.status).toBe("ACCEPTED");

      // Accepted schedules cannot be edited in place
      await expect(
        editScheduleEntry({
          scheduleId: accepted.id,
          entryId: firstEntry.id,
          expectedVersion: accepted.version,
          pinned: true,
          actor: "dean",
        }),
      ).rejects.toMatchObject({
        code: "SCHEDULE_IMMUTABLE",
        statusCode: 409,
      });

      // Start revision flow from accepted schedule
      const revision = await createRevisionFromAccepted(accepted.id, {
        actor: "dean",
      });
      expect(revision.status).toBe("CANDIDATE");
      expect(revision.parentScheduleId).toBe(accepted.id);
      expect(revision.version).toBe(1);
    },
    30_000,
  );
});
