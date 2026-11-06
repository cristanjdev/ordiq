import { NextRequest, NextResponse } from "next/server";
import {
  getSoftWeightOverrides,
  saveSoftWeights,
} from "@/server/modules/directives/directives.service";
import { CANDIDATE_PROFILES } from "@/server/modules/generation/generation.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { AppError } from "@/server/platform/errors";

/** Defaults are the Balanced profile; overrides apply to every candidate profile. */
const DEFAULTS: Record<string, number> = { ...CANDIDATE_PROFILES.BALANCED.weights };

export const GET = withDeanRoute(async (request: NextRequest) => {
  const termCode = new URL(request.url).searchParams.get("termCode");
  if (!termCode) throw new AppError("MISSING_TERM", "The termCode query parameter is required.", 400);
  return NextResponse.json(
    { defaults: DEFAULTS, overrides: getSoftWeightOverrides(termCode) },
    { status: 200 },
  );
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const overrides = await saveSoftWeights(await request.json(), DEFAULTS, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ defaults: DEFAULTS, overrides }, { status: 200 });
});
