import { NextResponse } from "next/server";
import { withDeanRoute } from "@/server/http/dean-route";
import { evaluateSchedule } from "@/server/modules/schedules/schedule-evaluation.service";
import { AppError, toErrorResponse } from "@/server/platform/errors";

/** GET /api/v1/schedules/evaluation?scheduleId=… : unsatisfied rules and scheduling risks. */
export const GET = withDeanRoute(async (request) => {
  try {
    const scheduleId = new URL(request.url).searchParams.get("scheduleId") ?? "";
    if (!scheduleId) {
      throw new AppError("SCHEDULE_ID_REQUIRED", "Choose a schedule to evaluate.", 400);
    }
    return NextResponse.json({ evaluation: evaluateSchedule(scheduleId) }, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
});
