import { NextRequest, NextResponse } from "next/server";
import {
  listTerms,
  upsertTerm,
} from "@/server/modules/master-data/master-data.service";
import { withAuth } from "@/server/platform/auth";

export const GET = withAuth(async () => {
  return NextResponse.json({ items: listTerms() }, { status: 200 });
});

export const POST = withAuth(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertTerm(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

