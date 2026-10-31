import { NextRequest, NextResponse } from "next/server";
import {
  listFixedBlocks,
  upsertFixedBlock,
} from "@/server/modules/master-data/master-data.service";
import { withAuth } from "@/server/platform/auth";

export const GET = withAuth(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? undefined;
  return NextResponse.json(
    { items: listFixedBlocks(termCode) },
    { status: 200 },
  );
});

export const POST = withAuth(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertFixedBlock(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

