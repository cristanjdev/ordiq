import { NextRequest, NextResponse } from "next/server";
import {
  importWorkbookPayload,
  parseWorkbookBuffer,
  type WorkbookSheetsPayload,
} from "@/server/modules/imports/imports.service";
import { withAuth } from "@/server/platform/auth";

export const POST = withAuth(async (request: NextRequest, auth) => {
  const body = (await request.json()) as {
    dryRun?: boolean;
    termCode?: string;
    workbookBase64?: string;
    sheets?: WorkbookSheetsPayload;
  };

  const termCode = body.termCode ?? "AY2026-2027-S1";
  let payload: WorkbookSheetsPayload;

  if (body.workbookBase64) {
    const buffer = Buffer.from(body.workbookBase64, "base64");
    payload = await parseWorkbookBuffer(buffer, termCode);
  } else {
    payload = body.sheets ?? { termCode };
  }

  const summary = await importWorkbookPayload(payload, {
    dryRun: Boolean(body.dryRun),
    actor: auth.user.username,
    ipAddress: auth.session.ipAddress,
  });

  return NextResponse.json(summary, {
    status: summary.status === "FAILED" ? 422 : 200,
  });
});

