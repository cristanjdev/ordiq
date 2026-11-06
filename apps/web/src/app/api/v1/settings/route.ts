import { NextResponse } from "next/server";
import { z } from "zod";
import {
  securitySettingsChanged,
  systemSettingsSchema,
} from "@/lib/system-settings";
import { verifyPasswordArgon2id, withAuth } from "@/server/platform/auth";
import { AppError } from "@/server/platform/errors";
import { getSystemSettings, updateSystemSettings } from "@/server/platform/system-settings";

const updateSchema = z.object({
  settings: systemSettingsSchema,
  /** Required when a sign-in or session setting changes. */
  currentPassword: z.string().optional(),
});

export const GET = withAuth(async () => {
  const settings = await getSystemSettings();
  return NextResponse.json({ settings });
});

export const PUT = withAuth(async (request, auth) => {
  const body = updateSchema.parse(await request.json());
  const before = await getSystemSettings();

  if (securitySettingsChanged(before, body.settings)) {
    const password = body.currentPassword ?? "";
    const valid =
      password.length > 0 && (await verifyPasswordArgon2id(auth.user.passwordHash, password));
    if (!valid) {
      throw new AppError(
        "PASSWORD_CONFIRMATION_REQUIRED",
        "Enter the current password to change sign-in and session settings.",
        403,
      );
    }
  }

  const settings = await updateSystemSettings({
    next: body.settings,
    actor: auth.user.username,
    ipAddress: request.headers.get("x-forwarded-for") ?? null,
  });
  return NextResponse.json({ settings });
});
