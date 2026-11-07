import type { Weekday } from "@ordiq/contracts";
import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import { logger } from "../../platform/logger";
import { runLiveAssistantTurn } from "./live-assistant";
import { type LlmProvider, resolveLlmConfig } from "./llm-provider";
import {
  type ChangeProposalRecord,
  type ConversationRecord,
  getMasterDataState,
  type MessageRecord,
} from "../master-data/master-data.store";
import { editScheduleEntry } from "../schedules/schedules.service";
import {
  buildFacultyPseudonymTable,
  invokeLlmThroughPrivacyGateway,
  normalizeDiacritics,
  pseudonymizeText,
} from "./privacy-gateway";
import {
  focusExcerpt,
  isDocumentationQuestion,
  type KnowledgeHit,
  searchKnowledge,
} from "./knowledge/knowledge.service";
import {
  type AiToolExecutionResult,
  type AiToolName,
  executeAiTool,
} from "./tools";

export const SYSTEM_PROMPT_V1 = `You are the ORDIQ Scheduling Assistant for the College of Engineering at Manuel S. Enverga University Foundation (MSEUF), Lucena City.
Version: v1.0 (Quotation Q-2026-002).
Capabilities & Boundaries:
1. You assist the Dean in English, Filipino, and Taglish.
2. Faculty names are pseudonymized as ALIAS-XXX. Refer to faculty using their ALIAS-XXX code so the Privacy Gateway restores their real names for the Dean.
3. You may ONLY invoke the 14 approved read and candidate tools (get_data_readiness, check_conflicts, compare_candidates, get_schedule_summary, get_entries, get_unscheduled, get_unmet_preferences, get_faculty_load, get_room_utilization, find_alternative_slots, get_recommendations, add_directive, generate_schedule, propose_change).
4. You have NO ability and NO tool to apply a proposal, accept an official schedule, delete any record, edit master data, create user accounts, forecast enrollment, or process individual student records. Always refuse such requests clearly and explain that the Dean must confirm changes through the workspace UI.`;

export interface ChatTurnInput {
  termCode: string;
  conversationId?: string;
  scheduleId?: string;
  prompt: string;
  provider?: LlmProvider;
  simulateProviderFailure?: boolean;
  actor?: string;
}

export interface ChatTurnResponse {
  conversationId: string;
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  refused: boolean;
  refusalReason?: string;
  invokedTool: AiToolName | null;
  invokedToolArgs: Record<string, unknown> | null;
  provider: LlmProvider;
  model: string;
  /** live: a provider answered; offline: built-in assistant; offline-fallback: provider failed. */
  mode: "live" | "offline" | "offline-fallback";
  streamedChunks: string[];
  tokensIn: number;
  tokensOut: number;
  estimatedCostPhp: number;
  egressPayloadId: string;
}

/**
 * Detect adversarial, destructive, or out-of-scope prompts that must be refused without executing any write action.
 */
export function detectRefusalIntent(prompt: string): {
  refused: boolean;
  reason?: string;
  reply?: string;
} {
  const lower = prompt.toLowerCase();
  // "How do I accept a schedule?" asks for instructions, not for the
  // assistant to act; it is answered from the documentation. The assistant
  // has no tool that could accept, apply or delete anything either way.
  const informational = isDocumentationQuestion(prompt);
  const injection =
    lower.includes("ignore your rules") ||
    lower.includes("ignore previous instructions") ||
    lower.includes("bypass validation") ||
    lower.includes("system prompt override");

  // 1. Prompt injection / override rules / accept schedule / apply proposal / delete data / edit master data
  if (
    injection ||
    (!informational && (
    /\b(?:accept|approve|finalize|publish|release)\s+(?:the\s+|this\s+|candidate\s+)?schedule\b/i.test(
      prompt,
    ) ||
    /\bi-accept\s+(?:mo\s+)?(?:na\s+)?(?:ang\s+|yung\s+)?schedule\b/i.test(
      prompt,
    ) ||
    /\b(?:apply|commit|execute)\s+(?:the\s+|this\s+)?proposal\b/i.test(
      prompt,
    ) ||
    /\bi-apply\s+(?:mo\s+)?(?:na\s+)?(?:ang\s+|yung\s+)?proposal\b/i.test(
      prompt,
    ) ||
    /\b(?:delete|drop|erase|remove|wipe)\s+(?:all\s+|the\s+)?(?:faculty|rooms?|schedules?|sections?|subjects?|database|data|records?)\b/i.test(
      prompt,
    ) ||
    /\bburahin\s+(?:mo\s+)?(?:lahat|ang|yung)\b/i.test(prompt) ||
    /\b(?:edit|update|modify|change)\s+master\s+data\b/i.test(prompt) ||
    /\b(?:create|add|register)\s+(?:a\s+)?(?:new\s+)?(?:user|coordinator|student|faculty)\s+account\b/i.test(
      prompt,
    )))
  ) {
    return {
      refused: true,
      reason: "FORBIDDEN_WRITE_OR_INJECTION",
      reply:
        "I cannot apply a proposal, accept a schedule, delete records, edit master data, or create user accounts. By ORDIQ security rules, only the Dean can accept a validated candidate or apply a change proposal directly in the Schedule Workspace.",
    };
  }

  // 2. Out-of-scope capabilities (enrollment forecasting, individual student records, portal integration)
  if (
    !informational && (
    /\b(?:forecast|predict)\s+(?:next\s+year'?s?\s+|future\s+)?enrollment\b/i.test(
      prompt,
    ) ||
    /\bindividual\s+student\s+(?:record|schedule|grade|name)s?\b/i.test(
      prompt,
    ) ||
    /\b(?:student\s+number|student\s+id)\b/i.test(prompt) ||
    /\bconnect\s+(?:directly\s+)?to\s+(?:the\s+)?(?:mseuf\s+|university\s+)?portal\b/i.test(
      prompt,
    ))
  ) {
    return {
      refused: true,
      reason: "OUT_OF_SCOPE_CAPABILITY",
      reply:
        "That request is outside ORDIQ's approved scope (Quotation Q-2026-002). ORDIQ operates strictly at the section level without individual student records, does not forecast enrollment, and exports portal-ready Excel sheets rather than connecting directly to the university portal.",
    };
  }

  return { refused: false };
}

/**
 * Resolve any faculty name, surname, or alias mentioned in the prompt to its `facultyCode` (`FAC-XXX`).
 */
function extractMentionedFacultyCode(prompt: string): string | undefined {
  const state = getMasterDataState();
  const codeMatch = prompt.match(/\b(FAC-\d{3})\b/i);
  if (codeMatch?.[1]) {
    const code = codeMatch[1].toUpperCase();
    if (state.faculty.has(code)) return code;
  }

  const scrubbed = pseudonymizeText(prompt);
  const aliasMatch = scrubbed.match(/\b(ALIAS-\d{3})\b/i);
  if (aliasMatch?.[1]) {
    const alias = aliasMatch[1].toUpperCase();
    for (const fac of state.faculty.values()) {
      if (fac.alias.toUpperCase() === alias) return fac.code;
    }
  }

  const normPrompt = normalizeDiacritics(prompt).toLowerCase();
  const table = buildFacultyPseudonymTable();
  for (const entry of table) {
    if (
      normPrompt.includes(entry.normalizedFull) ||
      (entry.normalizedSurname.length >= 3 &&
        new RegExp(`\\b${entry.normalizedSurname}\\b`, "i").test(normPrompt))
    ) {
      return entry.facultyCode;
    }
  }
  return undefined;
}

function extractMentionedRoomCode(prompt: string): string | undefined {
  const match = prompt.match(/\b(EN-(?:LEC|LAB)-\d{2})\b/i);
  return match?.[1]?.toUpperCase();
}

function extractMentionedSubjectCode(prompt: string): string | undefined {
  const state = getMasterDataState();
  for (const subj of state.subjects.values()) {
    if (new RegExp(`\\b${subj.code}\\b`, "i").test(prompt)) {
      return subj.code;
    }
  }
  const generic = prompt.match(/\b([A-Z]{2,4}-\d{3}[A-Z]?)\b/);
  return generic?.[1];
}

function extractMentionedOfferingCode(prompt: string): string | undefined {
  const state = getMasterDataState();
  for (const off of state.offerings.values()) {
    if (new RegExp(`\\b${off.code}\\b`, "i").test(prompt)) {
      return off.code;
    }
  }
  const firstOff = Array.from(state.offerings.values())[0];
  return firstOff?.code;
}

function extractMentionedWeekday(prompt: string): Weekday | undefined {
  const lower = prompt.toLowerCase();
  if (/\b(?:monday|lunes)\b/.test(lower)) return "MONDAY";
  if (/\b(?:tuesday|martes)\b/.test(lower)) return "TUESDAY";
  if (/\b(?:wednesday|miyerkules|mierkules)\b/.test(lower)) return "WEDNESDAY";
  if (/\b(?:thursday|huwebes|jueves)\b/.test(lower)) return "THURSDAY";
  if (/\b(?:friday|biyernes|viernes)\b/.test(lower)) return "FRIDAY";
  if (/\b(?:saturday|sabado)\b/.test(lower)) return "SATURDAY";
  return undefined;
}

/**
 * Determine which of the 14 tools best answers a valid English, Filipino, or Taglish scheduling prompt.
 */
export function selectToolAndArgsForPrompt(
  prompt: string,
  termCode: string,
  scheduleId?: string,
): {
  toolName: AiToolName;
  args: Record<string, unknown>;
} {
  const lower = prompt.toLowerCase();
  const facultyCode = extractMentionedFacultyCode(prompt);
  const roomCode = extractMentionedRoomCode(prompt);
  const subjectCode = extractMentionedSubjectCode(prompt);
  const weekday = extractMentionedWeekday(prompt);

  // 1. Data readiness (English / Filipino / Taglish)
  if (
    /\b(?:readiness|missing\s+data|data\s+quality|iso\s*25012|ready\s+for\s+generation|kulang\s+na\s+data|handa\s+na\s+ba)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "get_data_readiness",
      args: { termCode },
    };
  }

  // 2. Propose change
  if (
    /\b(?:propose|mag-propose|move\s+offering|lipat\s+natin)\b/i.test(
      prompt,
    )
  ) {
    const offeringCode =
      extractMentionedOfferingCode(prompt) ?? "OFF-CPE-1A-CPE101";
    return {
      toolName: "propose_change",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        offeringCode,
        meetingIndex: 0,
        weekday: weekday ?? "WEDNESDAY",
        startMin: 600,
      },
    };
  }

  // 3. Add directive ("avoid", "forbid", "huwag bigyan", "bawal sa", "directive", "lock faculty")
  if (
    /\b(?:add\s+a?\s*directive|forbid\s+slot|huwag\s+bigyan|bawal\s+magturo|ayaw\s+ng\s+morning|avoid\s+monday|do\s+not\s+schedule|huwag\s+i-schedule)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "add_directive",
      args: {
        termCode,
        type: "FACULTY_TIME_WINDOW",
        hardness: lower.includes("hard") || lower.includes("strict") ? "HARD" : "SOFT",
        facultyCode: facultyCode ?? "FAC-001",
        weekday: weekday ?? "MONDAY",
        startMin: 540,
        endMin: 1020,
        weight: 9,
      },
    };
  }

  // 4. Generate schedule ("generate", "bumuo ng schedule", "gumawa ng candidate", "run solver")
  if (
    /\b(?:generate\s+(?:new\s+|candidate\s+|a\s+)?schedules?|gumawa\s+ng\s+(?:bagong\s+)?schedule|bumuo\s+ng\s+schedule|i-generate\s+ang\s+schedule|run\s+generation)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "generate_schedule",
      args: {
        termCode,
        profiles: ["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"],
      },
    };
  }

  // 5. Compare candidates ("compare", "ikumpara", "paghambingin", "difference between candidates")
  if (
    /\b(?:compare\s+candidates|candidate\s+comparison|ikumpara\s+ang|paghambingin|alin\s+ang\s+mas\s+maganda)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "compare_candidates",
      args: { termCode },
    };
  }

  // 6. ML Faculty recommendations ("recommend", "who should teach", "sino ang bagay magturo", "best-fit faculty")
  if (
    /\b(?:recommend|who\s+should\s+teach|best[- ]fit\s+faculty|sino\s+ang\s+(?:pwedeng|bagay|dapat)\s+magturo|faculty\s+suggestion)\b/i.test(
      prompt,
    )
  ) {
    const state = getMasterDataState();
    const fallbackSubj =
      subjectCode ??
      Array.from(state.subjects.values())[0]?.code ??
      "CPE-101";
    return {
      toolName: "get_recommendations",
      args: {
        termCode,
        subjectCode: fallbackSubj,
        topK: 5,
      },
    };
  }

  // 7. Find alternative slots ("alternative", "other slots", "saan pwedeng ilipat", "feasible slots")
  if (
    /\b(?:alternative\s+slots?|find\s+alternatives?|feasible\s+options?|saan\s+pwedeng\s+ilipat|ibang\s+oras)\b/i.test(
      prompt,
    )
  ) {
    const offeringCode =
      extractMentionedOfferingCode(prompt) ?? "OFF-CPE-1A-CPE101";
    return {
      toolName: "find_alternative_slots",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        offeringCode,
        meetingIndex: 0,
      },
    };
  }

  // 8. Unscheduled meetings ("unscheduled", "unplaced", "hindi na-schedule", "naiwang klase")
  if (
    /\b(?:unscheduled|unplaced|could\s+not\s+be\s+placed|hindi\s+na-?schedule|naiwang\s+klase)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "get_unscheduled",
      args: { termCode, ...(scheduleId ? { scheduleId } : {}) },
    };
  }

  // 9. Unmet preferences ("unmet preferences", "preferences not satisfied", "hindi nasunod na preference")
  if (
    /\b(?:unmet\s+preferences?|unsatisfied\s+preferences?|hindi\s+nasunod\s+na\s+preference)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "get_unmet_preferences",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        ...(facultyCode ? { facultyCode } : {}),
      },
    };
  }

  // 10. Faculty teaching load ("faculty load", "workload", "teaching units", "overload", "ilang units")
  if (
    /\b(?:faculty\s+load|teaching\s+load|workload|overload|ilang\s+units|load\s+ni|load\s+balance)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "get_faculty_load",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        ...(facultyCode ? { facultyCode } : {}),
      },
    };
  }

  // 11. Room utilization ("room utilization", "room usage", "paggamit ng room", "laboratory utilization")
  if (
    /\b(?:room\s+utilization|room\s+usage|lab\s+utilization|paggamit\s+ng\s+room|bakanteng\s+room)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "get_room_utilization",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        ...(roomCode ? { roomCode } : {}),
      },
    };
  }

  // 12. Check conflicts ("conflict", "violation", "double-booking", "may banggaan", "check room conflicts")
  if (
    /\b(?:conflicts?|violations?|double[- ]?book|banggaan|overlap|check\s+schedule)\b/i.test(
      prompt,
    )
  ) {
    return {
      toolName: "check_conflicts",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        ...(facultyCode ? { facultyCode } : {}),
        ...(roomCode ? { roomCode } : {}),
      },
    };
  }

  // 13. Filtered entries ("classes of", "schedule ni", "entries on", "anong klase ni")
  if (
    /\b(?:entries|classes\s+of|schedule\s+ni|anong\s+klase\s+ni|show\s+classes|list\s+classes)\b/i.test(
      prompt,
    ) ||
    facultyCode ||
    weekday
  ) {
    return {
      toolName: "get_entries",
      args: {
        termCode,
        ...(scheduleId ? { scheduleId } : {}),
        ...(facultyCode ? { facultyCode } : {}),
        ...(roomCode ? { roomCode } : {}),
        ...(weekday ? { weekday } : {}),
      },
    };
  }

  // 14. Default to schedule summary
  return {
    toolName: "get_schedule_summary",
    args: {
      termCode,
      ...(scheduleId ? { scheduleId } : {}),
    },
  };
}

/**
 * Format a clear, helpful assistant reply (in ALIAS-XXX form before streaming de-pseudonymization)
 * summarizing the validated tool output.
 */
function synthesizeReplyFromToolResult(
  toolResult: AiToolExecutionResult,
  facultyCode?: string,
): string {
  const state = getMasterDataState();
  const facAlias = facultyCode
    ? state.faculty.get(facultyCode)?.alias ?? facultyCode
    : null;

  switch (toolResult.toolName) {
    case "get_data_readiness": {
      const r = toolResult.rawResult as {
        canGenerate: boolean;
        criticalCount: number;
        warningCount: number;
        iso25012Scores: { overall: number };
      };
      return `Data readiness check complete: ISO/IEC 25012 overall quality is ${r.iso25012Scores.overall}% (${r.criticalCount} critical gaps, ${r.warningCount} warnings). ${r.canGenerate ? "The term is ready for schedule generation." : "Generation is blocked until critical gaps are resolved."}`;
    }
    case "check_conflicts": {
      const c = toolResult.rawResult as {
        candidateLabel?: string;
        hardViolationCount: number;
      };
      return `Conflict check for ${c.candidateLabel ?? "the current schedule"}${facAlias ? ` (${facAlias})` : ""}: ${c.hardViolationCount} unwaived hard violation(s) detected by the independent validator.`;
    }
    case "compare_candidates": {
      const comp = toolResult.rawResult as {
        candidateA?: { candidateLabel: string; qualityScore: number };
        candidateB?: { candidateLabel: string; qualityScore: number };
      };
      if (!comp.candidateA || !comp.candidateB) {
        return "Need at least two candidate schedules in this term to run a side-by-side comparison.";
      }
      return `Compared ${comp.candidateA.candidateLabel} (Quality ${comp.candidateA.qualityScore}) against ${comp.candidateB.candidateLabel} (Quality ${comp.candidateB.qualityScore}). Both candidates remain non-official until accepted by the Dean.`;
    }
    case "get_schedule_summary": {
      const s = toolResult.rawResult as {
        candidateLabel: string;
        qualityScore: number;
        hardViolationCount: number;
        totalScheduledMeetings: number;
        totalMeetings: number;
        roomUtilization: number;
      };
      return `Summary for ${s.candidateLabel}: ${s.totalScheduledMeetings}/${s.totalMeetings} meetings placed, ${s.hardViolationCount} hard conflicts, quality score ${s.qualityScore}, and ${s.roomUtilization}% room utilization.`;
    }
    case "get_entries": {
      const e = toolResult.rawResult as { entries: Array<{ offeringCode: string; weekday: string; roomCode: string; facultyCode: string }> };
      const firstFew = e.entries
        .slice(0, 3)
        .map((item) => {
          const alias = state.faculty.get(item.facultyCode)?.alias ?? item.facultyCode;
          return `${item.offeringCode} (${item.weekday}, ${item.roomCode}, ${alias})`;
        })
        .join("; ");
      return `Found ${e.entries.length} matching class meeting(s)${facAlias ? ` for ${facAlias}` : ""}${firstFew ? `: ${firstFew}` : "."}`;
    }
    case "get_unscheduled": {
      const u = toolResult.rawResult as { unscheduledCount: number };
      return `There are currently ${u.unscheduledCount} unscheduled meeting(s) requiring placement or constraint adjustment.`;
    }
    case "get_unmet_preferences": {
      const up = toolResult.rawResult as { unmetPreferences: unknown[] };
      return `Detected ${up.unmetPreferences.length} unmet faculty preference(s)${facAlias ? ` for ${facAlias}` : ""}.`;
    }
    case "get_faculty_load": {
      const fl = toolResult.rawResult as {
        facultyLoads: Array<{
          facultyAlias: string;
          assignedUnits: number;
          regularMaxUnits: number;
          statusLabel: string;
        }>;
      };
      const preview = fl.facultyLoads
        .slice(0, 3)
        .map(
          (f) =>
            `${f.facultyAlias}: ${f.assignedUnits}/${f.regularMaxUnits} units (${f.statusLabel})`,
        )
        .join("; ");
      return `Faculty teaching load summary (${fl.facultyLoads.length} faculty): ${preview || "No active faculty assignments yet."}`;
    }
    case "get_room_utilization": {
      const ru = toolResult.rawResult as {
        roomUtilizations: Array<{ roomCode: string; utilizationPct: number }>;
      };
      const preview = ru.roomUtilizations
        .slice(0, 4)
        .map((r) => `${r.roomCode} (${r.utilizationPct}%)`)
        .join(", ");
      return `Room utilization across ${ru.roomUtilizations.length} college room(s): ${preview}.`;
    }
    case "find_alternative_slots": {
      const alt = toolResult.rawResult as {
        offeringCode: string;
        alternatives: Array<{ weekday: string; startMin: number; roomCode: string }>;
      };
      return `Found ${alt.alternatives.length} conflict-free alternative slot(s) for ${alt.offeringCode}.`;
    }
    case "get_recommendations": {
      const rec = toolResult.rawResult as {
        subjectCode: string;
        coldStart: boolean;
        recommendations: Array<{ facultyAlias: string; score: number }>;
      };
      const topList = rec.recommendations
        .slice(0, 3)
        .map((r) => `${r.facultyAlias} (fit ${(r.score * 100).toFixed(0)}%)`)
        .join(", ");
      return `Top faculty recommendations for ${rec.subjectCode}${rec.coldStart ? " (cold-start NLP similarity)" : ""}: ${topList}.`;
    }
    case "add_directive": {
      const d = toolResult.rawResult as {
        type: string;
        facultyCode: string | null;
        weekday: string | null;
      };
      const alias = d.facultyCode
        ? state.faculty.get(d.facultyCode)?.alias ?? d.facultyCode
        : "college rule";
      return `Added candidate scheduling directive (${d.type}) for ${alias}${d.weekday ? ` on ${d.weekday}` : ""}. Re-generate candidates to apply it.`;
    }
    case "generate_schedule": {
      const g = toolResult.rawResult as {
        candidateScheduleIds: string[];
        status: string;
      };
      return `Started schedule generation and produced ${g.candidateScheduleIds.length} validated candidate schedule(s) (${g.status}). Please review them in the Schedule Workspace.`;
    }
    case "propose_change": {
      const p = toolResult.rawResult as {
        proposalId: string;
        summary: string;
        valid: boolean;
        qualityDelta: number;
      };
      return `Created change proposal (${p.proposalId.slice(0, 8)}): ${p.summary}. Validator check: ${p.valid ? "0 hard conflicts" : "has conflicts"} (quality delta ${p.qualityDelta >= 0 ? "+" : ""}${p.qualityDelta}). Use the Apply or Reject button on the proposal card to confirm.`;
    }
  }
}

/**
 * Run a full conversational turn with the ORDIQ AI Assistant:
 * 1. Persist conversation & user message
 * 2. Check refusal rules (adversarial injection, write attempts, out-of-scope requests)
 * 3. Execute the selected read/candidate tool via existing services
 * 4. Route all outgoing prompts + serialized tool results through `invokeLlmThroughPrivacyGateway`
 * 5. Stream de-pseudonymized reply back to the Dean with real faculty names restored
 */
export async function runAiAssistantTurn(
  input: ChatTurnInput,
): Promise<ChatTurnResponse> {
  const state = getMasterDataState();
  const actor = input.actor ?? "dean@mseuf.edu.ph";

  let conv: ConversationRecord | undefined = input.conversationId
    ? state.conversations.get(input.conversationId)
    : undefined;
  if (!conv) {
    conv = {
      id: input.conversationId ?? crypto.randomUUID(),
      termCode: input.termCode,
      title: input.prompt.slice(0, 60),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.conversations.set(conv.id, conv);
  }

  const userMsg: MessageRecord = {
    id: crypto.randomUUID(),
    conversationId: conv.id,
    role: "user",
    content: input.prompt,
    parts: [],
    createdAt: new Date().toISOString(),
  };
  conv.messages.push(userMsg);

  // Handle simulated or actual provider failure gracefully (Phase 4B)
  if (input.simulateProviderFailure) {
    const fallbackText =
      "The AI provider is temporarily unavailable. All manual Schedule Workspace, Validator, Solver, and Export features remain fully operational.";
    const assistantMsg: MessageRecord = {
      id: crypto.randomUUID(),
      conversationId: conv.id,
      role: "assistant",
      content: fallbackText,
      parts: [],
      createdAt: new Date().toISOString(),
    };
    conv.messages.push(assistantMsg);
    conv.updatedAt = new Date().toISOString();
    return {
      conversationId: conv.id,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      refused: false,
      invokedTool: null,
      invokedToolArgs: null,
      provider: input.provider ?? resolveLlmConfig().provider,
      model: "offline-fallback",
      mode: "offline-fallback",
      streamedChunks: [fallbackText],
      tokensIn: 0,
      tokensOut: 0,
      estimatedCostPhp: 0,
      egressPayloadId: "none",
    };
  }

  // Refusal boundaries are deterministic and checked before any model call.
  const config = resolveLlmConfig(input.provider);
  const refusal = detectRefusalIntent(input.prompt);
  if (refusal.refused) {
    const replyText = refusal.reply ?? "I cannot perform that request.";
    // Offline, the refusal still goes through the gateway so the egress audit
    // covers it; live, no provider call is needed to refuse.
    const gwRes = config.live
      ? null
      : await invokeLlmThroughPrivacyGateway({
          provider: input.provider,
          systemPrompt: SYSTEM_PROMPT_V1,
          messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
          synthesizedAssistantReply: replyText,
        });

    const assistantMsg = appendAssistantMessage(conv, gwRes?.restoredReply ?? replyText, []);
    return {
      conversationId: conv.id,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      refused: true,
      refusalReason: refusal.reason,
      invokedTool: null,
      invokedToolArgs: null,
      provider: gwRes?.provider ?? config.provider,
      model: gwRes?.model ?? config.model,
      mode: config.live ? "live" : "offline",
      streamedChunks: gwRes?.streamedChunks ?? [replyText],
      tokensIn: gwRes?.tokensIn ?? 0,
      tokensOut: gwRes?.tokensOut ?? 0,
      estimatedCostPhp: gwRes?.estimatedCostPhp ?? 0,
      egressPayloadId: gwRes?.egressPayloadId ?? "none",
    };
  }

  if (config.live) {
    try {
      const live = await runLiveAssistantTurn({
        config,
        systemPrompt: SYSTEM_PROMPT_V1,
        history: conv.messages,
        termCode: input.termCode,
        scheduleId: input.scheduleId,
        actor,
      });
      const assistantMsg = appendAssistantMessage(conv, live.text, [
        ...live.toolResults.map((r) => r.structuredPart),
        // Name the documents behind a how-to answer (not for data answers).
        ...(live.toolResults.length === 0 && isDocumentationQuestion(input.prompt)
          ? live.knowledgeHits.slice(0, 2).map(knowledgeSourcePart)
          : []),
      ]);
      const firstCall = live.toolCalls[0];
      return {
        conversationId: conv.id,
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        refused: false,
        invokedTool: firstCall?.toolName ?? null,
        invokedToolArgs: firstCall?.args ?? null,
        provider: config.provider,
        model: config.model,
        mode: "live",
        streamedChunks: live.streamedChunks,
        tokensIn: live.tokensIn,
        tokensOut: live.tokensOut,
        estimatedCostPhp: live.estimatedCostPhp,
        egressPayloadId: live.egressPayloadId,
      };
    } catch (error) {
      // Never surface provider errors (they may echo request text); answer
      // with the built-in assistant instead.
      logger.warn("ai_provider_failed", {
        provider: config.provider,
        model: config.model,
        error: error instanceof Error ? error.name : "unknown",
      });
      return runOfflineTurn(input, conv, userMsg, actor, PROVIDER_FALLBACK_NOTE);
    }
  }

  return runOfflineTurn(input, conv, userMsg, actor);
}

const PROVIDER_FALLBACK_NOTE =
  "\n\n(The AI provider could not be reached, so this answer comes from ORDIQ's built-in assistant.)";

function appendAssistantMessage(
  conv: ConversationRecord,
  content: string,
  parts: MessageRecord["parts"],
): MessageRecord {
  const assistantMsg: MessageRecord = {
    id: crypto.randomUUID(),
    conversationId: conv.id,
    role: "assistant",
    content,
    parts,
    createdAt: new Date().toISOString(),
  };
  conv.messages.push(assistantMsg);
  conv.updatedAt = new Date().toISOString();
  return assistantMsg;
}

/**
 * Deterministic turn: pattern-matched tool selection and a templated reply,
 * still routed through the privacy gateway. Used without a configured
 * provider, under tests, and as the fallback when a provider call fails.
 */
async function runOfflineTurn(
  input: ChatTurnInput,
  conv: ConversationRecord,
  userMsg: MessageRecord,
  actor: string,
  note?: string,
): Promise<ChatTurnResponse> {
  if (isDocumentationQuestion(input.prompt)) {
    const [best] = searchKnowledge(input.prompt, { limit: 1, minScore: 4 });
    if (best) return runOfflineKnowledgeTurn(input, conv, userMsg, best, note);
  }
  const { toolName, args } = selectToolAndArgsForPrompt(
    input.prompt,
    input.termCode,
    input.scheduleId,
  );
  const toolResult = await executeAiTool(toolName, args, actor);
  const facultyCode = args.facultyCode as string | undefined;
  const synthesizedReply = synthesizeReplyFromToolResult(toolResult, facultyCode);

  // Pass history + allowlist-serialized tool output through the Privacy Gateway
  const gwMessages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolName?: string;
  }> = [
    ...conv.messages.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "tool",
      toolName,
      content: JSON.stringify(toolResult.sanitizedResultForLlm),
    },
  ];

  const gwRes = await invokeLlmThroughPrivacyGateway({
    provider: input.provider,
    model: note ? "offline-fallback" : undefined,
    systemPrompt: SYSTEM_PROMPT_V1,
    messages: gwMessages,
    synthesizedAssistantReply: synthesizedReply,
  });

  const content = note ? `${gwRes.restoredReply}${note}` : gwRes.restoredReply;
  const assistantMsg = appendAssistantMessage(conv, content, [toolResult.structuredPart]);

  return {
    conversationId: conv.id,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    refused: false,
    invokedTool: toolName,
    invokedToolArgs: args,
    provider: gwRes.provider,
    model: gwRes.model,
    mode: note ? "offline-fallback" : "offline",
    streamedChunks: note ? [...gwRes.streamedChunks, note] : gwRes.streamedChunks,
    tokensIn: gwRes.tokensIn,
    tokensOut: gwRes.tokensOut,
    estimatedCostPhp: gwRes.estimatedCostPhp,
    egressPayloadId: gwRes.egressPayloadId,
  };
}

/** Message part that names the document a reply is based on. */
export function knowledgeSourcePart(hit: Pick<KnowledgeHit, "source" | "section">) {
  const last = hit.section.split(" › ").pop() ?? hit.section;
  return { kind: "doc_source", title: `Source: ${last}`, data: { source: hit.source, section: hit.section } };
}

/** Built-in answer to a how-to question: the best documentation passage. */
async function runOfflineKnowledgeTurn(
  input: ChatTurnInput,
  conv: ConversationRecord,
  userMsg: MessageRecord,
  hit: KnowledgeHit,
  note?: string,
): Promise<ChatTurnResponse> {
  const reply = `From the ${hit.source} (${hit.section}):\n\n${focusExcerpt(hit.text, input.prompt)}`;
  const gwRes = await invokeLlmThroughPrivacyGateway({
    provider: input.provider,
    model: note ? "offline-fallback" : undefined,
    systemPrompt: SYSTEM_PROMPT_V1,
    messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
    synthesizedAssistantReply: reply,
  });
  const content = note ? `${gwRes.restoredReply}${note}` : gwRes.restoredReply;
  const assistantMsg = appendAssistantMessage(conv, content, [knowledgeSourcePart(hit)]);
  return {
    conversationId: conv.id,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    refused: false,
    invokedTool: null,
    invokedToolArgs: null,
    provider: gwRes.provider,
    model: gwRes.model,
    mode: note ? "offline-fallback" : "offline",
    streamedChunks: note ? [...gwRes.streamedChunks, note] : gwRes.streamedChunks,
    tokensIn: gwRes.tokensIn,
    tokensOut: gwRes.tokensOut,
    estimatedCostPhp: gwRes.estimatedCostPhp,
    egressPayloadId: gwRes.egressPayloadId,
  };
}

/**
 * Dean-only UI action to Apply or Reject a `ChangeProposalRecord`.
 * Never exposed as an AI tool. Re-validates at apply time inside `editScheduleEntry`.
 */
export async function reviewChangeProposal(input: {
  proposalId: string;
  decision: "APPLY" | "REJECT";
  actor: string;
}): Promise<ChangeProposalRecord> {
  return withAudit(
    {
      actor: input.actor,
      action:
        input.decision === "APPLY"
          ? "AI_PROPOSAL_APPLIED"
          : "AI_PROPOSAL_REJECTED",
      entity: "ChangeProposal",
      entityId: input.proposalId,
    },
    async () => {
      const state = getMasterDataState();
      const proposal = state.proposals.get(input.proposalId);
      if (!proposal) {
        throw new AppError(
          "PROPOSAL_NOT_FOUND",
          `Proposal '${input.proposalId}' not found.`,
          404,
        );
      }
      if (proposal.status !== "PENDING") {
        throw new AppError(
          "PROPOSAL_ALREADY_RESOLVED",
          `Proposal '${input.proposalId}' is already ${proposal.status}.`,
          409,
        );
      }

      if (input.decision === "REJECT") {
        const rejected: ChangeProposalRecord = {
          ...proposal,
          status: "REJECTED",
          resolvedAt: new Date().toISOString(),
        };
        state.proposals.set(proposal.id, rejected);
        return rejected;
      }

      const sched = state.schedules.get(proposal.scheduleId);
      if (!sched) {
        throw new AppError(
          "SCHEDULE_NOT_FOUND",
          `Target schedule '${proposal.scheduleId}' not found.`,
          404,
        );
      }

      await editScheduleEntry({
        scheduleId: sched.id,
        entryId: proposal.beforeEntry.id,
        expectedVersion: sched.version,
        weekday: proposal.afterEntry.weekday,
        startMin: proposal.afterEntry.startMin,
        endMin: proposal.afterEntry.endMin,
        roomCode: proposal.afterEntry.roomCode,
        facultyCode: proposal.afterEntry.facultyCode,
        actor: input.actor,
      });

      const applied: ChangeProposalRecord = {
        ...proposal,
        status: "APPLIED",
        resolvedAt: new Date().toISOString(),
      };
      state.proposals.set(proposal.id, applied);
      return applied;
    },
  );
}
