import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  attachSessionCookie,
  getTotpEnrollmentForSession,
  loginStep1Password,
} from "@/server/platform/auth";
import { withErrorHandler } from "@/server/platform/errors";

const loginSchema = z.object({
  identifier: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = loginSchema.parse(await request.json());
  const ipAddress = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  const step1 = await loginStep1Password({
    identifier: body.identifier,
    password: body.password,
    ipAddress,
    userAgent,
  });

  let totpEnrollment = step1.totpEnrollment ?? null;
  if (!totpEnrollment && step1.stage === "VERIFY_TOTP") {
    totpEnrollment = await getTotpEnrollmentForSession({
      sessionToken: step1.sessionToken,
    }).catch(() => null);
  }

  const response = NextResponse.json(
    {
      stage: step1.stage,
      totpEnrollment,
    },
    { status: 200 },
  );
  // The response can carry the authenticator secret; never cache it.
  response.headers.set("Cache-Control", "no-store");

  return attachSessionCookie(response, step1.sessionToken);
});

