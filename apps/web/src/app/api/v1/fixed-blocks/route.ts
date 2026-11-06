import { NextRequest, NextResponse } from "next/server";
import {
  deleteFixedBlock,
  listFixedBlocks,
  upsertFixedBlock,
} from "@/server/modules/master-data/master-data.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { readKeyedBody, requireIdParam } from "@/server/http/keyed-record";

export const GET = withDeanRoute(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? undefined;
  return NextResponse.json(
    { items: listFixedBlocks(termCode) },
    { status: 200 },
  );
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
  const { input, replaceId } = await readKeyedBody(request);
  const item = await upsertFixedBlock(
    input as Parameters<typeof upsertFixedBlock>[0],
    { actor: auth.user.username, ipAddress: auth.session.ipAddress },
    { replaceId },
  );
  return NextResponse.json({ item }, { status: 200 });
});

export const DELETE = withDeanRoute(async (request: NextRequest, auth) => {
  const id = requireIdParam(request);
  await deleteFixedBlock(id, { actor: auth.user.username, ipAddress: auth.session.ipAddress });
  return NextResponse.json({ deleted: id }, { status: 200 });
});
