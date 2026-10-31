import { NextRequest, NextResponse } from "next/server";
import {
  deleteSection,
  listSections,
  upsertSection,
} from "@/server/modules/master-data/master-data.service";
import { withAuth } from "@/server/platform/auth";

export const GET = withAuth(async () => {
  return NextResponse.json({ items: listSections() }, { status: 200 });
});

export const POST = withAuth(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertSection(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withAuth(async (request: NextRequest, auth) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  await deleteSection(code, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ deleted: code }, { status: 200 });
});

