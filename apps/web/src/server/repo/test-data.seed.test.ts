import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { createEngineClient } from "../engine/engine.client";
import { reviewChangeProposal, runAiAssistantTurn } from "../modules/ai/ai-orchestrator";
import {
  completeEvaluationSession,
  startEvaluationSession,
} from "../modules/evaluation/evaluation.service";
import {
  type CollegeFixtureDataset,
  generateMediumCollegeFixture,
} from "../modules/fixtures/fixture.generator";
import { saveSoftWeights } from "../modules/directives/directives.service";
import {
  addDirective,
  buildProblemSnapshot,
  CANDIDATE_PROFILES,
  checkExistingSchedule,
  runScheduleGeneration,
  toEngineEntries,
} from "../modules/generation/generation.service";
import {
  buildWorkbookBuffer,
  importWorkbookPayload,
  parseWorkbookBuffer,
  type WorkbookSheetsPayload,
} from "../modules/imports/imports.service";
import {
  deleteFacultyQualification,
  upsertFaculty,
  upsertFacultyAvailability,
  upsertFacultyPreference,
  upsertFacultyQualification,
  upsertOffering,
  upsertRoom,
  upsertSubject,
  upsertTerm,
} from "../modules/master-data/master-data.service";
import {
  type GenerationRunRecord,
  getMasterDataState,
  replaceMasterDataState,
  type ScheduleEntryRecord,
  type ScheduleRecord,
  type UnscheduledMeetingRecord,
} from "../modules/master-data/master-data.store";
import { recordLearningEvent, trainAndEvaluateFitModel } from "../modules/ml/ml.service";
import {
  acceptCandidateSchedule,
  addScheduleException,
  createRevisionFromAccepted,
  editScheduleEntry,
} from "../modules/schedules/schedules.service";
import { type AuditInput, recordAudit, setAuditSinkForTests } from "../platform/audit";
import { logger } from "../platform/logger";
import {
  applyChanges,
  claimNextVersion,
  diffState,
  type LoadedState,
  loadState,
} from "./state.repository";

/**
 * Test-data seed (development / staging only).
 *
 * Runs the real services in memory (workbook import, schedule generation via
 * the engine, AI assistant with the built-in offline provider, schedule edits,
 * evaluation sessions, ML training), then saves the result and its audit
 * entries to PostgreSQL in one transaction.
 *
 * Every status value of the domain tables is used at least once, spread over
 * randomly chosen records (the random seed is logged; set ORDIQ_SEED_RANDOM to
 * repeat a run). Status changes avoid records the schedules depend on.
 *
 * Conflict scenarios are then added on purpose, so every conflict screen has
 * something to show. Each conflict is found by the engine's validator, never
 * written by hand:
 *   - the accepted schedule drifts after acceptance (a faculty window becomes
 *     unavailable, a room goes into maintenance, a room is partitioned, a
 *     qualification is withdrawn, a HARD directive is approved), with one
 *     documented exception (D-18);
 *   - a revision of it holds Dean edits that break HC-01/02/03/05/11/13/15;
 *   - candidates with unscheduled meetings (HC-08) and every solver status.
 *
 * Run from apps/web:
 *   pnpm seed:test-data              full seed; only on an EMPTY database
 *   pnpm seed:test-data --statuses   add the status variety and the conflict
 *                                    scenarios to an already seeded database;
 *                                    each step is skipped when its data
 *                                    already exists
 */
const enabled = process.env.ORDIQ_SEED_TEST_DATA === "1";
const statusesOnly = process.env.ORDIQ_SEED_MODE === "statuses";
const DEAN = "dean@mseuf.edu.ph";
const ctx = { actor: DEAN };

type Audit = AuditInput & { createdAt: Date };

/** Small deterministic PRNG (mulberry32), so a logged seed repeats a run. */
function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return { next, shuffle, pick, int };
}
type Random = ReturnType<typeof createRandom>;

const step = (name: string) => logger.info("seed_step", { step: name });

function workbookPayloadOf(fixture: CollegeFixtureDataset) {
  return buildWorkbookBuffer({
    termCode: fixture.term.code,
    programs: fixture.programs,
    faculty: fixture.faculty,
    subjects: fixture.subjects,
    sections: fixture.sections,
    rooms: fixture.rooms,
    offerings: fixture.offerings,
    fixedBlocks: fixture.fixedBlocks,
    facultyAvailability: fixture.facultyAvailability,
    facultyQualifications: fixture.facultyQualifications,
    facultyPreferences: fixture.facultyPreferences,
    pastSchedule: fixture.pastSchedule,
  }).then((buffer) => parseWorkbookBuffer(buffer, fixture.term.code));
}

// ---------------------------------------------------------------------------
// Core data: master data, schedules, AI, evaluation, ML
// ---------------------------------------------------------------------------

async function seedCoreData(fixture: CollegeFixtureDataset): Promise<void> {
  const termCode = fixture.term.code;

  // 1. Master data and the past (manual) schedule through a workbook import.
  step("import");
  const imported = await importWorkbookPayload(await workbookPayloadOf(fixture), {
    dryRun: false,
    actor: DEAN,
  });
  expect(imported.errors).toEqual([]);
  expect(imported.status).toBe("COMMITTED");

  const state = getMasterDataState();
  const manual = [...state.schedules.values()].find((s) => s.source === "IMPORTED");
  if (manual) {
    step("check-manual-schedule");
    await checkExistingSchedule(manual.id, { actor: DEAN });
  }

  // 2. AI assistant: a directive first, so generation honours it.
  step("ai-directive");
  const firstFaculty = [...state.faculty.values()][0];
  const directiveTurn = await runAiAssistantTurn({
    termCode,
    prompt: `Add a directive: do not schedule ${firstFaculty?.name ?? "the first faculty member"} on Monday morning.`,
    actor: DEAN,
  });

  // 3. Schedule generation (two candidate profiles).
  step("generation");
  const generation = await runScheduleGeneration(termCode, {
    profiles: ["BALANCED", "FACULTY_FIRST"],
    timeLimitSeconds: 30,
    actor: DEAN,
  });
  const [balanced, facultyFirst] = generation.candidates;
  if (!balanced) throw new Error("Generation returned no candidate schedule.");

  // 4. More assistant turns: summary, then change proposals (one rejected).
  step("ai-summary-and-proposals");
  await runAiAssistantTurn({
    termCode,
    conversationId: directiveTurn.conversationId,
    scheduleId: balanced.id,
    prompt: "Give me the overall schedule summary and quality score.",
    actor: DEAN,
  });
  const offerings = [...state.offerings.values()];
  for (const [index, day] of ["Wednesday", "Thursday"].entries()) {
    const offering = offerings[index];
    if (!offering) continue;
    await runAiAssistantTurn({
      termCode,
      conversationId: directiveTurn.conversationId,
      scheduleId: balanced.id,
      prompt: `Propose a change to move offering ${offering.code} to ${day}.`,
      actor: DEAN,
    });
  }
  const pending = [...state.proposals.values()].filter((p) => p.status === "PENDING");
  if (pending[0]) {
    await reviewChangeProposal({ proposalId: pending[0].id, decision: "REJECT", actor: DEAN });
  }

  // 5. Evaluation session with two manual edits on the second candidate.
  const evaluated = facultyFirst ?? balanced;
  step("evaluation");
  const session = await startEvaluationSession({
    termCode,
    stage: "STAGE_3_GENERATION",
    scenario: "Dean pilot review and manual slot adjustment",
    scheduleId: evaluated.id,
    actor: DEAN,
  });
  const entry = evaluated.entries[0];
  if (entry) {
    const pinned = await editScheduleEntry({
      scheduleId: evaluated.id,
      entryId: entry.id,
      expectedVersion: evaluated.version,
      pinned: true,
      actor: DEAN,
    });
    const second = evaluated.entries[1];
    if (second) {
      await editScheduleEntry({
        scheduleId: evaluated.id,
        entryId: second.id,
        expectedVersion: pinned.schedule.version,
        pinned: true,
        actor: DEAN,
      });
    }
  }
  await completeEvaluationSession({ sessionId: session.id, scheduleId: evaluated.id, actor: DEAN });

  // 6. Accept the balanced candidate (skipped if the engine reports blockers).
  step("accept");
  try {
    await acceptCandidateSchedule(balanced.id, { actor: DEAN });
  } catch (error) {
    logger.warn("seed_accept_skipped", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // 7. Learning signals and the fit model.
  step("ml");
  const acceptedEntries = state.schedules.get(balanced.id)?.entries ?? [];
  for (const e of acceptedEntries.slice(0, 6)) {
    const offering = [...state.offerings.values()].find((o) => o.code === e.offeringCode);
    if (!offering || !e.facultyCode) continue;
    recordLearningEvent({
      termCode,
      scheduleId: balanced.id,
      type: "DEAN_EDIT",
      facultyCode: e.facultyCode,
      subjectCode: offering.subjectCode,
      weekday: e.weekday,
      startMin: e.startMin,
      endMin: e.endMin,
    });
  }
  await trainAndEvaluateFitModel(DEAN, termCode);
}

// ---------------------------------------------------------------------------
// Status variety: every status value at least once, on random records
// ---------------------------------------------------------------------------

async function applyStatusVariety(fixture: CollegeFixtureDataset, rnd: Random): Promise<void> {
  const termCode = fixture.term.code;
  const state = getMasterDataState();
  const schedulesOfTerm = () => [...state.schedules.values()].filter((s) => s.termCode === termCode);
  const has = <T>(items: Iterable<T>, test: (item: T) => boolean) => [...items].some(test);

  // Schedules: a revision of the accepted schedule is edited and accepted, so
  // the previous one becomes ARCHIVED (the normal revision flow).
  step("status-schedules");
  const accepted = schedulesOfTerm().find((s) => s.status === "ACCEPTED");
  if (accepted && !has(schedulesOfTerm(), (s) => s.status === "ARCHIVED")) {
    const revision = await createRevisionFromAccepted(accepted.id, ctx);
    const target = rnd.pick(revision.entries);
    if (target) {
      await editScheduleEntry({
        scheduleId: revision.id,
        entryId: target.id,
        expectedVersion: revision.version,
        pinned: !target.pinned,
        actor: DEAN,
      });
    }
    try {
      await acceptCandidateSchedule(revision.id, ctx);
    } catch (error) {
      logger.warn("seed_revision_accept_skipped", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Change proposals: one APPLIED on the remaining generated candidate (the
  // earlier PENDING and REJECTED ones stay). The built-in assistant proposes a
  // move to 10:00 on the named day, so moves are checked with the validator
  // first and only one that fits is requested.
  step("status-proposals");
  const candidate = schedulesOfTerm().find((s) => s.status === "CANDIDATE" && s.source === "GENERATED");
  if (candidate && !has(state.proposals.values(), (p) => p.status === "APPLIED")) {
    const engine = createEngineClient();
    const problem = buildProblemSnapshot(termCode);
    const fallbackDays: ScheduleEntryRecord["weekday"][] = ["WEDNESDAY", "THURSDAY", "FRIDAY"];
    const days = rnd.shuffle(state.terms.get(termCode)?.teachingDays ?? fallbackDays);
    let move: { offeringCode: string; weekday: ScheduleEntryRecord["weekday"] } | null = null;
    search: for (const entry of rnd.shuffle(candidate.entries.filter((e) => (e.meetingIndex ?? 0) === 0))) {
      for (const weekday of days) {
        if (weekday === entry.weekday && entry.startMin === 600) continue;
        const moved = { ...entry, weekday, startMin: 600, endMin: 600 + entry.endMin - entry.startMin };
        const check = await engine.validateSchedule({
          problem,
          entries: toEngineEntries(candidate.entries.map((e) => (e.id === entry.id ? moved : e))),
        });
        if (check.valid && check.hard_violation_count === 0) {
          move = { offeringCode: entry.offeringCode, weekday };
          break search;
        }
      }
    }
    if (move) {
      const { offeringCode, weekday } = move;
      await runAiAssistantTurn({
        termCode,
        scheduleId: candidate.id,
        prompt: `Propose a change to move offering ${offeringCode} to ${weekday.charAt(0)}${weekday.slice(1).toLowerCase()}.`,
        actor: DEAN,
      });
      const proposal = [...state.proposals.values()].find(
        (p) => p.status === "PENDING" && p.valid && p.scheduleId === candidate.id && p.offeringCode === offeringCode,
      );
      if (proposal) {
        await reviewChangeProposal({ proposalId: proposal.id, decision: "APPLY", actor: DEAN });
      } else {
        logger.warn("seed_proposal_apply_skipped", { reason: "The assistant did not create a valid proposal." });
      }
    } else {
      logger.warn("seed_proposal_apply_skipped", { reason: "No 10:00 move fits the candidate schedule." });
    }
  }

  // What the schedules rely on is left untouched by the status changes below.
  const entries: ScheduleEntryRecord[] = [...state.schedules.values()].flatMap((s) => s.entries);
  const busyFaculty = new Set(entries.map((e) => e.facultyCode));
  for (const o of state.offerings.values()) {
    if (o.preassignedFacultyCode) busyFaculty.add(o.preassignedFacultyCode);
  }
  for (const d of state.directives.values()) if (d.facultyCode) busyFaculty.add(d.facultyCode);
  const busyRooms = new Set(entries.map((e) => e.roomCode));

  // Terms: the current term is ACTIVE; past, next and future terms around it.
  step("status-terms");
  const main = state.terms.get(termCode);
  if (main) {
    if (main.status !== "ACTIVE") await upsertTerm({ ...main, status: "ACTIVE" }, ctx);
    const extra = [
      ["AY2025-2026-S1", "2025-2026", 1, "ARCHIVED"],
      ["AY2025-2026-S2", "2025-2026", 2, "ARCHIVED"],
      ["AY2026-2027-S2", "2026-2027", 2, "READY"],
      ["AY2027-2028-S1", "2027-2028", 1, "DRAFT"],
    ] as const;
    for (const [code, academicYear, semester, status] of extra) {
      if (state.terms.has(code)) continue;
      await upsertTerm({ ...main, code, academicYear, semester, status }, ctx);
    }
  }

  // Faculty: random idle members go ON_LEAVE or INACTIVE.
  step("status-faculty");
  const idleFaculty = rnd.shuffle([...state.faculty.values()].filter((f) => !busyFaculty.has(f.code)));
  const facultyStatuses = ["ON_LEAVE", "ON_LEAVE", "ON_LEAVE", "INACTIVE", "INACTIVE"] as const;
  const facultyDone = has(state.faculty.values(), (f) => f.status !== "ACTIVE");
  for (const [i, status] of facultyDone ? [] : facultyStatuses.entries()) {
    const member = idleFaculty[i];
    if (member) await upsertFaculty({ ...member, status }, ctx);
  }
  const activeFaculty = [...state.faculty.values()].filter((f) => f.status === "ACTIVE");

  // Rooms: random unused rooms go to MAINTENANCE or INACTIVE; if every room is
  // in use, an extra room is added for each status.
  step("status-rooms");
  const roomStatuses = [
    ["MAINTENANCE", "Air-conditioning repair in progress"],
    ["MAINTENANCE", "Projector and wiring replacement"],
    ["INACTIVE", "Converted to faculty office space"],
  ] as const;
  const idleRooms = rnd.shuffle([...state.rooms.values()].filter((r) => !busyRooms.has(r.code)));
  const roomsDone = has(state.rooms.values(), (r) => r.status !== "ACTIVE");
  for (const [i, [status, restrictions]] of roomsDone ? [] : roomStatuses.entries()) {
    const template = idleRooms[i] ?? rnd.pick([...state.rooms.values()]);
    const room = idleRooms[i] ?? { ...template, code: `${template.code}-X${i + 1}`, name: `${template.name} (Annex ${i + 1})` };
    await upsertRoom({ ...room, status, restrictions }, ctx);
  }
  const maintenanceRoom = [...state.rooms.values()].find((r) => r.status === "MAINTENANCE");
  const activeRooms = [...state.rooms.values()].filter((r) => r.status === "ACTIVE");

  // Availability: ~15% of the windows that no schedule uses become UNAVAILABLE.
  step("status-availability");
  const reasons = [
    "Graduate school class",
    "College council meeting",
    "Board exam review session",
    "Research consultation",
    "Medical appointment",
  ];
  const freeWindows = rnd.shuffle(
    [...state.facultyAvailability.values()].filter(
      (a) =>
        a.status === "AVAILABLE" &&
        !entries.some(
          (e) =>
            e.facultyCode === a.facultyCode &&
            e.weekday === a.weekday &&
            e.startMin < a.endMin &&
            a.startMin < e.endMin,
        ),
    ),
  );
  const availabilityDone = has(state.facultyAvailability.values(), (a) => a.status === "UNAVAILABLE");
  const unavailableCount = availabilityDone ? 0 : Math.max(1, Math.round(freeWindows.length * 0.15));
  for (const window of freeWindows.slice(0, unavailableCount)) {
    await upsertFacultyAvailability({ ...window, status: "UNAVAILABLE", reason: rnd.pick(reasons) }, ctx);
  }

  // Qualifications: a random share comes from teaching HISTORY or a DEAN decision.
  step("status-qualifications");
  const qualificationsDone = has(state.facultyQualifications.values(), (q) => q.source !== "DECLARED");
  const qualifications = qualificationsDone ? [] : rnd.shuffle([...state.facultyQualifications.values()]);
  for (const [i, q] of qualifications.entries()) {
    const roll = rnd.next();
    const source = i === 0 ? "HISTORY" : i === 1 ? "DEAN" : roll < 0.2 ? "HISTORY" : roll < 0.35 ? "DEAN" : null;
    if (source) await upsertFacultyQualification({ ...q, source }, ctx);
  }

  // Preferences set by the Dean, including preferred rooms.
  step("status-preferences");
  const preferencesDone = has(state.facultyPreferences.values(), (p) => p.source === "DEAN");
  for (const member of preferencesDone ? [] : rnd.shuffle(activeFaculty).slice(0, 5)) {
    const room = rnd.pick(activeRooms);
    if (room) {
      await upsertFacultyPreference(
        { facultyCode: member.code, termCode, type: "PREFERRED_ROOM", value: room.code, weight: rnd.int(2, 4), source: "DEAN" },
        ctx,
      );
    }
  }
  for (const member of preferencesDone ? [] : rnd.shuffle(activeFaculty).slice(0, 3)) {
    await upsertFacultyPreference(
      { facultyCode: member.code, termCode, type: "AVOID_DAY", value: rnd.pick(["FRIDAY", "SATURDAY"]), weight: rnd.int(2, 5), source: "DEAN" },
      ctx,
    );
  }

  // Directives: HARD ones awaiting approval (so the accepted schedule stays
  // valid) and an approved SOFT one.
  step("status-directives");
  const directiveBase = {
    termCode,
    facultyCode: null,
    sectionCode: null,
    roomCode: null,
    offeringCode: null,
    weekday: null,
    startMin: null,
    endMin: null,
    weight: 1,
    createdBy: DEAN,
  };
  const directivesDone = has(state.directives.values(), (d) => d.hardness === "HARD");
  const directiveFaculty = rnd.pick(activeFaculty);
  if (directiveFaculty && !directivesDone) {
    await addDirective({
      ...directiveBase,
      type: "FACULTY_NOT_ON_DAY",
      hardness: "HARD",
      approved: false,
      facultyCode: directiveFaculty.code,
      weekday: "SATURDAY",
    });
  }
  const section = rnd.pick([...state.sections.values()]);
  if (section && !directivesDone) {
    await addDirective({
      ...directiveBase,
      type: "SECTION_TIME_WINDOW",
      hardness: "HARD",
      approved: false,
      sectionCode: section.code,
      startMin: 450,
      endMin: 1020,
    });
  }
  if (maintenanceRoom && !directivesDone) {
    await addDirective({
      ...directiveBase,
      type: "AVOID_ROOM",
      hardness: "SOFT",
      approved: true,
      roomCode: maintenanceRoom.code,
      weight: 2,
    });
  }

  // Generation runs in the other states. Only completed runs exist after a
  // real solve, so these are stored as history records.
  step("status-generation-runs");
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const runStates: Array<[GenerationRunRecord["status"], string | null, number, number | null]> = [
    ["QUEUED", null, rnd.int(1, 3), null],
    ["RUNNING", null, rnd.int(3, 6), null],
    ["FAILED", "The engine could not be reached after 3 attempts (connection refused).", rnd.int(60, 600), 2],
    ["CANCELLED", "Cancelled by the Dean before the solver finished.", rnd.int(600, 1800), 1],
    ["SOLVER_MODEL_BUG", "The validator rejected the solver output (HC-02 room double-booking); the result was discarded.", rnd.int(1800, 4000), 3],
  ];
  const profilePool = ["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"];
  for (const [status, error, ago, runMinutes] of runStates) {
    if (has(state.generationRuns.values(), (r) => r.status === status)) continue;
    const id = `RUN-${crypto.randomUUID().slice(0, 8)}`;
    state.generationRuns.set(id, {
      id,
      termCode,
      status,
      profiles: rnd.shuffle(profilePool).slice(0, rnd.int(1, 3)),
      candidateScheduleIds: [],
      error,
      createdAt: minutesAgo(ago),
      completedAt: runMinutes === null ? null : minutesAgo(ago - runMinutes),
    });
  }

  // Model versions: a retrained model kept as CANDIDATE for review.
  step("status-models");
  if (!has(state.modelVersions.values(), (v) => v.status === "CANDIDATE")) {
    const previousActive = [...state.modelVersions.values()].find((v) => v.status === "ACTIVE");
    const retrained = await trainAndEvaluateFitModel(DEAN, termCode);
    if (retrained.promoted && previousActive) {
      state.modelVersions.set(retrained.newVersion.id, { ...retrained.newVersion, status: "CANDIDATE" });
      state.modelVersions.set(previousActive.id, { ...previousActive, status: "ACTIVE" });
    }
  }

  // Import batches: a dry run and a rejected workbook.
  step("status-imports");
  const batches = () => state.importBatches.values();
  const payload = await workbookPayloadOf(fixture);
  if (!has(batches(), (b) => b.status === "DRY_RUN")) {
    // The import service returns a dry-run preview without storing it; one is
    // kept here as a history record.
    const preview = await importWorkbookPayload(payload, { dryRun: true, actor: DEAN });
    state.importBatches.set(preview.batchId, {
      id: preview.batchId,
      termCode,
      dataset: "WORKBOOK",
      fileHash: preview.fileHash,
      status: "DRY_RUN",
      rowCount: preview.rowCount,
      insertedCount: 0,
      updatedCount: 0,
      errors: [],
      createdAt: new Date().toISOString(),
    });
  }
  if (!has(batches(), (b) => b.status === "FAILED")) {
    const broken: WorkbookSheetsPayload = {
      ...payload,
      sections: (payload.sections ?? []).map((row, i) => (i === 0 ? { ...row, programCode: "BSXX" } : row)),
    };
    await importWorkbookPayload(broken, { dryRun: false, actor: DEAN });
  }

  // Evaluation: a completed Stage 1 session and an open Stage 2 session.
  step("status-evaluation");
  const manual = schedulesOfTerm().find((s) => s.source === "IMPORTED");
  const hasStage = (stage: string) => has(state.evaluationSessions.values(), (e) => e.stage === stage);
  if (!hasStage("STAGE_1_BASELINE")) {
    const baseline = await startEvaluationSession({
      termCode,
      stage: "STAGE_1_BASELINE",
      scenario: "Baseline: manual schedule preparation by the Dean",
      scheduleId: manual?.id ?? null,
      actor: DEAN,
    });
    await completeEvaluationSession({
      sessionId: baseline.id,
      scheduleId: manual?.id ?? null,
      iso25010Ratings: {
        functionalSuitability: rnd.int(3, 5),
        performanceEfficiency: rnd.int(3, 5),
        usability: rnd.int(3, 5),
        reliability: rnd.int(3, 5),
        security: rnd.int(4, 5),
        maintainability: rnd.int(3, 5),
      },
      notes: "Baseline timing recorded for comparison with generated schedules.",
      actor: DEAN,
    });
  }
  if (!hasStage("STAGE_2_CONFLICT_CHECK")) {
    await startEvaluationSession({
      termCode,
      stage: "STAGE_2_CONFLICT_CHECK",
      scenario: "Conflict check of the imported manual schedule",
      scheduleId: manual?.id ?? null,
      actor: DEAN,
    });
  }

  await recordAudit({
    actor: DEAN,
    action: "TEST_DATA_STATUSES_SEEDED",
    entity: "SystemState",
    entityId: termCode,
    after: { note: "Status variety added by the test-data seed." },
  });
}

// ---------------------------------------------------------------------------
// Conflict scenarios: real violations, found by the engine's validator
// ---------------------------------------------------------------------------

type Weekday = ScheduleEntryRecord["weekday"];

async function applyConflictScenarios(fixture: CollegeFixtureDataset, rnd: Random): Promise<void> {
  const termCode = fixture.term.code;
  const state = getMasterDataState();
  const term = state.terms.get(termCode);
  const schedulesOfTerm = () => [...state.schedules.values()].filter((s) => s.termCode === termCode);
  const accepted = schedulesOfTerm().find((s) => s.status === "ACCEPTED");
  if (!term || !accepted) {
    logger.warn("seed_conflicts_skipped", { reason: "The term has no accepted schedule." });
    return;
  }
  if (schedulesOfTerm().some((s) => (s.exceptions ?? []).length > 0)) {
    logger.info("seed_conflicts_skipped", { reason: "Conflict scenarios already exist." });
    return;
  }

  const sectionOf = (e: ScheduleEntryRecord) => state.offerings.get(e.offeringCode)?.sectionCode ?? null;
  const overlaps = (a: ScheduleEntryRecord, b: { weekday: Weekday; startMin: number; endMin: number }) =>
    a.weekday === b.weekday && a.startMin < b.endMin && b.startMin < a.endMin;
  const singleOffering = (e: ScheduleEntryRecord) => !state.offerings.get(e.offeringCode)?.combinedClassGroup;

  // 1. The accepted schedule drifts: master data changes after acceptance.
  step("conflicts-accepted-drift");
  const taken = { entries: new Set<string>(), faculty: new Set<string>(), rooms: new Set<string>() };
  const pool = rnd.shuffle(accepted.entries.filter(singleOffering));
  const take = (test: (e: ScheduleEntryRecord) => boolean = () => true) => {
    const e = pool.find(
      (x) => !taken.entries.has(x.id) && !taken.faculty.has(x.facultyCode) && !taken.rooms.has(x.roomCode) && test(x),
    );
    if (e) {
      taken.entries.add(e.id);
      taken.faculty.add(e.facultyCode);
      taken.rooms.add(e.roomCode);
    }
    return e;
  };

  // HC-06: a faculty member becomes unavailable during a class they teach.
  const unavailableEntry = take((e) => state.faculty.get(e.facultyCode)?.status === "ACTIVE");
  if (unavailableEntry) {
    const covering = [...state.facultyAvailability.values()].find(
      (a) =>
        a.termCode === termCode &&
        a.facultyCode === unavailableEntry.facultyCode &&
        a.status === "AVAILABLE" &&
        a.weekday === unavailableEntry.weekday &&
        a.startMin <= unavailableEntry.startMin &&
        unavailableEntry.endMin <= a.endMin,
    );
    const reason = "Graduate school class moved to this slot after the schedule was accepted";
    await upsertFacultyAvailability(
      covering
        ? { ...covering, status: "UNAVAILABLE", reason }
        : {
            termCode,
            facultyCode: unavailableEntry.facultyCode,
            weekday: unavailableEntry.weekday,
            startMin: unavailableEntry.startMin,
            endMin: unavailableEntry.endMin,
            status: "UNAVAILABLE",
            reason,
          },
      ctx,
    );
  }

  // HC-10: a room in use goes into maintenance.
  const maintenanceEntry = take();
  const maintenanceRoom = maintenanceEntry ? state.rooms.get(maintenanceEntry.roomCode) : undefined;
  if (maintenanceRoom) {
    await upsertRoom(
      { ...maintenanceRoom, status: "MAINTENANCE", restrictions: "Ceiling leak repair; closed after the schedule was accepted" },
      ctx,
    );
  }

  // HC-04: a room is partitioned and no longer fits a section that uses it.
  // One class in it gets a documented exception below; the others stay open.
  const capacityEntry = take((e) => {
    const section = state.sections.get(sectionOf(e) ?? "");
    return Boolean(section && section.studentCount > 10);
  });
  const capacitySection = capacityEntry ? state.sections.get(sectionOf(capacityEntry) ?? "") : undefined;
  const capacityRoom = capacityEntry ? state.rooms.get(capacityEntry.roomCode) : undefined;
  if (capacityRoom && capacitySection) {
    await upsertRoom(
      {
        ...capacityRoom,
        capacity: Math.max(1, capacitySection.studentCount - 6),
        restrictions: "Partitioned into two rooms; capacity reduced",
      },
      ctx,
    );
  }

  // HC-09: a qualification is withdrawn from a faculty member teaching that subject.
  const qualificationEntry = take();
  const withdrawnSubject = qualificationEntry
    ? state.offerings.get(qualificationEntry.offeringCode)?.subjectCode
    : undefined;
  const withdrawn = [...state.facultyQualifications.values()].find(
    (q) => q.facultyCode === qualificationEntry?.facultyCode && q.subjectCode === withdrawnSubject,
  );
  if (withdrawn) await deleteFacultyQualification(withdrawn.id, ctx);

  // HC-12: the Dean approves a HARD directive that the accepted schedule breaks.
  const directiveEntry = take();
  if (directiveEntry) {
    await addDirective({
      termCode,
      type: "FACULTY_NOT_ON_DAY",
      hardness: "HARD",
      approved: true,
      facultyCode: directiveEntry.facultyCode,
      sectionCode: null,
      roomCode: null,
      offeringCode: null,
      weekday: directiveEntry.weekday,
      startMin: null,
      endMin: null,
      weight: 1,
      createdBy: DEAN,
    });
  }

  await checkExistingSchedule(accepted.id, { actor: DEAN });
  if (capacityEntry) {
    await addScheduleException({
      scheduleId: accepted.id,
      code: "HC-04",
      offeringCode: capacityEntry.offeringCode,
      reason: "Section meets in two shifts while the partition is in place; approved by the Dean",
      actor: DEAN,
    });
  }

  // 2. A revision of the accepted schedule with Dean edits that break rules.
  step("conflicts-revision-edits");
  const revision = await createRevisionFromAccepted(accepted.id, ctx);
  let version = revision.version;
  const touched = new Set<string>();
  const entries = rnd.shuffle(revision.entries.filter(singleOffering));
  const pick = (test: (e: ScheduleEntryRecord) => boolean) => {
    const e = entries.find((x) => !touched.has(x.id) && test(x));
    if (e) touched.add(e.id);
    return e;
  };
  const edit = async (
    entry: ScheduleEntryRecord,
    change: { weekday?: Weekday; startMin?: number; endMin?: number; roomCode?: string },
  ) => {
    const result = await editScheduleEntry({
      scheduleId: revision.id,
      entryId: entry.id,
      expectedVersion: version,
      actor: DEAN,
      ...change,
    });
    version = result.schedule.version;
  };
  const moveOnto = (entry: ScheduleEntryRecord, slot: { weekday: Weekday; startMin: number }) => ({
    weekday: slot.weekday,
    startMin: slot.startMin,
    endMin: slot.startMin + (entry.endMin - entry.startMin),
  });
  const roomType = (code: string) => state.rooms.get(code)?.type;
  const partnerOf = (e: ScheduleEntryRecord, test: (o: ScheduleEntryRecord) => boolean) =>
    entries.find((o) => o.id !== e.id && !touched.has(o.id) && test(o));

  // HC-01: the same faculty member in two classes at once.
  const facultyClash = pick((e) => Boolean(partnerOf(e, (o) => o.facultyCode === e.facultyCode && !overlaps(o, e))));
  const facultyPartner = facultyClash
    ? partnerOf(facultyClash, (o) => o.facultyCode === facultyClash.facultyCode && !overlaps(o, facultyClash))
    : undefined;
  if (facultyClash && facultyPartner) {
    touched.add(facultyPartner.id);
    await edit(facultyClash, moveOnto(facultyClash, facultyPartner));
  }

  // HC-02: two classes in the same room at once (same room type, so only HC-02).
  const sameRoomTest = (e: ScheduleEntryRecord) => (o: ScheduleEntryRecord) =>
    o.facultyCode !== e.facultyCode &&
    sectionOf(o) !== sectionOf(e) &&
    roomType(o.roomCode) === roomType(e.roomCode) &&
    o.roomCode !== e.roomCode;
  const roomClash = pick((e) => Boolean(partnerOf(e, sameRoomTest(e))));
  const roomPartner = roomClash ? partnerOf(roomClash, sameRoomTest(roomClash)) : undefined;
  if (roomClash && roomPartner) {
    touched.add(roomPartner.id);
    await edit(roomClash, { ...moveOnto(roomClash, roomPartner), roomCode: roomPartner.roomCode });
  }

  // HC-03: one section in two classes at once.
  const sameSectionTest = (e: ScheduleEntryRecord) => (o: ScheduleEntryRecord) =>
    sectionOf(o) === sectionOf(e) && o.facultyCode !== e.facultyCode && !overlaps(o, e);
  const sectionClash = pick((e) => Boolean(partnerOf(e, sameSectionTest(e))));
  const sectionPartner = sectionClash ? partnerOf(sectionClash, sameSectionTest(sectionClash)) : undefined;
  if (sectionClash && sectionPartner) {
    touched.add(sectionPartner.id);
    await edit(sectionClash, moveOnto(sectionClash, sectionPartner));
  }

  // HC-05: a laboratory class moved into a free lecture room (waived below).
  const labEntry = pick((e) => state.offerings.get(e.offeringCode)?.requiredRoomType === "LAB");
  const lectureRoom = labEntry
    ? [...state.rooms.values()].find(
        (r) =>
          r.status === "ACTIVE" &&
          r.type === "LECTURE" &&
          r.capacity >= (state.sections.get(sectionOf(labEntry) ?? "")?.studentCount ?? 0) &&
          !revision.entries.some((o) => o.roomCode === r.code && overlaps(o, labEntry)),
      )
    : undefined;
  if (labEntry && lectureRoom) await edit(labEntry, { roomCode: lectureRoom.code });

  // HC-11: a class that runs past the end of the teaching day.
  const lateEntry = pick(() => true);
  if (lateEntry) {
    await edit(lateEntry, moveOnto(lateEntry, { weekday: lateEntry.weekday, startMin: term.dayEndMin - 30 }));
  }

  // HC-13: a class shortened below its required duration.
  const shortEntry = pick((e) => e.endMin - e.startMin > 60);
  if (shortEntry) await edit(shortEntry, { endMin: shortEntry.endMin - 30 });

  // HC-15: a class moved onto its section's fixed block (PATHFIT / GenEd).
  const blocks = [...state.fixedBlocks.values()].filter((b) => b.termCode === termCode);
  const blockEntry = pick((e) => blocks.some((b) => b.sectionCode === sectionOf(e)));
  const block = blockEntry ? blocks.find((b) => b.sectionCode === sectionOf(blockEntry)) : undefined;
  if (blockEntry && block) await edit(blockEntry, moveOnto(blockEntry, block));

  if (labEntry && lectureRoom) {
    await addScheduleException({
      scheduleId: revision.id,
      code: "HC-05",
      offeringCode: labEntry.offeringCode,
      roomCode: lectureRoom.code,
      reason: "Portable lab kits are used in this lecture room for the term",
      actor: DEAN,
    });
  }

  // 3. Directive types not used yet, and saved objective weights (SET_WEIGHT).
  step("conflicts-directives-and-weights");
  const directiveBase = {
    termCode,
    facultyCode: null,
    sectionCode: null,
    roomCode: null,
    offeringCode: null,
    weekday: null,
    startMin: null,
    endMin: null,
    weight: 2,
    createdBy: DEAN,
  };
  const pinned = rnd.pick(accepted.entries);
  if (pinned) {
    await addDirective({
      ...directiveBase,
      type: "PIN_MEETING",
      hardness: "SOFT",
      approved: true,
      offeringCode: pinned.offeringCode,
      facultyCode: pinned.facultyCode,
      roomCode: pinned.roomCode,
      weekday: pinned.weekday,
      startMin: pinned.startMin,
      endMin: pinned.endMin,
    });
    await addDirective({
      ...directiveBase,
      type: "ASSIGN_FACULTY",
      hardness: "SOFT",
      approved: true,
      offeringCode: pinned.offeringCode,
      facultyCode: pinned.facultyCode,
    });
  }
  const labOffering = rnd.pick(
    [...state.offerings.values()].filter((o) => o.termCode === termCode && o.requiredRoomType === "LAB"),
  );
  const labRoom = rnd.pick([...state.rooms.values()].filter((r) => r.status === "ACTIVE" && r.type === "LAB"));
  if (labOffering && labRoom) {
    await addDirective({
      ...directiveBase,
      type: "REQUIRE_ROOM",
      hardness: "HARD",
      approved: false,
      offeringCode: labOffering.code,
      roomCode: labRoom.code,
    });
  }
  const defaults: Record<string, number> = { ...CANDIDATE_PROFILES.BALANCED.weights };
  const sc05 = defaults["SC-05"] ?? 1;
  await saveSoftWeights({ termCode, weights: { ...defaults, "SC-05": Math.round(sc05 * 2) } }, defaults, ctx);

  // 4. Candidates with unscheduled meetings (HC-08) and every solver status.
  // A real solve runs first; statuses it does not produce are stored as
  // candidates of past runs, then checked by the validator like any schedule.
  step("conflicts-unscheduled-and-solver-statuses");
  let solved: ScheduleRecord | undefined;
  try {
    const run = await runScheduleGeneration(termCode, {
      profiles: ["STUDENT_FIRST"],
      timeLimitSeconds: 3,
      actor: DEAN,
    });
    solved = run.candidates[0];
  } catch (error) {
    logger.warn("seed_generation_skipped", { reason: error instanceof Error ? error.message : String(error) });
  }
  const template = solved ?? accepted;
  const required = [...state.offerings.values()]
    .filter((o) => o.termCode === termCode)
    .flatMap((o) =>
      Array.from({ length: o.meetingsPerWeek }, (_, meetingIndex) => ({ offeringCode: o.code, meetingIndex })),
    );
  const runWith = (status: GenerationRunRecord["status"]) =>
    [...state.generationRuns.values()].find((r) => r.termCode === termCode && r.status === status);
  type SolverStatus = NonNullable<ScheduleRecord["solverStatus"]>;
  const history: Array<[SolverStatus, string, "BALANCED" | "FACULTY_FIRST" | "STUDENT_FIRST", number, number, string]> = [
    ["BEST_FOUND", "Candidate D (time limit reached)", "STUDENT_FIRST", 1, 6.4, ""],
    ["CANCELLED", "Candidate E (cancelled run)", "BALANCED", 0.7, 0, "The run was cancelled before this meeting was placed."],
    ["INFEASIBLE", "Candidate F (infeasible)", "FACULTY_FIRST", 0, 0, "No placement satisfies every hard constraint for this meeting."],
  ];
  const seenStatuses = new Set(schedulesOfTerm().map((s) => s.solverStatus));
  for (const [solverStatus, label, profileName, keepShare, gap, detail] of history) {
    if (seenStatuses.has(solverStatus)) continue;
    const kept = template.entries.slice(0, Math.floor(template.entries.length * keepShare));
    const placed = new Set(kept.map((e) => `${e.offeringCode}#${e.meetingIndex ?? 0}`));
    const unscheduled: UnscheduledMeetingRecord[] =
      keepShare >= 1
        ? (template.unscheduled ?? [])
        : required
            .filter((m) => !placed.has(`${m.offeringCode}#${m.meetingIndex}`))
            .map((m) => ({ ...m, reasonCode: "NO_COMMON_SLOT", reasonDetail: detail }));
    const run = runWith(solverStatus === "CANCELLED" ? "CANCELLED" : "DONE");
    const id = crypto.randomUUID();
    state.schedules.set(id, {
      id,
      termCode,
      runId: run?.id ?? null,
      parentScheduleId: null,
      candidateLabel: label,
      profileName,
      status: "CANDIDATE",
      source: "GENERATED",
      solverStatus,
      optimalityGapPct: gap,
      recheckNeeded: false,
      version: 1,
      qualityScore: null,
      entries: kept.map((e) => ({ ...e, id: crypto.randomUUID() })),
      unscheduled,
      exceptions: [],
      changes: [],
      validationReport: null,
    });
    if (run) state.generationRuns.set(run.id, { ...run, candidateScheduleIds: [...run.candidateScheduleIds, id] });
    await checkExistingSchedule(id, { actor: DEAN });
  }

  // 5. Values not used yet: the other subject categories and meeting patterns,
  // offered in the next term so the current schedules are not affected.
  step("conflicts-categories-and-patterns");
  const extraSubjects = [
    ["ENGG-101", "Engineering Drawing and Plans", "GENERAL_ENGINEERING", 2, 3, 0, 3],
    ["MATH-101", "Calculus 1", "MATHEMATICS", 3, 3, 3, 0],
    ["PHYS-101", "Physics for Engineers", "SCIENCE", 4, 5, 3, 2],
    ["GE-01", "Understanding the Self", "GENERAL_EDUCATION", 3, 3, 3, 0],
    ["PATHFIT-1", "Movement Competency Training", "PATHFIT", 2, 2, 2, 0],
  ] as const;
  for (const [code, name, category, units, contactHours, lectureHours, labHours] of extraSubjects) {
    if (state.subjects.has(code)) continue;
    await upsertSubject(
      { code, name, description: "", programCode: null, yearLevel: 1, category, units, contactHours, lectureHours, labHours, curriculumVersion: "2024", isCurrentCurriculum: true },
      ctx,
    );
  }
  const nextTerm = [...state.terms.values()].find((t) => t.status === "READY");
  const section = rnd.pick([...state.sections.values()]);
  if (nextTerm && section) {
    const patterns = [
      ["PATHFIT-1", "SINGLE", 1, 120],
      ["GE-01", "ANY", 2, 90],
    ] as const;
    for (const [subjectCode, meetingPattern, meetingsPerWeek, minutesPerMeeting] of patterns) {
      const code = `${section.code}-${subjectCode}-S2`;
      if (state.offerings.has(code)) continue;
      await upsertOffering(
        {
          code,
          termCode: nextTerm.code,
          sectionCode: section.code,
          subjectCode,
          component: "LECTURE",
          meetingsPerWeek,
          minutesPerMeeting,
          meetingPattern,
          requiredRoomType: "LECTURE",
        },
        ctx,
      );
    }
  }

}

/**
 * Re-checks every open schedule of the term against the current data, last,
 * because master-data saves flag all schedules for a recheck.
 */
async function recheckOpenSchedules(termCode: string): Promise<void> {
  step("recheck-open-schedules");
  const schedulesOfTerm = () =>
    [...getMasterDataState().schedules.values()].filter((s) => s.termCode === termCode);
  for (const s of schedulesOfTerm()) {
    if (s.status !== "ARCHIVED" && s.recheckNeeded) await checkExistingSchedule(s.id, { actor: DEAN });
  }
  logger.info("seed_conflicts_summary", {
    schedules: schedulesOfTerm().map((s) => ({
      label: s.candidateLabel,
      status: s.status,
      solverStatus: s.solverStatus ?? null,
      hard: s.validationReport?.hard_violation_count ?? null,
      waived: s.validationReport?.waived_violation_count ?? null,
      codes: [...new Set((s.validationReport?.violations ?? []).map((v) => v.code))].sort().join(","),
    })),
  });
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function persist(prisma: PrismaClient, before: LoadedState, audits: Audit[]): Promise<number> {
  const changes = diffState(before.snapshot, getMasterDataState(), before.aliasCounter);
  await prisma.$transaction(
    async (tx) => {
      const claimed = await claimNextVersion(tx, before.version, changes.aliasCounter);
      if (!claimed) throw new Error("The database changed while seeding. Nothing was written.");
      await applyChanges(tx, changes);
      const json = (value: unknown) =>
        value === undefined || value === null ? undefined : JSON.parse(JSON.stringify(value));
      await tx.auditLog.createMany({
        data: audits.map((a) => ({
          actor: a.actor,
          action: a.action,
          entity: a.entity,
          entityId: a.entityId,
          before: json(a.before),
          after: json(a.after),
          ipAddress: null,
          createdAt: a.createdAt,
        })),
      });
    },
    { maxWait: 20_000, timeout: 300_000 },
  );
  return changes.count;
}

describe.skipIf(!enabled)("seed test data into PostgreSQL", () => {
  // A small pool: the Supabase session pooler caps clients per project, and a
  // running dev server already holds some of them.
  const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", "4");
  url.searchParams.set("pool_timeout", "30");
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const audits: Audit[] = [];

  afterAll(async () => {
    setAuditSinkForTests(null);
    await prisma.$disconnect();
  });

  it(statusesOnly ? "adds every status value to the seeded data" : "fills every domain table through the real service flows", async () => {
    setAuditSinkForTests({
      async write(input) {
        const createdAt = new Date();
        audits.push({ ...input, createdAt });
        return { ...input, id: crypto.randomUUID(), createdAt };
      },
    });

    const randomSeed = Number(process.env.ORDIQ_SEED_RANDOM) || Date.now() % 2_147_483_647;
    logger.info("seed_random", { seed: randomSeed });
    const rnd = createRandom(randomSeed);
    const fixture = generateMediumCollegeFixture();

    const before = await loadState(prisma);
    const filled = [...before.snapshot].filter(([, rows]) => rows.size > 0);
    if (statusesOnly) {
      if (before.state.faculty.size === 0) {
        throw new Error("The database has no seeded data yet. Run the full seed first. Nothing was written.");
      }
    } else if (filled.length > 0) {
      throw new Error(
        `The database already has data (${filled
          .map(([name, rows]) => `${name}: ${rows.size}`)
          .join(", ")}). Nothing was written.`,
      );
    }
    replaceMasterDataState(before.state);

    if (!statusesOnly) await seedCoreData(fixture);
    await applyStatusVariety(fixture, rnd);
    await applyConflictScenarios(fixture, rnd);
    await recheckOpenSchedules(fixture.term.code);

    step("save");
    const records = await persist(prisma, before, audits);
    logger.info("seed_saved", { records, audits: audits.length });
  }, 15 * 60_000);
});
