import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeEvaluationSession,
  getEvaluationEvidenceExport,
  startEvaluationSession,
} from "../../../../server/modules/evaluation/evaluation.service";
import { withAuth } from "../../../../server/platform/auth";
import { toErrorResponse } from "../../../../server/platform/errors";

const evaluationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    termCode: z.string().default("AY2026-2027-S1"),
    stage: z.enum([
      "STAGE_1_BASELINE",
      "STAGE_2_CONFLICT_CHECK",
      "STAGE_3_GENERATION",
    ]),
    scenario: z.string().min(1),
    participantRole: z.string().optional(),
    scheduleId: z.string().nullable().optional(),
    notes: z.string().optional(),
  }),
  z.object({
    action: z.literal("complete"),
    sessionId: z.string().min(1),
    scheduleId: z.string().nullable().optional(),
    iso25010Ratings: z
      .object({
        functionalSuitability: z.number().min(1).max(5),
        performanceEfficiency: z.number().min(1).max(5),
        usability: z.number().min(1).max(5),
        reliability: z.number().min(1).max(5),
        security: z.number().min(1).max(5),
        maintainability: z.number().min(1).max(5),
      })
      .optional(),
    notes: z.string().optional(),
  }),
]);

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const termCode = url.searchParams.get("termCode") ?? "AY2026-2027-S1";
    const evidence = getEvaluationEvidenceExport(termCode);
    return NextResponse.json(evidence);
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const POST = withAuth(async (req, ctx) => {
  try {
    const body = evaluationActionSchema.parse(await req.json());
    if (body.action === "start") {
      const session = await startEvaluationSession({
        ...body,
        actor: ctx.user.username,
      });
      return NextResponse.json({ session }, { status: 201 });
    }
    const completed = await completeEvaluationSession({
      ...body,
      actor: ctx.user.username,
    });
    return NextResponse.json({ session: completed });
  } catch (err) {
    return toErrorResponse(err);
  }
});
