import { NextRequest, NextResponse } from "next/server";
import {
  deleteRoom,
  listRooms,
  upsertRoom,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";

export const GET = withDeanRoute(async () => {
  return NextResponse.json({ items: listRooms() }, { status: 200 });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertRoom(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code") ?? "";
  await deleteRoom(code, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ deleted: code }, { status: 200 });
});

