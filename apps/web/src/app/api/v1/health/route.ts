import { NextResponse } from "next/server";
import { getSystemHealth } from "@/server/modules/health/health.service";
import { withErrorHandler } from "@/server/platform/errors";

export const GET = withErrorHandler(async () => {
  const health = await getSystemHealth();
  return NextResponse.json(health, { status: 200 });
});

