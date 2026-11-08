import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateScheduleReport,
  REPORT_TYPES,
} from "../../../../server/modules/reports/reports.service";
import { withDeanRoute } from "@/server/http/dean-route";
import { toErrorResponse } from "../../../../server/platform/errors";

const reportQuerySchema = z.object({
  termCode: z.string().default("AY2026-2027-S1"),
  scheduleId: z.string().optional(),
  compareScheduleId: z.string().optional(),
  reportType: z.enum(REPORT_TYPES).default("COLLEGE_SUMMARY"),
  format: z.enum(["PDF", "XLSX"]).default("PDF"),
  entityFilter: z.string().optional(),
});

export const GET = withDeanRoute(async (req, ctx) => {
  try {
    const url = new URL(req.url);
    const parsed = reportQuerySchema.parse({
      termCode: url.searchParams.get("termCode") ?? "AY2026-2027-S1",
      scheduleId: url.searchParams.get("scheduleId") ?? undefined,
      compareScheduleId: url.searchParams.get("compareScheduleId") ?? undefined,
      reportType: url.searchParams.get("reportType") ?? "COLLEGE_SUMMARY",
      format: url.searchParams.get("format") ?? "PDF",
      entityFilter: url.searchParams.get("entityFilter") ?? undefined,
    });

    const result = await generateScheduleReport({
      ...parsed,
      actor: ctx.user.username,
    });

    if (url.searchParams.get("mode") === "json") {
      return NextResponse.json({
        fileName: result.fileName,
        mimeType: result.mimeType,
        watermark: result.watermark,
        summaryMetrics: result.summaryMetrics,
        byteLength: result.buffer.byteLength,
      });
    }

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `${parsed.format === "PDF" ? "inline" : "attachment"}; filename="${result.fileName}"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
});
