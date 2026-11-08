import { NextRequest, NextResponse } from "next/server";
import { isWorkbookTemplateScope } from "@/lib/workbook-templates";
import {
  buildWorkbookBuffer,
  importWorkbookPayload,
  parseWorkbookBuffer,
  type WorkbookSheetsPayload,
} from "@/server/modules/imports/imports.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { AppError } from "@/server/platform/errors";

/** `GET ?template=1&scope=...&termCode=...`: a template for the selected page or tab. */
export const GET = withDeanRoute(async (request: NextRequest) => {
  const params = new URL(request.url).searchParams;
  if (params.get("template") !== "1") {
    throw new AppError("UNSUPPORTED", "Only ?template=1 is supported.", 400);
  }
  const termCode = params.get("termCode") ?? "AY2026-2027-S1";
  const scope = params.get("scope") ?? "all";
  if (!isWorkbookTemplateScope(scope)) {
    throw new AppError("INVALID_TEMPLATE_SCOPE", "Choose a supported import template.", 400);
  }
  const buffer = await buildWorkbookBuffer({ termCode }, { scope });
  const templateName = {
    all: "Complete",
    faculty: "Faculty",
    rooms: "Rooms",
    subjects: "Subjects",
    sections: "Sections",
    offerings: "Offerings",
  }[scope];
  const fileTerm = termCode.replace(/[^A-Za-z0-9 _.-]/g, "-");
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ORDIQ - ${templateName} Import Template - ${fileTerm}.xlsx"`,
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

