import { NextRequest, NextResponse } from "next/server";
import {
  deleteDirective,
  listDirectives,
  saveDirective,
  setDirectiveApproval,
} from "@/server/modules/directives/directives.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { readKeyedBody, requireIdParam } from "@/server/http/keyed-record";
import { AppError } from "@/server/platform/errors";

export const GET = withDeanRoute(async (request: NextRequest) => {
  const termCode = new URL(request.url).searchParams.get("termCode") ?? undefined;
  return NextResponse.json({ items: listDirectives(termCode) }, { status: 200 });
});

/** Create a directive, or edit one when `replaceId` names it (approval resets). */
export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const { input, replaceId } = await readKeyedBody(request);
  const item = await saveDirective(
    input as Parameters<typeof saveDirective>[0],
    { actor: auth.user.username, ipAddress: auth.session.ipAddress },
    replaceId,
  );
  return NextResponse.json({ item }, { status: 200 });
});

/** Approve or revoke: `{ "id": "...", "approved": true }`. */
export const PATCH = withDeanRoute(async (request: NextRequest, auth) => {
  const body = (await request.json()) as { id?: unknown; approved?: unknown };
  if (typeof body.id !== "string" || typeof body.approved !== "boolean") {
    throw new AppError("INVALID_BODY", "Expected { id: string, approved: boolean }.", 400);
  }
  const item = await setDirectiveApproval(body.id, body.approved, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const id = requireIdParam(request);
  await deleteDirective(id, { actor: auth.user.username, ipAddress: auth.session.ipAddress });
  return NextResponse.json({ deleted: id }, { status: 200 });
});
