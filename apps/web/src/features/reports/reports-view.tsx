"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarRange,
  ClipboardCheck,
  Download,
  FileClock,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Gauge,
  Loader2,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { fetchItems } from "@/features/data/record-api";
import { useShell } from "@/features/shell/providers";
import { scheduleStatusLabel } from "@/lib/display-labels";
import { cn } from "@/lib/utils";

type ReportId =
  | "SECTION_SCHEDULE"
  | "FACULTY_SCHEDULE"
  | "ROOM_SCHEDULE"
  | "FACULTY_LOAD"
  | "ROOM_UTILIZATION"
  | "COLLEGE_SUMMARY"
  | "CONFLICTS_AND_EXCEPTIONS"
  | "VALIDATION_AND_PREFERENCES"
  | "CANDIDATE_COMPARISON"
  | "PORTAL_ENCODING"
  | "REVISION_HISTORY";

type FilterKind = "section" | "faculty" | "room";

interface ReportItem {
  id: ReportId;
  label: string;
  description: string;
  icon: LucideIcon;
  pdf: boolean;
  filter?: FilterKind;
  /** Uses the whole term, not only the selected schedule. */
  termWide?: boolean;
}

const GROUPS: Array<{ title: string; description: string; items: ReportItem[] }> = [
  {
    title: "Class timetables",
    description: "Weekly schedules to print or share, grouped by section, faculty member or room.",
    items: [
      { id: "SECTION_SCHEDULE", label: "Schedule per Section", description: "Each section's weekly classes with room and faculty.", icon: Users, pdf: true, filter: "section" },
      { id: "FACULTY_SCHEDULE", label: "Schedule per Faculty", description: "Each faculty member's teaching schedule with units and rooms.", icon: UserRound, pdf: true, filter: "faculty" },
      { id: "ROOM_SCHEDULE", label: "Schedule per Room", description: "Each room and laboratory's weekly bookings.", icon: Building2, pdf: true, filter: "room" },
    ],
  },
  {
    title: "Load and utilization",
    description: "How evenly teaching load is spread and how much room time is used.",
    items: [
      { id: "FACULTY_LOAD", label: "Faculty Load", description: "Units against each faculty member's regular maximum, overloads and preparations.", icon: Gauge, pdf: true },
      { id: "ROOM_UTILIZATION", label: "Room Utilization", description: "Booked hours against available teaching hours for every room.", icon: BarChart3, pdf: true },
    ],
  },
  {
    title: "Summary and compliance",
    description: "Figures for the Dean's review, with how each one is calculated.",
    items: [
      { id: "COLLEGE_SUMMARY", label: "College Schedule Summary", description: "Key figures: classes scheduled, conflicts, load balance, room utilization and unmet preferences.", icon: ClipboardCheck, pdf: true },
      { id: "CONFLICTS_AND_EXCEPTIONS", label: "Conflicts and Exceptions", description: "Rule problems to fix, approved exceptions with reasons, and classes not scheduled.", icon: AlertTriangle, pdf: true },
      { id: "VALIDATION_AND_PREFERENCES", label: "Data Quality and Preferences", description: "Data readiness scores, readiness issues, and faculty preferences that were not met.", icon: ShieldCheck, pdf: true },
      { id: "CANDIDATE_COMPARISON", label: "Candidate Comparison", description: "The accepted schedule and all draft candidates side by side.", icon: GitCompareArrows, pdf: true, termWide: true },
    ],
  },
  {
    title: "Working files",
    description: "Excel files for encoding and record-keeping.",
    items: [
      { id: "PORTAL_ENCODING", label: "Portal Encoding Export", description: "One row per class meeting for the scheduling officer to encode in the university portal by hand.", icon: Upload, pdf: false },
      { id: "REVISION_HISTORY", label: "Revision History", description: "Every manual change to this term's schedules: moves, reassignments, undos and revisions.", icon: FileClock, pdf: false, termWide: true },
    ],
  },
];

interface ScheduleOption {
  id: string;
  candidateLabel: string;
  status: string;
}

interface NamedRecord {
  code: string;
  name?: string;
  programCode?: string;
  yearLevel?: number;
}

const STATUS_ORDER: Record<string, number> = { ACCEPTED: 0, CANDIDATE: 1, ARCHIVED: 2 };

function fileNameFrom(res: Response, fallback: string): string {
  const match = /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "");
  return match?.[1] ?? fallback;
}

export function ReportsView() {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;

  const schedulesQuery = useQuery({
    queryKey: ["report-schedules", termCode],
    queryFn: async () => {
      const res = await fetch(`/api/v1/schedules?termCode=${encodeURIComponent(termCode)}`);
      if (!res.ok) throw new Error("Schedules could not be loaded.");
      const data = (await res.json()) as { schedules?: ScheduleOption[] };
      return (data.schedules ?? [])
        .map(({ id, candidateLabel, status }) => ({ id, candidateLabel, status }))
        .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));
    },
  });
  const sectionsQuery = useQuery({ queryKey: ["report-filter", "sections"], queryFn: () => fetchItems<NamedRecord>("sections") });
  const facultyQuery = useQuery({ queryKey: ["report-filter", "faculty"], queryFn: () => fetchItems<NamedRecord>("faculty") });
  const roomsQuery = useQuery({ queryKey: ["report-filter", "rooms"], queryFn: () => fetchItems<NamedRecord>("rooms") });

  const schedules = schedulesQuery.data ?? [];
  const [chosenId, setChosenId] = React.useState("");
  // The accepted schedule by default, else the first candidate.
  const scheduleId = schedules.some((s) => s.id === chosenId) ? chosenId : (schedules[0]?.id ?? "");
  const schedule = schedules.find((s) => s.id === scheduleId);

  const [filters, setFilters] = React.useState<Record<FilterKind, string>>({ section: "", faculty: "", room: "" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<ReportId, string>>>({});

  const exportUrl = (item: ReportItem, format: "PDF" | "XLSX") => {
    const params = new URLSearchParams({ termCode, reportType: item.id, format });
    if (scheduleId) params.set("scheduleId", scheduleId);
    const filter = item.filter ? filters[item.filter] : "";
    if (filter) params.set("entityFilter", filter);
    return `/api/v1/reports?${params}`;
  };

  async function downloadExcel(item: ReportItem) {
    setBusy(item.id);
    setErrors((e) => ({ ...e, [item.id]: undefined }));
    try {
      const res = await fetch(exportUrl(item, "XLSX"));
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The report could not be generated. Try again.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFrom(res, `ordiq-${item.id.toLowerCase()}.xlsx`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setErrors((e) => ({ ...e, [item.id]: err instanceof Error ? err.message : "The report could not be generated." }));
    } finally {
      setBusy(null);
    }
  }

  const filterOptions = (kind: FilterKind) => {
    if (kind === "section")
      return {
        all: "All sections",
        loading: sectionsQuery.isLoading,
        options: [...(sectionsQuery.data ?? [])]
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((s) => ({ value: s.code, label: s.programCode ? `${s.code} · ${s.programCode} year ${s.yearLevel ?? ""}` : s.code })),
      };
    if (kind === "faculty")
      return {
        all: "All faculty",
        loading: facultyQuery.isLoading,
        options: [...(facultyQuery.data ?? [])]
          .sort((a, b) => (a.name ?? a.code).localeCompare(b.name ?? b.code))
          .map((f) => ({ value: f.code, label: f.name ?? f.code })),
      };
    return {
      all: "All rooms",
      loading: roomsQuery.isLoading,
      options: [...(roomsQuery.data ?? [])]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((r) => ({ value: r.code, label: r.name && r.name !== r.code ? `${r.code} · ${r.name}` : r.code })),
    };
  };

  const noSchedule = !schedulesQuery.isLoading && schedules.length === 0;
  const isDraft = Boolean(schedule && schedule.status !== "ACCEPTED");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">Reports</h1>
        <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
          Printable PDF reports and Excel files for {selectedTerm.label}.
        </p>
      </div>

      {/* Which schedule the reports use */}
      <Card className="border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
                <CalendarRange className="h-4 w-4 shrink-0 text-[var(--ordiq-maroon)]" />
                <p className="text-sm font-semibold text-[var(--ordiq-ink)]">Schedule used in the reports</p>
              <InfoTip title="Schedule used in the reports" align="end">
                {noSchedule
                  ? "No schedule has been generated for this term yet, so the schedule reports will be empty."
                  : isDraft
                    ? "This is a draft. Its reports carry a “not official” notice and should not be released to students."
                    : "The accepted schedule is the official one for this term."}
              </InfoTip>
            </div>
          </div>
          <div className="flex w-full min-w-0 items-center rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/40 p-1 lg:w-auto">
            {schedule && (
              <span className={cn(
                "inline-flex shrink-0 items-center gap-1.5 border-r border-[var(--ordiq-border)] px-2.5 py-1 text-xs font-semibold",
                isDraft ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400",
              )}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                {isDraft ? "Draft" : "Official"}
              </span>
            )}
            <SearchableSelect
              label="Schedule used in the reports"
              value={scheduleId}
              onChange={setChosenId}
              disabled={schedulesQuery.isLoading || noSchedule}
              placeholder={schedulesQuery.isLoading ? "Loading schedules…" : "No schedules yet"}
              searchPlaceholder="Search schedules…"
              options={schedules.map((s) => ({ value: s.id, label: `${s.candidateLabel} — ${scheduleStatusLabel(s.status)}` }))}
              variant="embedded"
              className="min-w-0 flex-1 lg:w-80"
            />
          </div>
        </CardContent>
      </Card>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-2.5">
          <div>
            <h2 className="text-sm font-bold text-[var(--ordiq-ink)]">{group.title}</h2>
            <p className="text-xs text-[var(--ordiq-muted)]">{group.description}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => {
              const Icon = item.icon;
              const kind = item.filter;
              const filter = kind ? filterOptions(kind) : null;
              const xlsxBusy = busy === item.id;
              const error = errors[item.id];
              return (
                <Card key={item.id} className="flex flex-col border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs">
                  <CardContent className="flex flex-1 flex-col gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-[var(--ordiq-maroon)]" />
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <h3 className="text-sm font-semibold text-[var(--ordiq-ink)]">{item.label}</h3>
                            {!item.pdf && <Badge variant="neutral" className="px-2 py-0 text-[10px]">Excel only</Badge>}
                            {item.termWide && <Badge variant="neutral" className="px-2 py-0 text-[10px]">Whole term</Badge>}
                          </div>
                        </div>
                        <InfoTip title={item.label} align="end">{item.description}</InfoTip>
                      </div>
                    </div>

                    {filter && kind && (
                      <SearchableSelect
                        label={`Show one ${kind} only`}
                        value={filters[kind]}
                        onChange={(v) => setFilters((f) => ({ ...f, [kind]: v }))}
                        disabled={filter.loading}
                        placeholder="Loading…"
                        searchPlaceholder={`Search ${kind === "faculty" ? "faculty" : `${kind}s`}…`}
                        options={[{ value: "", label: filter.loading ? "Loading…" : filter.all }, ...filter.options]}
                      />
                    )}

                    {error && (
                      <p role="alert" className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
                        {error}
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                      {item.pdf && (
                        <a
                          href={exportUrl(item, "PDF")}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          aria-label={`Open the ${item.label} PDF in a new tab`}
                        >
                          <FileText className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
                          View PDF
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void downloadExcel(item)}
                        disabled={xlsxBusy}
                        className={cn(buttonVariants({ size: "sm", variant: item.pdf ? "outline" : "default" }), "cursor-pointer")}
                        aria-label={`Download the ${item.label} Excel file`}
                      >
                        {xlsxBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : item.pdf ? (
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {xlsxBusy ? "Preparing…" : "Download Excel"}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
