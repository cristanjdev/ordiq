import { generateText, isStepCount, type ModelMessage, tool, type ToolSet, wrapLanguageModel } from "ai";
import type { z } from "zod";
import { getMasterDataState, type MessageRecord } from "../master-data/master-data.store";
import {
  formatKnowledgeForPrompt,
  isDocumentationQuestion,
  type KnowledgeHit,
  searchKnowledge,
} from "./knowledge/knowledge.service";
import { logger } from "../../platform/logger";
import {
  createLanguageModel,
  isTransientLlmError,
  type LlmConfig,
  providerOptionsFor,
  type ProviderLanguageModel,
} from "./llm-provider";
import {
  assertWithinTokenBudget,
  createPrivacyMiddleware,
  getCapturedLlmEgressPayloads,
  recordLlmUsage,
  restoreAliasedReply,
} from "./privacy-gateway";
import {
  ALLOWED_AI_TOOL_NAMES,
  type AiToolExecutionResult,
  type AiToolName,
  AiToolSchemas,
  executeAiTool,
} from "./tools";

/**
 * Live assistant turn: a real model chooses among the 14 approved tools in a
 * bounded loop. The model sees only pseudonymized text (enforced by the
 * privacy middleware on the model itself) and has no write path beyond the
 * candidate-level tools; refusals are decided before this runs.
 */

const TOOL_DESCRIPTIONS: Record<AiToolName, string> = {
  get_data_readiness:
    "Data readiness for the term: ISO/IEC 25012 quality scores, critical gaps and warnings, and whether generation can run.",
  check_conflicts:
    "Run the independent validator on a schedule and list hard-constraint violations, optionally filtered by faculty, room or section.",
  compare_candidates:
    "Compare two candidate schedules side by side (quality, conflicts, unscheduled meetings). Defaults to the first two candidates of the term.",
  get_schedule_summary:
    "Headline metrics of a schedule: meetings placed, hard conflicts, quality score, room utilization.",
  get_entries:
    "List schedule entries (class meetings), filtered by faculty, room, section or weekday. Returns at most 30.",
  get_unscheduled: "Meetings the solver could not place, with reason codes.",
  get_unmet_preferences: "Faculty preferences the schedule does not satisfy, optionally for one faculty member.",
  get_faculty_load: "Teaching load per faculty member: assigned units against regular and overload limits.",
  get_room_utilization: "Room usage minutes and utilization percentage, optionally for one room.",
  find_alternative_slots:
    "Conflict-free alternative slots for one meeting of an offering, with the quality change each would cause.",
  get_recommendations: "Best-fit faculty for a subject from the ML recommender, with scores and factors.",
  add_directive:
    "Add a scheduling directive (a rule for the next generation run). It does not change any existing schedule.",
  generate_schedule:
    "Run the solver to produce new candidate schedules. Candidates are never official until the Dean accepts one in the workspace.",
  propose_change:
    "Create a change proposal for one meeting (new day, start, room or faculty). The validator checks it; only the Dean can apply it.",
};

function liveInstructions(
  basePrompt: string,
  context: { termCode: string; scheduleId?: string; knowledge: string },
): string {
  const reference = context.knowledge
    ? `

Reference documentation (excerpts from the ORDIQ project documents, chosen for this question):
"""
${context.knowledge}
"""
How to use the reference documentation:
- Answer questions about how ORDIQ works (screens, steps, rules HC-01 to HC-15 and SC-01 to SC-16, settings, privacy, reports, the study itself) from these excerpts only. Do not add steps, buttons, limits or features that the excerpts do not state.
- Name where to go using the page and section, for example "Settings › Sign-in security" or "Rules & Preferences › Dean Directives".
- When excerpts disagree, follow the "ORDIQ In-App Guide" and the "ORDIQ FAQ"; they describe the current screens.
- Never take this term's figures from the documents; call the tools for any count, name or metric of the term.
- If the excerpts and the tools do not cover the question, say that ORDIQ's documents do not cover it and suggest who or where to ask, instead of guessing.
- Answer naturally; do not mention "excerpts", "reference documentation" or numbered sources.`
    : "";
  return `${basePrompt}

Working context:
- Term: ${context.termCode}. Every tool already uses this term.${
    context.scheduleId ? `\n- Schedule in view: ${context.scheduleId}. Tools default to it.` : ""
  }
- Faculty arguments accept FAC-XXX codes or the ALIAS-XXX codes shown in tool results.
- startMin/endMin are minutes after midnight (480 = 8:00 AM, 780 = 1:00 PM). Show clock times to the Dean.

How to answer:
- Call tools for any figure you report. Never estimate or invent schedule metrics, counts or names.
- Reply in the Dean's language (English, Filipino or Taglish). Use a professional, respectful and calm tone, as a capable staff assistant would; no slang, emojis or exclamation marks.
- Lead with the direct answer in one sentence. For a how-to question, follow with short numbered steps. Keep most replies under about 120 words unless the Dean asks for detail.
- If a question is ambiguous (for example which faculty member, section or candidate), ask one short clarifying question instead of guessing.
- When you are not certain, say so and point to the page where the Dean can confirm.
- After propose_change, say the Dean must Apply or Reject the proposal card. After generate_schedule, say the candidates are ready to review in the Schedule Workspace.
- If a request needs a write you cannot do, say so and point to the workspace.${reference}`;
}

/**
 * Documentation passages for the latest question. A short follow-up ("and
 * where is that?") is searched together with the previous question.
 */
export function retrieveKnowledgeForTurn(history: MessageRecord[]): KnowledgeHit[] {
  const asked = history.filter((m) => m.role === "user");
  const latest = asked[asked.length - 1]?.content ?? "";
  if (!latest.trim()) return [];
  const previous = asked[asked.length - 2]?.content ?? "";
  const query = latest.trim().split(/\s+/).length < 5 && previous ? `${previous} ${latest}` : latest;
  // How-to questions get more reference text; data questions only a little,
  // since their answers come from the tools.
  return isDocumentationQuestion(latest)
    ? searchKnowledge(query, { limit: 4, minScore: 3 })
    : searchKnowledge(query, { limit: 2, minScore: 6 });
}

function resolveFacultyRef(value: unknown): unknown {
  if (typeof value !== "string" || !/^ALIAS-\d{3}$/i.test(value.trim())) return value;
  const alias = value.trim().toUpperCase();
  for (const fac of getMasterDataState().faculty.values()) {
    if (fac.alias.toUpperCase() === alias) return fac.code;
  }
  return value;
}

export interface LiveTurnResult {
  text: string;
  streamedChunks: string[];
  toolResults: AiToolExecutionResult[];
  toolCalls: Array<{ toolName: AiToolName; args: Record<string, unknown> }>;
  tokensIn: number;
  tokensOut: number;
  estimatedCostPhp: number;
  egressPayloadId: string;
  /** Documentation passages given to the model for this turn. */
  knowledgeHits: KnowledgeHit[];
}

export async function runLiveAssistantTurn(input: {
  config: LlmConfig;
  systemPrompt: string;
  history: MessageRecord[];
  termCode: string;
  scheduleId?: string;
  actor: string;
  /** Test seam: use this model instead of creating one from `config`. */
  languageModel?: ProviderLanguageModel;
}): Promise<LiveTurnResult> {
  assertWithinTokenBudget();

  const toolResults: AiToolExecutionResult[] = [];
  const toolCalls: LiveTurnResult["toolCalls"] = [];
  const tools: ToolSet = {};
  for (const name of ALLOWED_AI_TOOL_NAMES) {
    const schema = (AiToolSchemas[name] as z.AnyZodObject).omit({ termCode: true });
    tools[name] = tool({
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: schema,
      execute: async (toolInput: Record<string, unknown>) => {
        const args: Record<string, unknown> = {
          ...toolInput,
          termCode: input.termCode,
          ...(input.scheduleId && toolInput.scheduleId === undefined && "scheduleId" in schema.shape
            ? { scheduleId: input.scheduleId }
            : {}),
        };
        if ("facultyCode" in args) args.facultyCode = resolveFacultyRef(args.facultyCode);
        toolCalls.push({ toolName: name, args });
        const result = await executeAiTool(name, args, input.actor);
        toolResults.push(result);
        return result.sanitizedResultForLlm;
      },
    });
  }

  const model = wrapLanguageModel({
    model: input.languageModel ?? createLanguageModel(input.config),
    middleware: createPrivacyMiddleware({
      provider: input.config.provider,
      model: input.config.model,
    }),
  });

  // Prior turns as plain text; tool output from earlier turns is not replayed.
  const messages: ModelMessage[] = input.history.slice(-12).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const latestQuestion = input.history.filter((m) => m.role === "user").pop()?.content ?? "";
  const knowledgeHits = retrieveKnowledgeForTurn(input.history);
  const knowledge = formatKnowledgeForPrompt(
    knowledgeHits,
    isDocumentationQuestion(latestQuestion) ? 6000 : 2500,
  );

  const instructions = liveInstructions(input.systemPrompt, { ...input, knowledge });
  const providerOptions = providerOptionsFor(input.config);
  const attempt = () =>
    generateText({
      model,
      instructions,
      messages,
      tools,
      stopWhen: isStepCount(6),
      maxOutputTokens: 1500,
      timeout: { totalMs: 60_000, stepMs: 25_000 },
      ...(providerOptions ? { providerOptions } : {}),
    });

  // One retry on a timeout or dropped connection before the caller falls back
  // to the built-in assistant. Tool calls are read-only, so repeating them is
  // safe; the first attempt's records are discarded.
  let result: Awaited<ReturnType<typeof attempt>>;
  try {
    result = await attempt();
  } catch (error) {
    if (!isTransientLlmError(error)) throw error;
    logger.warn("ai_provider_retry", {
      provider: input.config.provider,
      model: input.config.model,
      error: error instanceof Error ? error.name : "unknown",
    });
    toolResults.length = 0;
    toolCalls.length = 0;
    result = await attempt();
  }

  const tokensIn = result.totalUsage.inputTokens ?? 0;
  const tokensOut = result.totalUsage.outputTokens ?? 0;
  const usage = recordLlmUsage(input.config.provider, input.config.model, tokensIn, tokensOut);

  // The model only knows aliases; restore real names for the Dean.
  const streamedChunks = restoreAliasedReply(result.text);
  const egress = getCapturedLlmEgressPayloads();

  return {
    text: streamedChunks.join(""),
    streamedChunks,
    toolResults,
    toolCalls,
    tokensIn,
    tokensOut,
    estimatedCostPhp: usage.estimatedCostPhp,
    egressPayloadId: egress[egress.length - 1]?.id ?? "none",
    knowledgeHits,
  };
}
