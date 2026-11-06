import { NextRequest, NextResponse } from "next/server";
import {
  deleteFacultyPreference,
  listFacultyPreferences,
  upsertFacultyPreference,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { readKeyedBody, requireIdParam } from "@/server/http/keyed-record";

export const GET = withDeanRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const items = listFacultyPreferences({
    facultyCode: searchParams.get("facultyCode") ?? undefined,
    termCode: searchParams.get("termCode") ?? undefined,
  });
  return NextResponse.json({ items }, { status: 200 });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const { input, replaceId } = await readKeyedBody(request);
  const item = await upsertFacultyPreference(
    input as Parameters<typeof upsertFacultyPreference>[0],
    { actor: auth.user.username, ipAddress: auth.session.ipAddress },
    { replaceId },
  );
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const id = requireIdParam(request);
  await deleteFacultyPreference(id, { actor: auth.user.username, ipAddress: auth.session.ipAddress });
  return NextResponse.json({ deleted: id }, { status: 200 });
});
