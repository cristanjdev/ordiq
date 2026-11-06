import { NextResponse } from "next/server";
import { z } from "zod";
import { withDeanRoute } from "@/server/http/dean-route";
import {
  buildTermBriefing,
  generateBriefingSummary,
  getCachedBriefingSummary,
} from "@/server/modules/ai/briefing.service";
import { AppError, toErrorResponse } from "@/server/platform/errors";
import { getSystemSettings } from "@/server/platform/system-settings";

/** Term briefing: items needing attention, plus the last AI summary if still current. */
export const GET = withDeanRoute(async (req) => {
  try {
    const termCode = new URL(req.url).searchParams.get("termCode") ?? "AY2026-2027-S1";
    const briefing = buildTermBriefing(termCode);
    return NextResponse.json({ briefing, summary: getCachedBriefingSummary(briefing) });
  } catch (err) {
    return toErrorResponse(err);
  }
});

const summarySchema = z.object({ termCode: z.string().min(1) });

/** Write the AI summary for the current briefing (cached until the facts change). */
export const POST = withDeanRoute(async (req) => {
  try {
    const { termCode } = summarySchema.parse(await req.json());
    const settings = await getSystemSettings();
    if (!settings.ai.assistantEnabled) {
      throw new AppError("AI_ASSISTANT_DISABLED", "The AI Assistant is turned off in Settings.", 403);
    }
    const briefing = buildTermBriefing(termCode);
    const summary = await generateBriefingSummary(briefing);
    return NextResponse.json({ briefing, summary });
  } catch (err) {
    return toErrorResponse(err);
  }
});
