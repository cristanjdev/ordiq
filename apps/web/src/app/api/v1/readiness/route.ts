import { NextRequest, NextResponse } from "next/server";
import { getTermReadinessReport } from "@/server/modules/readiness/readiness.service";
import { withDeanRoute } from "@/server/http/dean-route";

export const GET = withDeanRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? "AY2026-2027-S1";
  const report = getTermReadinessReport(termCode);
  return NextResponse.json(report, { status: 200 });
});

