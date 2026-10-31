import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkExistingSchedule,
  runScheduleGeneration,
} from "../../../../server/modules/generation/generation.service";
import { getMasterDataState } from "../../../../server/modules/master-data/master-data.store";
import { withAuth } from "../../../../server/platform/auth";
import { toErrorResponse } from "../../../../server/platform/errors";

const generationActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("generate"),
    termCode: z.string().default("AY2026-2027-S1"),
    profiles: z
      .array(z.enum(["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"]))
      .optional(),
    priorScheduleId: z.string().optional(),
    timeLimitSeconds: z.number().int().min(1).max(300).optional(),
  }),
  z.object({
    action: z.literal("check_schedule"),
    scheduleId: z.string().min(1),
  }),
]);

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? "AY2026-2027-S1";
  const store = getMasterDataState();

  const runs = Array.from(store.generationRuns.values()).filter(
    (r) => r.termCode === termCode,
  );
  const schedules = Array.from(store.schedules.values()).filter(
    (s) => s.termCode === termCode,
  );
  return NextResponse.json({ runs, schedules }, { status: 200 });
});

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const parsed = generationActionSchema.parse(body);

    if (parsed.action === "check_schedule") {
      const result = await checkExistingSchedule(parsed.scheduleId, {
        actor: user.username,
      });
      return NextResponse.json(result, { status: 200 });
    }

    const result = await runScheduleGeneration(parsed.termCode, {
      profiles: parsed.profiles,
      priorScheduleId: parsed.priorScheduleId,
      timeLimitSeconds: parsed.timeLimitSeconds,
      actor: user.username,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
});

