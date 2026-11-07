import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "../../../platform/audit";
import { generateSmallFixture, loadFixtureIntoStore } from "../../fixtures/fixture.generator";
import { getMasterDataState, resetMasterDataState } from "../../master-data/master-data.store";
import { SYSTEM_PROMPT_V1 } from "../ai-orchestrator";
import { runLiveAssistantTurn } from "../live-assistant";
import { resolveLlmConfig } from "../llm-provider";
import { GOLDEN_DOC_QUESTIONS } from "./golden-doc-questions";

/**
 * Live evaluation of documentation answers against the real AI provider.
 * Skipped unless LLM_LIVE_TESTS=1 and a provider key is set, because every
 * question spends tokens from the monthly budget.
 *
 *   LLM_LIVE_TESTS=1 LLM_EVAL_LIMIT=20 pnpm --filter @ordiq/web exec \
 *     vitest run src/server/modules/ai/knowledge/knowledge-live.eval.test.ts
 *
 * LLM_EVAL_LIMIT (default 20) caps how many questions run. Questions are
 * spread evenly across the evaluation set so every topic is covered.
 */

const config = resolveLlmConfig();
const limit = Math.max(1, Number(process.env.LLM_EVAL_LIMIT ?? 20));
const withAnswers = GOLDEN_DOC_QUESTIONS.filter((g) => g.answerHas?.length);
const step = Math.max(1, Math.floor(withAnswers.length / limit));
const sample = withAnswers.filter((_, i) => i % step === 0).slice(0, limit);
const pauseMs = Number(process.env.LLM_EVAL_PAUSE_MS ?? 4000);

const results: Array<{ q: string; pass: boolean; answer: string }> = [];

describe.skipIf(!config.live)("live documentation answers", () => {
  beforeAll(async () => {
    resetMasterDataState();
    setAuditSinkForTests({
      write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }),
    });
    await loadFixtureIntoStore(generateSmallFixture(), { actor: "dean" });
  });

  afterAll(() => {
    setAuditSinkForTests(null);
    const passed = results.filter((r) => r.pass).length;
    console.log(`\nLive documentation evaluation (${config.provider} ${config.model}): ${passed}/${results.length} passed`);
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  FAIL: ${r.q}\n        ${r.answer.replace(/\s+/g, " ").slice(0, 240)}`);
    }
  });

  it.each(sample)(
    "$q",
    async ({ q, answerHas = [] }) => {
      await new Promise((r) => setTimeout(r, pauseMs)); // stay under free-tier rate limits
      const result = await runLiveAssistantTurn({
        config,
        systemPrompt: SYSTEM_PROMPT_V1,
        history: [{ id: "u", conversationId: "eval", role: "user", content: q, parts: [], createdAt: new Date().toISOString() }],
        termCode: "AY2026-2027-S1",
        actor: "dean",
      });
      const answer = result.text;
      const pass = answerHas.some((w) => answer.toLowerCase().includes(w.toLowerCase()));
      results.push({ q, pass, answer });

      expect(answer.trim().length).toBeGreaterThan(0);
      for (const fac of getMasterDataState().faculty.values()) {
        // Real names may appear only where the gateway restored an alias the model used.
        expect(result.toolResults.length > 0 || !answer.includes(fac.name)).toBe(true);
      }
      expect(pass, `answer should mention one of ${answerHas.join(", ")}: ${answer}`).toBe(true);
    },
    120_000,
  );
});
