import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  extractSessionToken,
  loginStep2Totp,
} from "@/server/platform/auth";
import { AppError, withErrorHandler } from "@/server/platform/errors";

const totpSchema = z.object({
  code: z.string().min(6, "Authenticator or recovery code is required"),
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const sessionToken = extractSessionToken(request);
  if (!sessionToken) {
    throw new AppError(
      "UNAUTHORIZED",
      "Missing pending authentication session. Complete password step first.",
      401,
    );
  }

  const body = totpSchema.parse(await request.json());
  const ipAddress = request.headers.get("x-forwarded-for") ?? "127.0.0.1";

  const result = await loginStep2Totp({
    sessionToken,
    code: body.code,
    ipAddress,
  });

  return NextResponse.json(
    {
      stage: result.stage,
      recoveryCodes: result.recoveryCodes ?? null,
    },
    { status: 200 },
  );
});

