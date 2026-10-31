import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/server/platform/audit";
import {
  clearSessionCookie,
  extractSessionToken,
  getAuthStore,
} from "@/server/platform/auth";
import { sha256Hex } from "@/server/platform/crypto";
import { withErrorHandler } from "@/server/platform/errors";

export const POST = withErrorHandler(async (request: NextRequest) => {
  const rawToken = extractSessionToken(request);
  if (rawToken) {
    const tokenHash = sha256Hex(rawToken);
    const store = getAuthStore();
    const session = await store.findSessionByTokenHash(tokenHash);
    await store.deleteSessionByTokenHash(tokenHash);
    if (session) {
      await recordAudit({
        actor: session.userId,
        action: "LOGOUT",
        entity: "Session",
        entityId: session.id,
      });
    }
  }

  const response = NextResponse.json({ status: "logged_out" }, { status: 200 });
  return clearSessionCookie(response);
});

