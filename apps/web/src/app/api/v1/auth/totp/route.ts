import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  attachSessionCookie,
  extractSessionToken,
  getTotpEnrollmentForSession,
  loginStep2Totp,
} from "@/server/platform/auth";
import { AppError, withErrorHandler } from "@/server/platform/errors";

export const GET = withErrorHandler(async (request: NextRequest) => {
  const sessionToken = extractSessionToken(request);
  if (!sessionToken) {
    throw new AppError(
      "SESSION_EXPIRED",
      "The sign-in attempt has expired. Please enter the username and password again.",
      401,
    );
  }

  const enrollment = await getTotpEnrollmentForSession({ sessionToken });
  const response = NextResponse.json(
    { totpEnrollment: enrollment },
    { status: 200 },
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
});

const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .min(6, "Authenticator or recovery code is required")
    .max(32, "Code is too long"),
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const sessionToken = extractSessionToken(request);
  if (!sessionToken) {
    throw new AppError(
      "SESSION_EXPIRED",
      "The sign-in attempt has expired. Please enter the username and password again.",
      401,
    );
  }

  const body = totpSchema.parse(await request.json());
  const ipAddress = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  const result = await loginStep2Totp({
    sessionToken,
    code: body.code,
    ipAddress,
    userAgent,
  });

  const response = NextResponse.json(
    {
      stage: result.stage,
      recoveryCodes: result.recoveryCodes ?? null,
      recoveryCodesRemaining: result.recoveryCodesRemaining ?? null,
    },
    { status: 200 },
  );
  response.headers.set("Cache-Control", "no-store");
  // The password-only session was replaced; hand the browser the new token.
  return attachSessionCookie(response, result.sessionToken);
});
