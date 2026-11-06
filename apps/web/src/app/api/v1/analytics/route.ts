import { NextResponse } from "next/server";
import { computeScheduleAnalytics } from "../../../../server/modules/analytics/analytics.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { toErrorResponse } from "../../../../server/platform/errors";

export const GET = withDeanRoute(async (req) => {
  try {
    const url = new URL(req.url);
    const termCode = url.searchParams.get("termCode") ?? "AY2026-2027-S1";
    const scheduleId = url.searchParams.get("scheduleId");
    const report = computeScheduleAnalytics(termCode, scheduleId);
    return NextResponse.json(report);
  } catch (err) {
    return toErrorResponse(err);
  }
});

