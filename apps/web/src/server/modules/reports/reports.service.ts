import ExcelJS from "exceljs";
import { buildPrintablePdfBuffer } from "./printable-pdf";
import { styleExcelWorksheet } from "@/lib/excel-style";
import { scheduleStatusLabel } from "@/lib/display-labels";
import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import {
  computeScheduleAnalytics,
  resolveTargetSchedule,
} from "../analytics/analytics.service";
import { getMasterDataState } from "../master-data/master-data.store";
import { manilaDateTime, reportAcademicPeriod, REPORT_BUILDERS } from "./report-content";

export const REPORT_TYPES = [
  "SECTION_SCHEDULE",
  "FACULTY_SCHEDULE",
  "ROOM_SCHEDULE",
  "FACULTY_LOAD",
  "ROOM_UTILIZATION",
  "COLLEGE_SUMMARY",
  "CONFLICTS_AND_EXCEPTIONS",
  "VALIDATION_AND_PREFERENCES",
  "CANDIDATE_COMPARISON",
  "PORTAL_ENCODING",
  "REVISION_HISTORY",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = "PDF" | "XLSX";

/** Reports that are working files for encoding or auditing, not for printing. */
const EXCEL_ONLY: ReadonlySet<ReportType> = new Set(["PORTAL_ENCODING", "REVISION_HISTORY"]);

export interface ReportExportInput {
  termCode: string;
  scheduleId?: string;
  compareScheduleId?: string;
  reportType: ReportType;
  format: ReportFormat;
  entityFilter?: string;
  actor: string;
}

export interface ReportExportResult {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  watermark: string;
  summaryMetrics: {
    classesScheduled: number;
    conflictsDetected: number;
    facultyLoadBalanceScore: number;
    roomUtilizationPct: number;
    unmetPreferencesCount: number;
  };
}

export const CANDIDATE_WATERMARK = "CANDIDATE SCHEDULE — NOT OFFICIAL — NOT FOR STUDENT RELEASE";

/**
 * Generate any of the 11 required Phase 6 reports as a printable PDF or an
 * Excel (.xlsx) workbook. Figures come from `analytics.service.ts`, the same
 * source as the Dashboard, and every export is audited.
 */
export async function generateScheduleReport(
  input: ReportExportInput,
): Promise<ReportExportResult> {
  if (input.format === "PDF" && EXCEL_ONLY.has(input.reportType)) {
    throw new AppError(
      "FORMAT_NOT_SUPPORTED",
      "This report is available in Excel (.xlsx) only.",
      422,
    );
  }

  return withAudit(
    {
      actor: input.actor,
      action: "REPORT_EXPORTED",
      entity: "ScheduleReport",
      entityId: `${input.termCode}:${input.reportType}:${input.format}`,
    },
    async () => {
      const state = getMasterDataState();
      const sched = resolveTargetSchedule(input.termCode, input.scheduleId);
      if (input.scheduleId && !sched) {
        throw new AppError("SCHEDULE_NOT_FOUND", "The selected schedule no longer exists.", 404);
      }
      const analytics = computeScheduleAnalytics(input.termCode, sched?.id);
      const watermark = sched && sched.status !== "ACCEPTED" ? CANDIDATE_WATERMARK : "";

      const content = REPORT_BUILDERS[input.reportType]({
        state,
        termCode: input.termCode,
        sched,
        analytics,
        entityFilter: input.entityFilter,
        watermark,
      });

      const term = state.terms.get(input.termCode);
      const encodedTerm = /^AY(\d{4}-\d{4})-S([12])$/i.exec(input.termCode);
      const termLabel = term
        ? reportAcademicPeriod(term.academicYear, term.semester)
        : encodedTerm?.[1]
          ? reportAcademicPeriod(encodedTerm[1], Number(encodedTerm[2]))
          : `Academic Term: ${input.termCode}`;
      const scheduleLine = sched
        ? `Schedule: ${sched.candidateLabel} (${scheduleStatusLabel(sched.status)})`
        : "No schedule yet";
      const subtitle = [termLabel, scheduleLine, `Date Generated: ${manilaDateTime(new Date())}`].join(" · ");

      const summaryMetrics = {
        classesScheduled: analytics.metrics.classesScheduled,
        conflictsDetected: analytics.metrics.conflictsDetected,
        facultyLoadBalanceScore: analytics.metrics.facultyLoadBalanceScore,
        roomUtilizationPct: analytics.metrics.roomUtilizationPct,
        unmetPreferencesCount: analytics.metrics.unmetPreferencesCount,
      };

      const slug = content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const filter = input.entityFilter ? `-${input.entityFilter.toLowerCase().replace(/[^a-z0-9-]+/g, "")}` : "";
      const baseName = `ordiq-${input.termCode.toLowerCase()}-${slug}${filter}`;

      if (input.format === "PDF") {
        return {
          fileName: `${baseName}.pdf`,
          mimeType: "application/pdf",
          buffer: buildPrintablePdfBuffer({
            title: content.title,
            subtitle,
            watermark,
            intro: content.intro,
            summary: content.summary,
            sections: content.sections.map((section) => ({
              ...section,
              align: section.headers.map((_, column) => column === 0 ? "left" : "center"),
            })),
          }),
          watermark,
          summaryMetrics,
        };
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "ORDIQ Scheduling Decision-Support System";
      workbook.created = new Date();
      const sheet = workbook.addWorksheet(content.title.slice(0, 31));
      const { headers, rows } = content.sheet;
      sheet.addRow([`ORDIQ — ${content.title}`]);
      sheet.addRow([watermark || content.intro]);
      sheet.addRow([
        [subtitle, ...content.summary.map((s) => `${s.label}: ${s.value}`)].join("   |   "),
      ]);
      sheet.addRow([]);
      sheet.addRow(headers);
      for (const r of rows) sheet.addRow(r);
      styleExcelWorksheet(sheet, {
        headerRow: 5,
        columnCount: headers.length,
        reportHeading: true,
      });

      return {
        fileName: `${baseName}.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
        watermark,
        summaryMetrics,
      };
    },
  );
}
