import { NextRequest, NextResponse } from "next/server";
import { getTermReadinessReport } from "@/server/modules/readiness/readiness.service";
import { withAuth } from "@/server/platform/auth";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? "AY2026-2027-S1";
  const report = getTermReadinessReport(termCode);
  return NextResponse.json(report, { status: 200 });
});

