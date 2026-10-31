import { NextResponse } from "next/server";
import { z } from "zod";
import {
  reviewChangeProposal,
  runAiAssistantTurn,
} from "../../../../server/modules/ai/ai-orchestrator";
import { getMasterDataState } from "../../../../server/modules/master-data/master-data.store";
import { withAuth } from "../../../../server/platform/auth";
import { toErrorResponse } from "../../../../server/platform/errors";

const aiActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chat"),
    termCode: z.string().min(1),
    conversationId: z.string().optional(),
    scheduleId: z.string().optional(),
    prompt: z.string().min(1),
    provider: z.enum(["openai", "anthropic", "ollama"]).optional(),
  }),
  z.object({
    action: z.literal("review_proposal"),
    proposalId: z.string().min(1),
    decision: z.enum(["APPLY", "REJECT"]),
  }),
]);

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const termCode = url.searchParams.get("termCode") ?? "AY2026-2027-S1";
    const state = getMasterDataState();

    const conversations = Array.from(state.conversations.values())
      .filter((c) => c.termCode === termCode)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const proposals = Array.from(state.proposals.values()).filter(
      (p) => p.termCode === termCode,
    );
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
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const POST = withAuth(async (req, ctx) => {
  try {
    const body = aiActionSchema.parse(await req.json());
    if (body.action === "chat") {
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
