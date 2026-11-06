import { NextRequest, NextResponse } from "next/server";
import {
  deleteProgram,
  listPrograms,
  upsertProgram,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";

export const GET = withDeanRoute(async () => {
  return NextResponse.json({ items: listPrograms() }, { status: 200 });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertProgram(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  await deleteProgram(code, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ deleted: code }, { status: 200 });
});

