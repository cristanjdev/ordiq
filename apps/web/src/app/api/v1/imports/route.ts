import { NextRequest, NextResponse } from "next/server";
import {
  buildWorkbookBuffer,
  importWorkbookPayload,
  parseWorkbookBuffer,
  type WorkbookSheetsPayload,
} from "@/server/modules/imports/imports.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { AppError } from "@/server/platform/errors";

/** `GET ?template=1&termCode=...`: an empty workbook with every sheet and column header. */
export const GET = withDeanRoute(async (request: NextRequest) => {
  const params = new URL(request.url).searchParams;
  if (params.get("template") !== "1") {
    throw new AppError("UNSUPPORTED", "Only ?template=1 is supported.", 400);
  }
  const termCode = params.get("termCode") ?? "AY2026-2027-S1";
  const buffer = await buildWorkbookBuffer({ termCode });
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ordiq-import-template-${termCode}.xlsx"`,
    },
  });
});

export const POST = withDeanRoute(async (request: NextRequest, auth) => {
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

