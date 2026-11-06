import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reviewChangeProposal,
  runAiAssistantTurn,
} from "../../../../server/modules/ai/ai-orchestrator";
import { getMasterDataState } from "../../../../server/modules/master-data/master-data.store";
import { withDeanRoute } from "@/server/http/dean-route";
import { AppError, toErrorResponse } from "../../../../server/platform/errors";
import { getSystemSettings } from "../../../../server/platform/system-settings";
import { describeEntry, describeOffering } from "../../../../server/modules/ai/briefing.service";
import { resolveLlmConfig } from "../../../../server/modules/ai/llm-provider";
import { checkMonthlyTokenBudget } from "../../../../server/modules/ai/privacy-gateway";
import { recordAudit } from "../../../../server/platform/audit";

const aiActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chat"),
    termCode: z.string().min(1),
    conversationId: z.string().optional(),
    scheduleId: z.string().optional(),
    prompt: z.string().min(1),
    provider: z.enum(["openai", "anthropic", "gemini", "ollama"]).optional(),
  }),
  z.object({
    action: z.literal("review_proposal"),
    proposalId: z.string().min(1),
    decision: z.enum(["APPLY", "REJECT"]),
  }),
  z.object({
    action: z.literal("delete_conversation"),
    conversationId: z.string().min(1),
  }),
]);

export const GET = withDeanRoute(async (req) => {
  try {
    const url = new URL(req.url);
    const termCode = url.searchParams.get("termCode") ?? "AY2026-2027-S1";
    const state = getMasterDataState();

    const conversations = Array.from(state.conversations.values())
      .filter((c) => c.termCode === termCode)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Readable before/after for the review screen.
    const proposals = Array.from(state.proposals.values())
      .filter((p) => p.termCode === termCode)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        ...p,
        offeringLabel: describeOffering(p.offeringCode),
        beforeText: describeEntry(p.beforeEntry),
        afterText: describeEntry(p.afterEntry),
        scheduleLabel: state.schedules.get(p.scheduleId)?.candidateLabel ?? p.scheduleId,
      }));
    await getSystemSettings(); // load the token budget from Settings
    const budget = checkMonthlyTokenBudget();
    const llm = resolveLlmConfig();
    const totalTokensUsed = state.llmUsage.reduce(
      (sum, u) => sum + u.tokensIn + u.tokensOut,
      0,
    );
    const totalEstimatedCostPhp = Number(
      state.llmUsage
        .reduce((sum, u) => sum + u.estimatedCostPhp, 0)
        .toFixed(4),
    );

    return NextResponse.json({
      termCode,
      conversations,
      proposals,
      usage: {
        requestCount: state.llmUsage.length,
        totalTokensUsed,
        totalEstimatedCostPhp,
        monthTokensUsed: budget.usedTokens,
        monthTokenBudget: budget.budgetTokens,
      },
      provider: {
        provider: llm.provider,
        model: llm.model,
        live: llm.live,
        offlineReason: llm.offlineReason ?? null,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const POST = withDeanRoute(async (req, ctx) => {
  try {
    const body = aiActionSchema.parse(await req.json());
    if (body.action === "chat") {
      if (!(await getSystemSettings()).ai.assistantEnabled) {
        throw new AppError(
          "AI_ASSISTANT_DISABLED",
          "The AI Assistant is turned off in Settings.",
          403,
        );
      }
      const turn = await runAiAssistantTurn({
        termCode: body.termCode,
        conversationId: body.conversationId,
        scheduleId: body.scheduleId,
        prompt: body.prompt,
        provider: body.provider,
        actor: ctx.user.username,
      });
      return NextResponse.json(turn);
    }

    if (body.action === "delete_conversation") {
      const state = getMasterDataState();
      const conv = state.conversations.get(body.conversationId);
      if (!conv) {
        throw new AppError("NOT_FOUND", "The conversation no longer exists.", 404);
      }
      state.conversations.delete(body.conversationId);
      await recordAudit({
        actor: ctx.user.username,
        action: "AI_CONVERSATION_DELETED",
        entity: "Conversation",
        entityId: conv.id,
        before: { title: conv.title, termCode: conv.termCode, messageCount: conv.messages.length },
      });
      return NextResponse.json({ deleted: conv.id });
    }

    const updatedProposal = await reviewChangeProposal({
      proposalId: body.proposalId,
      decision: body.decision,
      actor: ctx.user.username,
    });
    return NextResponse.json({ proposal: updatedProposal });
  } catch (err) {
    return toErrorResponse(err);
  }
});
