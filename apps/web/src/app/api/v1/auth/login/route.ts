import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  attachSessionCookie,
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

  const response = NextResponse.json(
    {
      stage: step1.stage,
      totpEnrollment: step1.totpEnrollment ?? null,
    },
    { status: 200 },
  );

  return attachSessionCookie(response, step1.sessionToken);
});

