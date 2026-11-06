import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuditSinkForTests } from "../../platform/audit";
import { generateSmallFixture, loadFixtureIntoStore } from "../fixtures/fixture.generator";
import { getMasterDataState, resetMasterDataState } from "../master-data/master-data.store";
import { runAiAssistantTurn, SYSTEM_PROMPT_V1 } from "./ai-orchestrator";
import { runLiveAssistantTurn } from "./live-assistant";
import { DEFAULT_LLM_MODELS, type LlmConfig, resolveLlmConfig } from "./llm-provider";
import { clearCapturedLlmEgressPayloads, getCapturedLlmEgressPayloads } from "./privacy-gateway";

const TERM = "AY2026-2027-S1";

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const LIVE_CONFIG: LlmConfig = {
  provider: "openai",
  model: "mock-model",
  live: true,
  apiKey: "test",
};

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  try {
    run();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("LLM provider configuration", () => {
  it("stays offline without a usable key or under the test runner", () => {
    withEnv({ LLM_LIVE_TESTS: "1", LLM_PROVIDER: "openai", LLM_API_KEY: "sk-placeholder-dev-key" }, () => {
      const config = resolveLlmConfig();
      expect(config.live).toBe(false);
      expect(config.offlineReason).toMatch(/LLM_API_KEY/);
    });
    withEnv({ LLM_LIVE_TESTS: undefined, LLM_PROVIDER: "anthropic", LLM_API_KEY: "sk-ant-real" }, () => {
      expect(resolveLlmConfig().live).toBe(false);
    });
    withEnv({ LLM_LIVE_TESTS: "1", LLM_PROVIDER: "offline", LLM_API_KEY: "sk-real" }, () => {
      expect(resolveLlmConfig().live).toBe(false);
    });
  });

  it("goes live with a key, and Ollama needs none", () => {
    withEnv(
      { LLM_LIVE_TESTS: "1", LLM_PROVIDER: "anthropic", LLM_MODEL: undefined, LLM_API_KEY: "sk-ant-real" },
      () => {
        const config = resolveLlmConfig();
        expect(config).toMatchObject({ live: true, provider: "anthropic", model: DEFAULT_LLM_MODELS.anthropic });
      },
    );
    withEnv({ LLM_LIVE_TESTS: "1", LLM_PROVIDER: "ollama", LLM_API_KEY: undefined, LLM_MODEL: "llama3.2" }, () => {
      expect(resolveLlmConfig()).toMatchObject({ live: true, provider: "ollama", model: "llama3.2" });
    });
  });

  it("does not reuse a model id configured for a different provider", () => {
    withEnv({ LLM_LIVE_TESTS: "1", LLM_PROVIDER: "openai", LLM_MODEL: "gpt-x", LLM_API_KEY: "sk-real" }, () => {
      expect(resolveLlmConfig("anthropic").model).toBe(DEFAULT_LLM_MODELS.anthropic);
      expect(resolveLlmConfig("openai").model).toBe("gpt-x");
    });
  });
});

describe("live assistant turn (mock provider)", () => {
  beforeEach(async () => {
    resetMasterDataState();
    clearCapturedLlmEgressPayloads();
    setAuditSinkForTests({
      write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }),
    });
    await loadFixtureIntoStore(generateSmallFixture(), { actor: "dean" });
  });

  afterEach(() => {
    setAuditSinkForTests(null);
  });

  it("runs the tool loop with only pseudonymized text leaving ORDIQ and restores names in the reply", async () => {
    const state = getMasterDataState();
    const faculty = Array.from(state.faculty.values());
    const target = faculty[0];
    if (!target) throw new Error("fixture has no faculty");

    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "get_faculty_load",
                input: JSON.stringify({ facultyCode: target.alias }),
              },
            ],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: `${target.alias} carries a normal load this term.` }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });

    const history = [
      {
        id: "u1",
        conversationId: "c1",
        role: "user" as const,
        content: `What is the teaching load of ${target.name}? Contact: someone@mseuf.edu.ph`,
        parts: [],
        createdAt: new Date().toISOString(),
      },
    ];

    const result = await runLiveAssistantTurn({
      config: LIVE_CONFIG,
      systemPrompt: SYSTEM_PROMPT_V1,
      history,
      termCode: TERM,
      actor: "dean",
      languageModel: model,
    });

    // The model's alias argument was resolved to the real faculty code.
    expect(result.toolCalls).toEqual([
      { toolName: "get_faculty_load", args: { facultyCode: target.code, termCode: TERM } },
    ]);
    expect(result.toolResults[0]?.structuredPart.kind).toBe("chart_card");

    // Both provider calls (before and after the tool result) are name-free.
    expect(model.doGenerateCalls).toHaveLength(2);
    for (const call of model.doGenerateCalls) {
      const sent = JSON.stringify(call.prompt).toLowerCase();
      for (const fac of faculty) {
        expect(sent).not.toContain(fac.name.toLowerCase());
      }
      expect(sent).toContain(target.alias.toLowerCase());
      expect(sent).not.toContain("someone@mseuf.edu.ph");
    }
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain("facultyLoads");

    // Every call was captured for the egress audit.
    expect(getCapturedLlmEgressPayloads()).toHaveLength(2);

    // The Dean sees the real name, not the alias.
    expect(result.text).toContain(target.name);
    expect(result.text).not.toMatch(/ALIAS-\d{3}/);

    // Real token usage is logged, without content.
    expect(result.tokensIn).toBe(200);
    expect(result.tokensOut).toBe(40);
    const logged = state.llmUsage.at(-1);
    expect(logged).toMatchObject({ provider: "openai", model: "mock-model", tokensIn: 200, tokensOut: 40 });
  });

  it("falls back to the built-in assistant when the provider cannot be reached", async () => {
    vi.stubEnv("LLM_LIVE_TESTS", "1");
    vi.stubEnv("LLM_PROVIDER", "ollama");
    vi.stubEnv("LLM_MODEL", "unreachable");
    vi.stubEnv("LLM_BASE_URL", "http://127.0.0.1:9/v1");
    try {
      const turn = await runAiAssistantTurn({ termCode: TERM, prompt: "Is the data ready for generation?" });
      expect(turn.mode).toBe("offline-fallback");
      expect(turn.invokedTool).toBe("get_data_readiness");
      expect(turn.assistantMessage.content).toContain("built-in assistant");
    } finally {
      vi.unstubAllEnvs();
    }
  }, 30_000);
});
