import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  generateMediumCollegeFixture,
  generateSmallFixture,
  loadFixtureIntoStore,
} from "@/server/modules/fixtures/fixture.generator";
import { getTermReadinessReport } from "@/server/modules/readiness/readiness.service";
import { withAuth } from "@/server/platform/auth";

const fixtureRequestSchema = z.object({
  size: z.enum(["small", "medium"]).default("medium"),
});

export const POST = withAuth(async (request: NextRequest, auth) => {
  const { size } = fixtureRequestSchema.parse(await request.json());
  const fixture =
    size === "small"
      ? generateSmallFixture()
      : generateMediumCollegeFixture();

  await loadFixtureIntoStore(fixture, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });

  const readiness = getTermReadinessReport(fixture.term.code);
  return NextResponse.json(
    {
      loaded: fixture.name,
      readiness,
    },
    { status: 200 },
  );
});

