import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/platform/auth";

export const GET = withAuth(async (_request: NextRequest, auth) => {
  return NextResponse.json(
    {
      user: {
        id: auth.user.id,
        username: auth.user.username,
        email: auth.user.email,
        role: auth.user.role,
        totpEnrolled: auth.user.totpEnrolled,
      },
      session: {
        stage: auth.session.stage,
        idleExpiresAt: auth.session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: auth.session.absoluteExpiresAt.toISOString(),
      },
    },
    { status: 200 },
  );
});

