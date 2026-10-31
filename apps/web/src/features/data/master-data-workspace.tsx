"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Filter,
  Plus,
  Search,
  Upload,
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

export type DatasetKind = "faculty" | "subjects" | "sections" | "rooms" | "offerings";

interface ReadinessReportDto {
  termCode: string;
  canGenerate: boolean;
  criticalCount: number;
  warningCount: number;
  iso25012Scores: {
    completeness: number;
    accuracy: number;
    consistency: number;
    currentness: number;
    overall: number;
  };
  counts: {
    programs: number;
    faculty: number;
    subjects: number;
    sections: number;
    rooms: number;
    offerings: number;
    fixedBlocks: number;
  };
  issues: Array<{
    code: string;
    severity: "CRITICAL" | "WARNING";
    dimension: string;
    entityCode: string;
    message: string;
  }>;
}

export function MasterDataWorkspace({
  initialDataset = "faculty",
  title,
  subtitle,
}: {
  initialDataset?: DatasetKind;
  title: string;
  subtitle: string;
}) {
  const { selectedTerm } = useShell();
  const queryClient = useQueryClient();
  const [dataset, setDataset] = React.useState<DatasetKind>(initialDataset);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  const readinessQuery = useQuery<ReadinessReportDto>({
    queryKey: ["readiness", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/readiness?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as ReadinessReportDto;
    },
    retry: false,
  });

  const dataQuery = useQuery<{ items: Array<Record<string, unknown>> }>({
    queryKey: ["master-data", dataset, selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/${dataset}?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: Array<Record<string, unknown>> };
    },
    retry: false,
  });

  const loadFixtureMutation = useMutation({
    mutationFn: async (size: "small" | "medium") => {
      const res = await fetch("/api/v1/fixtures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "Failed to load fixture");
      }
      return res.json();
    },
    onSuccess: async () => {
      setStatusMessage(
        "Loaded MSEUF College of Engineering synthetic fixture (7 programs, 44 faculty, 903 students in 24 sections).",
      );
      await queryClient.invalidateQueries({ queryKey: ["readiness"] });
      await queryClient.invalidateQueries({ queryKey: ["master-data"] });
    },
    onError: (err) => {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to load fixture",
      );
    },
  });

  const items = dataQuery.data?.items ?? [];
  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return Object.values(item).some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(q),
    );
  });

  const readiness = readinessQuery.data;

  return (
    <div className="space-y-5">
      {/* Top Header & Fixture / Import Controls */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {title}
            </h1>
            <Badge variant="default">Phase 1 · Validated Data Layer</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">{subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadFixtureMutation.mutate("medium")}
            disabled={loadFixtureMutation.isPending}
          >
            <Database className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
            Load MSEUF College Fixture (44 Faculty)
          </Button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* ISO/IEC 25012 Data Readiness Summary Card (Phase 1D) */}
      {readiness && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">
                  ISO/IEC 25012 Data Readiness Report ({readiness.termCode})
                </CardTitle>
                <CardDescription>
                  Evaluates completeness, accuracy, consistency, and currentness
                  before schedule generation
                </CardDescription>
              </div>
              {readiness.canGenerate ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Ready for Generation (0 Critical Gaps)
                </Badge>
              ) : (
                <Badge variant="danger">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Generation Blocked ({readiness.criticalCount} Critical Gaps)
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Completeness
                </div>
                <div className="mt-1 text-lg font-bold">
                  {readiness.iso25012Scores.completeness}%
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Accuracy
                </div>
                <div className="mt-1 text-lg font-bold">
                  {readiness.iso25012Scores.accuracy}%
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Consistency
                </div>
                <div className="mt-1 text-lg font-bold">
                  {readiness.iso25012Scores.consistency}%
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Currentness
                </div>
                <div className="mt-1 text-lg font-bold">
                  {readiness.iso25012Scores.currentness}%
                </div>
              </div>
            </div>

            {readiness.issues.length > 0 && (
              <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3 text-xs">
                <p className="font-semibold">
                  Readiness Findings ({readiness.criticalCount} critical,{" "}
                  {readiness.warningCount} warnings):
                </p>
                <ul className="mt-1.5 space-y-1">
                  {readiness.issues.slice(0, 6).map((issue, idx) => (
                    <li
                      key={`${issue.code}-${issue.entityCode}-${idx}`}
                      className="flex items-center gap-2"
                    >
                      <Badge
                        variant={
                          issue.severity === "CRITICAL" ? "danger" : "warning"
                        }
                      >
                        {issue.severity}
                      </Badge>
                      <span className="font-mono text-[11px]">
                        [{issue.dimension}]
                      </span>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Spreadsheet Grid Card (Fig. 4) */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ordiq-border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { id: "faculty", label: "Faculty" },
                { id: "subjects", label: "Subjects" },
                { id: "sections", label: "Sections" },
                { id: "rooms", label: "Rooms & Labs" },
                { id: "offerings", label: "Offerings" },
              ] as const
            ).map((tab) => (
              <Button
                key={tab.id}
                variant={dataset === tab.id ? "default" : "outline"}
                size="sm"
                onClick={() => setDataset(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm">
              <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Add Row
            </Button>
            <Button variant="outline" size="sm">
              <Upload className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Import .xlsx
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Export
            </Button>
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${dataset}...`}
                className="w-40 bg-transparent text-xs focus:outline-none"
              />
            </div>
            <Button variant="outline" size="sm" aria-label="Filter grid">
              <Filter className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                {filteredItems[0] ? (
                  Object.keys(filteredItems[0])
                    .filter((k) => k !== "id")
                    .map((col) => (
                      <th key={col} className="px-4 py-2.5">
                        {col}
                      </th>
                    ))
                ) : (
                  <>
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Details</th>
                    <th className="px-4 py-2.5">Status</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-xs text-[var(--ordiq-muted)]"
                  >
                    {dataQuery.isError
                      ? "Sign in with the Dean account and TOTP code (/login) to view or edit college records."
                      : `No ${dataset} records loaded yet. Click "Load MSEUF College Fixture" or import the data-gathering workbook.`}
                  </td>
                </tr>
              ) : (
                filteredItems.map((row, idx) => (
                  <tr
                    key={String(row.code ?? row.id ?? idx)}
                    className="border-b border-[var(--ordiq-border)] hover:bg-[var(--ordiq-surface-muted)]/60"
                  >
                    {Object.entries(row)
                      .filter(([k]) => k !== "id")
                      .map(([k, val]) => (
                        <td key={k} className="px-4 py-2.5">
                          {Array.isArray(val)
                            ? val.join(", ")
                            : String(val ?? "—")}
                        </td>
                      ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

