import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "../../platform/audit";
import { generateSmallFixture, loadFixtureIntoStore } from "../fixtures/fixture.generator";
import { CANDIDATE_PROFILES, buildProblemSnapshot } from "../generation/generation.service";
import { getMasterDataState, resetMasterDataState } from "../master-data/master-data.store";
import {
  deleteDirective,
  getSoftWeightOverrides,
  listDirectives,
  saveDirective,
  saveSoftWeights,
  setDirectiveApproval,
} from "./directives.service";

const ctx = { actor: "dean" };
const DEFAULTS: Record<string, number> = { ...CANDIDATE_PROFILES.BALANCED.weights };

describe("directives and objective weights", () => {
  let termCode = "";
  let facultyCode = "";

  beforeEach(async () => {
    resetMasterDataState();
    setAuditSinkForTests({
      write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }),
    });
    const fixture = generateSmallFixture();
    await loadFixtureIntoStore(fixture, { actor: "dean" });
    termCode = fixture.term.code;
    const first = getMasterDataState().faculty.values().next().value;
    if (!first) throw new Error("fixture has no faculty");
    facultyCode = first.code;
  });

  afterEach(() => {
    setAuditSinkForTests(null);
  });

  it("requires the fields of each directive type", async () => {
    await expect(
      saveDirective({ termCode, type: "FACULTY_NOT_ON_DAY", hardness: "HARD", facultyCode }, ctx),
    ).rejects.toThrow(/day/i);
    await expect(
      saveDirective({ termCode, type: "SET_WEIGHT", hardness: "SOFT" }, ctx),
    ).rejects.toThrow();
  });

  it("creates, approves, edits (clearing approval) and deletes a directive", async () => {
    const created = await saveDirective(
      { termCode, type: "FACULTY_NOT_ON_DAY", hardness: "HARD", facultyCode, weekday: "SATURDAY" },
      ctx,
    );
    expect(created.approved).toBe(false);

    const approved = await setDirectiveApproval(created.id, true, ctx);
    expect(approved.approved).toBe(true);

    const edited = await saveDirective(
      { termCode, type: "FACULTY_NOT_ON_DAY", hardness: "HARD", facultyCode, weekday: "FRIDAY" },
      ctx,
      created.id,
    );
    expect(edited.id).toBe(created.id);
    expect(edited.weekday).toBe("FRIDAY");
    expect(edited.approved).toBe(false);

    await deleteDirective(created.id, ctx);
    expect(listDirectives(termCode).some((d) => d.id === created.id)).toBe(false);
  });

  it("stores only non-default weights and keeps them out of the directive list", async () => {
    await saveSoftWeights({ termCode, weights: { ...DEFAULTS, "SC-05": 20 } }, DEFAULTS, ctx);
    expect(getSoftWeightOverrides(termCode)).toEqual({ "SC-05": 20 });
    expect(listDirectives(termCode).some((d) => d.type === "SET_WEIGHT")).toBe(false);

    await saveSoftWeights({ termCode, weights: { ...DEFAULTS } }, DEFAULTS, ctx);
    expect(getSoftWeightOverrides(termCode)).toEqual({});
  });

  it("sends saved weights to the solver, scaling the other candidate profiles", async () => {
    const reference = DEFAULTS["SC-05"] ?? 0;
    expect(reference).toBeGreaterThan(0);
    await saveSoftWeights({ termCode, weights: { "SC-05": reference * 2 } }, DEFAULTS, ctx);

    const balanced = buildProblemSnapshot(termCode, { profileName: "BALANCED" });
    expect(balanced.soft_weights?.weights?.["SC-05"]).toBe(reference * 2);

    const facultyFirst = buildProblemSnapshot(termCode, { profileName: "FACULTY_FIRST" });
    const facultyFirstDefault = CANDIDATE_PROFILES.FACULTY_FIRST.weights["SC-05"] ?? 0;
    expect(facultyFirst.soft_weights?.weights?.["SC-05"]).toBeCloseTo(facultyFirstDefault * 2, 2);
  });
});
