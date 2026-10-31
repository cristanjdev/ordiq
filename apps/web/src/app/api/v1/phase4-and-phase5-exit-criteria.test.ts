import { beforeEach, describe, expect, it } from "vitest";
import { createEngineClient } from "../../../server/engine/engine.client";
import {
  reviewChangeProposal,
  runAiAssistantTurn,
} from "../../../server/modules/ai/ai-orchestrator";
import { GOLDEN_EVALUATION_PROMPTS } from "../../../server/modules/ai/golden-prompts";
import {
  clearCapturedLlmEgressPayloads,
  DePseudonymizerStream,
  getCapturedLlmEgressPayloads,
  pseudonymizeText,
} from "../../../server/modules/ai/privacy-gateway";
import {
  ALLOWED_AI_TOOL_NAMES,
  FORBIDDEN_WRITE_ACTIONS,
} from "../../../server/modules/ai/tools";
import {
  generateSmallFixture,
  loadFixtureIntoStore,
} from "../../../server/modules/fixtures/fixture.generator";
import {
  buildProblemSnapshot,
  runScheduleGeneration,
} from "../../../server/modules/generation/generation.service";
import {
  getMasterDataState,
  resetMasterDataState,
} from "../../../server/modules/master-data/master-data.store";
import {
  getMlEvaluationReport,
  getSubjectFacultyRecommendations,
  recordLearningEvent,
  rollbackModelVersion,
  trainAndEvaluateFitModel,
} from "../../../server/modules/ml/ml.service";
import { setAuditSinkForTests } from "../../../server/platform/audit";

describe("Phase 4 (Generative AI Assistant) & Phase 5 (Machine Learning) Exit Criteria", () => {
  beforeEach(async () => {
    resetMasterDataState();
    clearCapturedLlmEgressPayloads();
    setAuditSinkForTests({
      async write(input) {
        return {
          ...input,
          id: crypto.randomUUID(),
          createdAt: new Date(),
        };
      },
    });
    const small = generateSmallFixture();
    await loadFixtureIntoStore(small, { actor: "dean" });
  });

  it("Phase 4 Exit Criteria 1, 2, 4, 5, 6: Egress test across all 32 Golden Prompts (EN/FIL/Taglish) has 0 faculty names in LLM requests, restores real names in replies, and refuses adversarial/unsupported actions", async () => {
    await runScheduleGeneration("AY2026-2027-S1", {
      profiles: ["BALANCED", "FACULTY_FIRST"],
      timeLimitSeconds: 5,
    });

    const state = getMasterDataState();
    const allFaculty = Array.from(state.faculty.values());
    expect(allFaculty.length).toBeGreaterThan(0);

    for (const testCase of GOLDEN_EVALUATION_PROMPTS) {
      const turn = await runAiAssistantTurn({
        termCode: "AY2026-2027-S1",
        prompt: testCase.prompt,
      });

      expect(turn.refused).toBe(testCase.expectRefusal);
      expect(turn.invokedTool).toBe(testCase.expectedTool);

      if (testCase.expectsFacultyNameInReply) {
        expect(turn.assistantMessage.content).toContain(
          testCase.expectsFacultyNameInReply,
        );
      }
      expect(turn.assistantMessage.content).not.toMatch(/\bALIAS-\d{3}\b/);
    }

    // Verify Egress Test: Every captured LLM request across all 32 golden prompts contains ZERO faculty full names or surnames
    const captured = getCapturedLlmEgressPayloads();
    expect(captured.length).toBe(GOLDEN_EVALUATION_PROMPTS.length);

    for (const payload of captured) {
      const serialized = JSON.stringify(payload).toLowerCase();
      for (const fac of allFaculty) {
        const fullLower = fac.name.toLowerCase();
        const surnameTokens = fac.name
          .replace(/^(?:engr\.|dr\.|prof\.|mr\.|ms\.)\s+/i, "")
          .split(/\s+/);
        const surname = (
          surnameTokens[surnameTokens.length - 1] ?? ""
        ).toLowerCase();

        expect(serialized).not.toContain(fullLower);
        if (surname.length >= 4) {
          expect(serialized).not.toMatch(new RegExp(`\\b${surname}\\b`, "i"));
        }
      }
    }

    // Verify closed tool list contains no apply, accept, delete, or master-data edit tool
    for (const forbidden of FORBIDDEN_WRITE_ACTIONS) {
      expect(ALLOWED_AI_TOOL_NAMES).not.toContain(forbidden);
    }
  }, 60000);

  it("Phase 4 Exit Criteria 2, 3, 7: Streaming de-pseudonymizer handles split ALIAS tokens, Dean completes conversational workflow + proposal apply, and switching LLM_PROVIDER works without code changes", async () => {
    const state = getMasterDataState();
    const firstFac = Array.from(state.faculty.values())[0];
    if (!firstFac) throw new Error("Expected firstFac");

    // 1. Test fuzzy matching and accent insensitivity in pseudonymizeText
    const rawWithTyposAndAccents = `Please check Prof. Sntos and Engr. María Clára Sántos or email santos@mseuf.edu.ph`;
    const scrubbed = pseudonymizeText(rawWithTyposAndAccents);
    expect(scrubbed).toContain(firstFac.alias);
    expect(scrubbed).toContain("[REDACTED-EMAIL]");
    expect(scrubbed.toLowerCase()).not.toContain("santos");

    // 2. Test split chunk boundary restoration in DePseudonymizerStream
    const stream = new DePseudonymizerStream();
    const out1 = stream.pushChunk("Assigned to AL");
    const out2 = stream.pushChunk("IAS-00");
    const out3 = stream.pushChunk("1 on Monday.");
    const out4 = stream.flush();
    const combined = out1 + out2 + out3 + out4;
    expect(combined).toContain(firstFac.name);
    expect(combined).not.toContain("ALIAS-001");

    // 3. Switch providers (openai -> anthropic -> ollama) and complete conversational workflow
    const dirTurn = await runAiAssistantTurn({
      termCode: "AY2026-2027-S1",
      prompt: `Huwag bigyan ng early class si ${firstFac.name} tuwing Lunes.`,
      provider: "openai",
    });
    expect(dirTurn.provider).toBe("openai");
    expect(dirTurn.invokedTool).toBe("add_directive");

    const genTurn = await runAiAssistantTurn({
      termCode: "AY2026-2027-S1",
      conversationId: dirTurn.conversationId,
      prompt: "Generate candidate schedules for this semester.",
      provider: "anthropic",
    });
    expect(genTurn.provider).toBe("anthropic");
    expect(genTurn.invokedTool).toBe("generate_schedule");

    const propTurn = await runAiAssistantTurn({
      termCode: "AY2026-2027-S1",
      conversationId: dirTurn.conversationId,
      prompt:
        "Propose a change to move offering OFF-CPE-1A-CPE101 to Wednesday.",
      provider: "ollama",
    });
    expect(propTurn.provider).toBe("ollama");
    expect(propTurn.invokedTool).toBe("propose_change");

    // 4. Dean applies the proposal through the explicit UI review service (re-validating at apply time)
    const pendingProposal = Array.from(state.proposals.values()).find(
      (p) => p.status === "PENDING",
    );
    if (!pendingProposal) throw new Error("Expected pendingProposal");
    const applied = await reviewChangeProposal({
      proposalId: pendingProposal.id,
      decision: "APPLY",
      actor: "dean@mseuf.edu.ph",
    });
    expect(applied.status).toBe("APPLIED");
  }, 60000);

  it("Phase 5 Exit Criteria 1, 2, 3, 4, 5: Cold-start & warm-start recommendations, beats random baseline, Dean edits shift learned preferences while preserving declared priority, extreme ML scores never break validator, and model rollback works", async () => {
    const state = getMasterDataState();

    // 1. Cold-start recommendation (0 semesters of history / 0 trained models)
    state.schedules.clear();
    state.learningEvents.length = 0;
    const coldRec = await getSubjectFacultyRecommendations("CPE-101", 3);
    expect(coldRec.coldStart).toBe(true);
    expect(coldRec.recommendations.length).toBeGreaterThan(0);

    // 2. Reload fixture with 1 semester of imported schedule and train v1 model
    const small = generateSmallFixture();
    await loadFixtureIntoStore(small, { actor: "dean" });
    const v1Train = await trainAndEvaluateFitModel(
      "dean@mseuf.edu.ph",
      "AY2026-2027-S1",
    );
    expect(v1Train.promoted).toBe(true);
    expect(v1Train.newVersion.versionNumber).toBe(1);

    const warmRec = await getSubjectFacultyRecommendations("CPE-101", 3);
    expect(warmRec.coldStart).toBe(false);
    expect(warmRec.activeModelVersion).toBe(1);
    expect(warmRec.recommendations[0]?.factors.length).toBeGreaterThan(0);

    // 3. Verify model beats random baseline and reports text similarity baseline honestly
    const evalReport = getMlEvaluationReport();
    expect(evalReport.comparisons.beatsRandom).toBe(true);
    expect(evalReport.comparisons.modelTop1Accuracy).toBeGreaterThan(
      evalReport.comparisons.randomBaselineTop1,
    );
    expect(
      typeof evalReport.comparisons.textSimilarityBaselineTop1,
    ).toBe("number");

    // 4. Repeated Dean edits create LEARNED preferences while keeping declared preferences higher
    const targetFaculty = "FAC-001";
    for (let i = 0; i < 6; i += 1) {
      recordLearningEvent({
        termCode: "AY2026-2027-S1",
        scheduleId: "SCHED-TEST",
        type: "DEAN_EDIT",
        facultyCode: targetFaculty,
        subjectCode: "CPE-101",
        weekday: "SATURDAY",
        startMin: 810,
      });
    }

    const currentState = getMasterDataState();
    const learnedPrefs = Array.from(
      currentState.facultyPreferences.values(),
    ).filter((p) => p.facultyCode === targetFaculty && p.source === "LEARNED");
    expect(learnedPrefs.length).toBeGreaterThan(0);
    const declaredPrefs = Array.from(
      currentState.facultyPreferences.values(),
    ).filter((p) => p.facultyCode === targetFaculty && p.source !== "LEARNED");
    for (const lp of learnedPrefs) {
      expect(lp.weight).toBeLessThanOrEqual(4);
      for (const dp of declaredPrefs) {
        expect(dp.weight).toBeGreaterThan(lp.weight);
      }
    }

    // 5. Train v2 and test rollback to v1
    const v2Train = await trainAndEvaluateFitModel(
      "dean@mseuf.edu.ph",
      "AY2026-2027-S1",
    );
    expect(v2Train.newVersion.versionNumber).toBe(2);

    const rolledBack = await rollbackModelVersion(
      v1Train.newVersion.id,
      "dean@mseuf.edu.ph",
    );
    expect(rolledBack.versionNumber).toBe(1);
    expect(rolledBack.status).toBe("ACTIVE");

    // 6. Prove ML never makes a schedule invalid even with extreme ML fit scores
    const engineClient = createEngineClient();
    const problem = buildProblemSnapshot("AY2026-2027-S1");
    problem.ml_fit_scores = {
      "FAC-001:CPE-101": 1.0,
      "FAC-002:CPE-102": 0.0,
    };
    const solveRes = await engineClient.startSolveJob({
      problem,
      profile_name: "BALANCED",
      time_limit_seconds: 5,
    });
    const valRes = await engineClient.validateSchedule({
      problem,
      entries: solveRes.solution?.entries ?? [],
    });
    expect(valRes.valid).toBe(true);
    expect(valRes.hard_violation_count).toBe(0);
  }, 60000);
});
