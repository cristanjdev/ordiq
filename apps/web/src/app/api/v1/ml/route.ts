import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getMlEvaluationReport,
  getSubjectFacultyRecommendations,
  rollbackModelVersion,
  trainAndEvaluateFitModel,
} from "../../../../server/modules/ml/ml.service";
import { withAuth } from "../../../../server/platform/auth";
import { toErrorResponse } from "../../../../server/platform/errors";

const mlActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("train"),
    termCode: z.string().optional(),
  }),
  z.object({
    action: z.literal("rollback"),
    targetVersionId: z.string().min(1),
  }),
]);

export const GET = withAuth(async (req) => {
  try {
    const url = new URL(req.url);
    const subjectCode = url.searchParams.get("subjectCode");
    const topK = Number(url.searchParams.get("topK") ?? "5");

    const evaluation = getMlEvaluationReport();
    if (subjectCode) {
      const recommendations = await getSubjectFacultyRecommendations(
        subjectCode,
        topK,
      );
      return NextResponse.json({
        evaluation,
        recommendations,
      });
    }

    return NextResponse.json({ evaluation });
  } catch (err) {
    return toErrorResponse(err);
  }
});

export const POST = withAuth(async (req, ctx) => {
  try {
    const body = mlActionSchema.parse(await req.json());
    if (body.action === "train") {
      const res = await trainAndEvaluateFitModel(
        ctx.user.username,
        body.termCode,
      );
      return NextResponse.json(res);
    }
    const rolledBack = await rollbackModelVersion(
      body.targetVersionId,
      ctx.user.username,
    );
    return NextResponse.json({ activeVersion: rolledBack });
  } catch (err) {
    return toErrorResponse(err);
  }
});
