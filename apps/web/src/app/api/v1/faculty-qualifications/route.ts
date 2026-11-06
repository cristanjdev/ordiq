import { NextRequest, NextResponse } from "next/server";
import {
  deleteFacultyQualification,
  listFacultyQualifications,
  upsertFacultyQualification,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { readKeyedBody, requireIdParam } from "@/server/http/keyed-record";

export const GET = withDeanRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const items = listFacultyQualifications({
    facultyCode: searchParams.get("facultyCode") ?? undefined,
  });
  return NextResponse.json({ items }, { status: 200 });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const { input, replaceId } = await readKeyedBody(request);
  const item = await upsertFacultyQualification(
    input as Parameters<typeof upsertFacultyQualification>[0],
    { actor: auth.user.username, ipAddress: auth.session.ipAddress },
    { replaceId },
  );
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const id = requireIdParam(request);
  await deleteFacultyQualification(id, { actor: auth.user.username, ipAddress: auth.session.ipAddress });
  return NextResponse.json({ deleted: id }, { status: 200 });
});
