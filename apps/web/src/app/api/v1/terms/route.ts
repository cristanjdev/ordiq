import { NextRequest, NextResponse } from "next/server";
import {
  deleteTerm,
  listTerms,
  upsertTerm,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";

export const GET = withDeanRoute(async () => {
  return NextResponse.json({ items: listTerms() }, { status: 200 });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const body = await request.json();
  const item = await upsertTerm(body, {
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const code = new URL(request.url).searchParams.get("code") ?? "";
  await deleteTerm(code, { actor: auth.user.username, ipAddress: auth.session.ipAddress });
  return NextResponse.json({ deleted: code }, { status: 200 });
});
