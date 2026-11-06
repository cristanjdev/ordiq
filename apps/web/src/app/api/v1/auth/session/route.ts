import { NextRequest, NextResponse } from "next/server";
import { requireDeanSession } from "@/server/platform/auth";
import { withErrorHandler } from "@/server/platform/errors";

/**
 * Returns the authenticated Dean session.
 *
 * - `GET /api/v1/auth/session`            validates AND slides the idle window
 *                                         (used by the client activity heartbeat).
 * - `GET /api/v1/auth/session?passive=1`  validates only; never extends the
 *                                         session (used by route guards and
 *                                         tab-focus re-validation).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const passive = request.nextUrl.searchParams.get("passive") === "1";
  const auth = await requireDeanSession(request, { slide: !passive });

  const response = NextResponse.json(
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
  response.headers.set("Cache-Control", "no-store");
  return response;
});
