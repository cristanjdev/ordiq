"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  ShieldAlert,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useShell } from "@/features/shell/providers";

interface ReportCatalogueItem {
  id: string;
  label: string;
  description: string;
  supportsPdf: boolean;
  supportsXlsx: boolean;
}

const REPORT_CATALOGUE: readonly ReportCatalogueItem[] = [
  {
    id: "SECTION_SCHEDULE",
    label: "Class Schedule per Section",
    description:
      "Weekly timetable of lecture and laboratory meetings for each engineering section.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "FACULTY_SCHEDULE",
    label: "Class Schedule per Faculty",
    description:
      "Individual teaching schedule per faculty member with room and section assignments.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "ROOM_SCHEDULE",
    label: "Class Schedule per Room",
    description:
      "Weekly room occupancy schedule across all lecture rooms and laboratories.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "FACULTY_LOAD",
    label: "Faculty Load Report",
    description:
      "Assigned units, regular max units, overload units, preparations count, and utilization %.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "ROOM_UTILIZATION",
    label: "Room Utilization Report",
    description:
      "Used minutes vs. available weekly teaching minutes across lecture and laboratory rooms.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "COLLEGE_SUMMARY",
    label: "College Schedule Summary",
    description:
      "Executive summary of scheduled classes, hard conflicts, load balance, and documented metric formulas.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "CONFLICTS_AND_EXCEPTIONS",
    label: "Conflict and Exception Report",
    description:
      "All hard constraint checks, unplaced meetings with diagnostic codes, and D-18 documented waivers.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "VALIDATION_AND_PREFERENCES",
    label: "Validation & Unmet Preferences Report",
    description:
      "ISO/IEC 25012 data readiness scores and unmet faculty preferences (SC-01).",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "CANDIDATE_COMPARISON",
    label: "Candidate Comparison",
    description:
      "Side-by-side comparison of BALANCED, FACULTY_FIRST, and STUDENT_FIRST candidates.",
    supportsPdf: true,
    supportsXlsx: true,
  },
  {
    id: "PORTAL_ENCODING",
    label: "Portal Encoding Export",
    description:
      "Excel sheet formatted for manual encoding by the scheduling officer (ORDIQ never connects to the portal).",
    supportsPdf: false,
    supportsXlsx: true,
  },
  {
    id: "REVISION_HISTORY",
    label: "Revision History",
    description:
      "Complete audit trail of ScheduleChange edits, undos, and parent-child revisions.",
    supportsPdf: false,
    supportsXlsx: true,
  },
] as const;

interface EvaluationEvidenceDto {
  termCode: string;
  baselineCarePolicy: string;
  iso25010TestCases: Array<{
    id: string;
    qualityCharacteristic: string;
    stage: string;
    title: string;
    verificationTarget: string;
    status: string;
  }>;
  stage2HistoricalComparison: {
    manualCandidateLabel: string;
    manualHardViolations: number;
    currentHardViolations: number;
    hardViolationsEliminated: number;
  } | null;
}

export function ReportsView() {
  const { selectedTerm } = useShell();
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const evalQuery = useQuery<EvaluationEvidenceDto>({
    queryKey: ["evaluation-evidence", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/evaluation?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as EvaluationEvidenceDto;
    },
    retry: false,
  });

  const exportMutation = useMutation({
    mutationFn: async (input: {
      reportType: string;
      format: "PDF" | "XLSX";
    }) => {
      const url = `/api/v1/reports?termCode=${encodeURIComponent(selectedTerm.id)}&reportType=${input.reportType}&format=${input.format}&mode=json`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Export failed");
      }
      return (await res.json()) as {
        fileName: string;
        watermark: string;
        byteLength: number;
      };
    },
    onSuccess: (data) => {
      setStatusMessage(
        `Exported ${data.fileName} (${data.byteLength} bytes) · Watermark: ${data.watermark}`,
      );
    },
    onError: (err) => {
      setStatusMessage(err instanceof Error ? err.message : "Export failed");
    },
  });

  const evalData = evalQuery.data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              Reports, Portal Exports & Evaluation Evidence
            </h1>
            <Badge variant="default">Phase 6 & 7 · Audited Exports</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            Generate printable PDF and Excel (.xlsx) reports per section,
            faculty, and room, plus Stage 1–3 ISO/IEC 25010 evaluation evidence.
          </p>
        </div>
      </div>

      {/* Candidate Watermark & Portal Boundary Banner */}
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-[var(--ordiq-ink)]">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold">
            Candidate Watermark & Portal Boundary:
          </span>{" "}
          All exported reports carry explicit candidate vs. accepted watermarks.
          ORDIQ is a standalone decision-support tool and never connects
          directly to the MSEUF portal.
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* 11 Required Reports Grid (Phase 6 Table) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {REPORT_CATALOGUE.map((item) => (
          <Card key={item.id} className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{item.label}</CardTitle>
              <CardDescription className="text-xs">
                {item.description}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 pt-2">
              {item.supportsPdf && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    exportMutation.mutate({
                      reportType: item.id,
                      format: "PDF",
                    })
                  }
                  disabled={exportMutation.isPending}
                >
                  <FileText className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
                  Export PDF
                </Button>
              )}
              {item.supportsXlsx && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() =>
                    exportMutation.mutate({
                      reportType: item.id,
                      format: "XLSX",
                    })
                  }
                  disabled={exportMutation.isPending}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Export Excel (.xlsx)
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Phase 7: ISO/IEC 25010 Three-Stage Evaluation Evidence Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-[var(--ordiq-maroon)]" />
              <div>
                <CardTitle className="text-sm">
                  Phase 7 · ISO/IEC 25010 Three-Stage Evaluation Evidence
                </CardTitle>
                <CardDescription>
                  Stage 1 (Functional Performance), Stage 2 (1st Sem A.Y.
                  2026–2027 Historical Data Test), and Stage 3 (Dean Pilot)
                </CardDescription>
              </div>
            </div>
            <Badge variant="success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Stage 1 & 2 Verified · Stage 3 Pilot Ready
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {evalData?.baselineCarePolicy && (
            <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3 text-[11px] text-[var(--ordiq-muted)]">
              {evalData.baselineCarePolicy}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase text-[var(--ordiq-muted)]">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">ISO/IEC 25010 Quality</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Test Case</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(evalData?.iso25010TestCases ?? []).map((tc) => (
                  <tr
                    key={tc.id}
                    className="border-b border-[var(--ordiq-border)]"
                  >
                    <td className="px-3 py-2 font-mono">{tc.id}</td>
                    <td className="px-3 py-2">{tc.qualityCharacteristic}</td>
                    <td className="px-3 py-2">{tc.stage}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{tc.title}</div>
                      <div className="text-[11px] text-[var(--ordiq-muted)]">
                        {tc.verificationTarget}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          tc.status === "PASSED" ? "success" : "warning"
                        }
                      >
                        {tc.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
