"use client";

import { downloadExcelExport } from "@/lib/excel-export";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SkeletonBlock,
  skeletonRowCount,
  TableRefreshBar,
  TableSkeletonRows,
} from "@/components/ui/table-skeleton";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import {
  componentLabel,
  formatDuration,
  HARD_CONSTRAINT_NAMES,
  roomTypeLabel,
  titleCase,
  weekdayLabel,
} from "@/lib/display-labels";
import { useShell } from "@/features/shell/providers";
import { cn } from "@/lib/utils";
import {
  type AnalyticsDto,
  type CellSubjectGroup,
  chipThemeFor,
  type DashboardMeeting,
  displayFacultyLabel,
  displayRoomLabel,
  EMPLOYMENT_LABELS,
  type FacultyDto,
  filterMeetingsBySection,
  formatClock,
  formatTimeRange,
  groupCellSubjects,
  groupSubjectByTimeSlot,
  hourRows,
  joinMeetings,
  meetingsForHourSlot,
  type OfferingDto,
  type RoomDto,
  type ScheduleDto,
  type SectionDto,
  type SubjectDto,
  visibleWeekdays,
  WEEKDAY_SHORT,
  type WeekdayCode,
} from "./dashboard-data";

type WorkspaceTab = "faculty" | "courses" | "rooms" | "schedule";
type WeeklySlot = { day: WeekdayCode; hour: number };
type ClassDetailsTarget = {
  subjectCode: string;
  slot?: WeeklySlot;
  highlightMeetingId?: string;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

function useItems<T>(key: string, url: string) {
  return useQuery<T[]>({
    queryKey: ["dashboard", key, url],
    queryFn: async () => (await fetchJson<{ items: T[] }>(url)).items,
  });
}

export function DashboardView() {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>("faculty");
  const [selectedSection, setSelectedSection] = React.useState("ALL");
  const [selectedSlot, setSelectedSlot] = React.useState<WeeklySlot | null>(null);
  const [selectedClass, setSelectedClass] = React.useState<ClassDetailsTarget | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // The AI panel can ask the dashboard to show a tab.
  React.useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: WorkspaceTab }>).detail?.tab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("ordiq:switch-tab", handleSwitchTab);
    return () => window.removeEventListener("ordiq:switch-tab", handleSwitchTab);
  }, []);

  const analyticsQuery = useQuery<AnalyticsDto>({
    queryKey: ["dashboard", "analytics", termCode],
    queryFn: () =>
      fetchJson<AnalyticsDto>(`/api/v1/analytics?termCode=${encodeURIComponent(termCode)}`),
  });
  const scheduleId = analyticsQuery.data?.scheduleId ?? null;
  const scheduleQuery = useQuery<ScheduleDto>({
    queryKey: ["dashboard", "schedule", scheduleId],
    queryFn: async () =>
      (
        await fetchJson<{ schedule: ScheduleDto }>(
          `/api/v1/schedules?scheduleId=${encodeURIComponent(scheduleId ?? "")}`,
        )
      ).schedule,
    enabled: scheduleId !== null,
  });
  const facultyQuery = useItems<FacultyDto>("faculty", "/api/v1/faculty");
  const subjectsQuery = useItems<SubjectDto>("subjects", "/api/v1/subjects");
  const sectionsQuery = useItems<SectionDto>("sections", "/api/v1/sections");
  const roomsQuery = useItems<RoomDto>("rooms", "/api/v1/rooms");
  const offeringsQuery = useItems<OfferingDto>(
    "offerings",
    `/api/v1/offerings?termCode=${encodeURIComponent(termCode)}`,
  );

  const generate = useMutation({
    mutationFn: () =>
      fetchJson<{ candidates: unknown[] }>("/api/v1/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          termCode,
          profiles: ["BALANCED"],
        }),
      }),
    onSuccess: async () => {
      setNotice({
        tone: "ok",
        text: "Generated the optimal schedule. Review its evaluation and accept it in Schedules.",
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => setNotice({ tone: "error", text: error.message }),
  });

  const analytics = analyticsQuery.data;
  const hasSchedule = scheduleId !== null;
  // First load per tab shows placeholder rows; refetches show a thin bar.
  const scheduleLoading = analyticsQuery.isLoading || scheduleQuery.isLoading;
  const tabLoading: Record<WorkspaceTab, boolean> = {
    faculty: facultyQuery.isLoading || analyticsQuery.isLoading,
    courses: offeringsQuery.isLoading || subjectsQuery.isLoading,
    rooms: roomsQuery.isLoading || analyticsQuery.isLoading,
    schedule: scheduleLoading || subjectsQuery.isLoading || facultyQuery.isLoading,
  };
  const dashboardRefreshing = [
    analyticsQuery,
    scheduleQuery,
    facultyQuery,
    subjectsQuery,
    sectionsQuery,
    roomsQuery,
    offeringsQuery,
  ].some((q) => q.isFetching && !q.isLoading);
  const faculty = facultyQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];
  const rooms = roomsQuery.data ?? [];
  const offerings = offeringsQuery.data ?? [];

  const meetings = React.useMemo(
    () =>
      joinMeetings(scheduleQuery.data, {
        offerings: new Map(offerings.map((o) => [o.code, o])),
        subjects: new Map(subjects.map((s) => [s.code, s])),
        faculty: new Map(faculty.map((f) => [f.code, f])),
      }),
    [scheduleQuery.data, offerings, subjects, faculty],
  );

  const sectionMeetings = React.useMemo(
    () => filterMeetingsBySection(meetings, selectedSection),
    [meetings, selectedSection],
  );

  const slotMeetings = React.useMemo(
    () =>
      selectedSlot ? meetingsForHourSlot(sectionMeetings, selectedSlot.day, selectedSlot.hour) : [],
    [sectionMeetings, selectedSlot],
  );

  const classMeetings = React.useMemo(
    () =>
      selectedClass
        ? sectionMeetings.filter((m) => m.subjectCode === selectedClass.subjectCode)
        : [],
    [sectionMeetings, selectedClass],
  );

  React.useEffect(() => {
    setSelectedSlot(null);
    setSelectedClass(null);
  }, [termCode, selectedSection]);

  const anyModalOpen = Boolean(
    (selectedClass && classMeetings.length > 0) || (selectedSlot && slotMeetings.length > 0),
  );
  React.useEffect(() => {
    if (!anyModalOpen) return;
    const html = document.documentElement;
    const main = document.querySelector("main");
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevMainOverflow = main instanceof HTMLElement ? main.style.overflow : "";
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    if (main instanceof HTMLElement) main.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      if (main instanceof HTMLElement) main.style.overflow = prevMainOverflow;
    };
  }, [anyModalOpen]);

  const loadError = analyticsQuery.error ?? facultyQuery.error ?? offeringsQuery.error;
  const canGenerate = analytics?.dataReadiness.canGenerate ?? false;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Heading and Generate action */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
            Dashboard
          </h1>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            {selectedTerm.label}
            {analytics && hasSchedule
              ? ` · showing ${analytics.candidateLabel} (${analytics.status.toLowerCase()})`
              : ""}
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button
            onClick={() => {
              setNotice(null);
              generate.mutate();
            }}
            disabled={generate.isPending || !canGenerate}
            className="bg-[#5a0e19] hover:bg-[#480a13] text-white shadow-xs font-semibold px-4 py-2 flex items-center gap-2 rounded-lg"
          >
            {generate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarCheck2 className="h-3.5 w-3.5" />
            )}
            <span>{generate.isPending ? "Generating…" : "Generate Schedule"}</span>
          </Button>
          {analytics && !canGenerate && (
            <span className="text-[11px] text-[var(--ordiq-muted)]">
              {analytics.dataReadiness.criticalCount} critical data gap(s) block generation.{" "}
              <Link
                href="/faculty"
                className="font-semibold text-[var(--ordiq-maroon)] hover:underline"
              >
                Review data
              </Link>
            </span>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs",
            notice.tone === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200",
          )}
        >
          <span>
            {notice.text}{" "}
            {notice.tone === "ok" && (
              <Link href="/schedules" className="font-semibold underline">
                Open Schedules
              </Link>
            )}
          </span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          Could not load dashboard data: {loadError.message}
        </div>
      )}

      <KpiRow analytics={analytics} hasSchedule={hasSchedule} loading={analyticsQuery.isPending} />

      <DataTabsCard
        activeTab={activeTab}
        onTabChange={setActiveTab}
        faculty={faculty}
        subjects={subjects}
        rooms={rooms}
        offerings={offerings}
        meetings={meetings}
        analytics={analytics}
        unscheduled={scheduleQuery.data?.unscheduled ?? []}
        hasSchedule={hasSchedule}
        loadingTabs={tabLoading}
        refreshing={dashboardRefreshing}
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 lg:gap-5">
        <WeeklyScheduleCard
          meetings={meetings}
          sections={sections}
          selectedSection={selectedSection}
          onSectionChange={setSelectedSection}
          onSelectClass={setSelectedClass}
          onSelectSlot={setSelectedSlot}
          hasSchedule={hasSchedule}
          loading={scheduleQuery.isFetching}
          initialLoading={scheduleLoading}
        />
        <AnalyticsCard analytics={analytics} hasSchedule={hasSchedule} />
      </div>

      {selectedSlot && slotMeetings.length > 0 && !selectedClass && (
        <SlotMeetingsModal
          slot={selectedSlot}
          meetings={slotMeetings}
          onSelectClass={setSelectedClass}
          onClose={() => setSelectedSlot(null)}
        />
      )}

      {selectedClass && classMeetings.length > 0 && (
        <ClassDetailsModal
          target={selectedClass}
          meetings={classMeetings}
          fromSlot={selectedSlot}
          onBack={() => setSelectedClass(null)}
          onClose={() => {
            setSelectedClass(null);
            setSelectedSlot(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  icon,
  value,
  suffix,
  tone = "default",
  title,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  suffix?: string;
  tone?: "default" | "alert";
  /** Formula, shown on hover. */
  title?: string;
}) {
  return (
    <Card
      className="border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs"
      title={title}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--ordiq-muted)]">{label}</span>
          {icon}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-2xl font-bold tracking-tight",
              tone === "alert" ? "text-red-600 dark:text-red-400" : "text-[var(--ordiq-ink)]",
            )}
          >
            {value}
          </span>
          {suffix && <span className="text-xs text-[var(--ordiq-muted)]">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiRow({
  analytics,
  hasSchedule,
  loading,
}: {
  analytics: AnalyticsDto | undefined;
  hasSchedule: boolean;
  loading: boolean;
}) {
  const m = analytics?.metrics;
  const empty = loading ? "…" : "—";
  const show = Boolean(m && hasSchedule);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
      <KpiCard
        label="Classes Scheduled"
        icon={<CalendarCheck2 className="h-4 w-4 text-[var(--ordiq-maroon)]" />}
        value={show && m ? String(m.classesScheduled) : empty}
        suffix={show && m ? `/ ${m.totalMeetings}` : undefined}
        title={analytics?.metricFormulas.classesScheduled}
      />
      <KpiCard
        label="Conflicts Detected"
        icon={
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              show && m && m.conflictsDetected > 0 ? "text-red-600" : "text-emerald-600",
            )}
          />
        }
        value={show && m ? String(m.conflictsDetected) : empty}
        tone={show && m && m.conflictsDetected > 0 ? "alert" : "default"}
        title={analytics?.metricFormulas.conflictsDetected}
      />
      <KpiCard
        label="Faculty Load Balance"
        icon={<Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
        value={
          show && m
            ? m.facultyLoadBalanceScore == null
              ? "—"
              : `${m.facultyLoadBalanceScore}`
            : empty
        }
        suffix={show && m?.facultyLoadBalanceScore != null ? "/ 100" : undefined}
        title={analytics?.metricFormulas.facultyLoadBalanceScore}
      />
      <KpiCard
        label="Room Utilization"
        icon={<Building2 className="h-4 w-4 text-[var(--ordiq-maroon)]" />}
        value={show && m ? `${m.roomUtilizationPct}%` : empty}
        title={analytics?.metricFormulas.roomUtilizationPct}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data tabs (read-only overview; editing happens in the dedicated pages)
// ---------------------------------------------------------------------------

interface TabRow {
  key: string;
  cells: React.ReactNode[];
  csv: Record<string, string | number>;
  search: string;
}

interface TabModel {
  headers: string[];
  rows: TabRow[];
  href: string;
  linkLabel: string;
  empty: string;
}

const LOAD_LABELS: Record<string, { text: string; className: string }> = {
  UNDERLOAD: {
    text: "Underload",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  OPTIMAL: {
    text: "Optimal",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  OVERLOAD: {
    text: "Overload",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  EXCEEDS_MAX: {
    text: "Exceeds max",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", className)}>
      {children}
    </span>
  );
}

function DataTabsCard(props: {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  faculty: FacultyDto[];
  subjects: SubjectDto[];
  rooms: RoomDto[];
  offerings: OfferingDto[];
  meetings: DashboardMeeting[];
  analytics: AnalyticsDto | undefined;
  unscheduled: Array<{ offeringCode: string; reasonCode: string }>;
  hasSchedule: boolean;
  loadingTabs: Record<WorkspaceTab, boolean>;
  refreshing: boolean;
}) {
  const {
    activeTab,
    onTabChange,
    faculty,
    subjects,
    rooms,
    offerings,
    meetings,
    analytics,
    unscheduled,
    hasSchedule,
  } = props;
  const tabLoading = props.loadingTabs[activeTab];
  const [search, setSearch] = React.useState("");

  const model = React.useMemo<TabModel>(() => {
    switch (activeTab) {
      case "faculty": {
        const loads = new Map((analytics?.facultyLoads ?? []).map((l) => [l.facultyCode, l]));
        return {
          headers: ["Code", "Name", "Employment", "Specialization", "Assigned / Max units", "Load"],
          href: "/faculty",
          linkLabel: "Manage faculty",
          empty: "No faculty records yet.",
          rows: faculty.map((f) => {
            const load = loads.get(f.code);
            const label = load && hasSchedule ? LOAD_LABELS[load.statusLabel] : undefined;
            return {
              key: f.code,
              search: `${f.code} ${f.name} ${f.specialization}`.toLowerCase(),
              cells: [
                <span key="c" className="font-mono">
                  {f.code}
                </span>,
                f.name,
                EMPLOYMENT_LABELS[f.employmentType] ?? f.employmentType,
                f.specialization || "—",
                hasSchedule && load
                  ? `${load.assignedUnits} / ${f.maxLoadUnits}`
                  : `— / ${f.maxLoadUnits}`,
                label ? (
                  <Pill key="l" className={label.className}>
                    {label.text}
                  </Pill>
                ) : (
                  "—"
                ),
              ],
              csv: {
                Code: f.code,
                Name: f.name,
                Employment: EMPLOYMENT_LABELS[f.employmentType] ?? f.employmentType,
                Specialization: f.specialization,
                "Assigned Units": hasSchedule && load ? load.assignedUnits : "",
                "Max Units": f.maxLoadUnits,
                Load: label?.text ?? "",
              },
            };
          }),
        };
      }
      case "courses": {
        const subjectByCode = new Map(subjects.map((s) => [s.code, s]));
        const placed = new Map<string, number>();
        for (const m of meetings) placed.set(m.offeringCode, (placed.get(m.offeringCode) ?? 0) + 1);
        const unplaced = new Set(unscheduled.map((u) => u.offeringCode));
        return {
          headers: ["Subject", "Title", "Section", "Component", "Meetings", "Room type", "Placed"],
          href: "/courses-sections",
          linkLabel: "Manage courses & sections",
          empty: "No offerings for this term yet.",
          rows: offerings.map((o) => {
            const subject = subjectByCode.get(o.subjectCode);
            const count = placed.get(o.code) ?? 0;
            const status = !hasSchedule ? (
              "—"
            ) : count >= o.meetingsPerWeek && !unplaced.has(o.code) ? (
              <Pill
                key="s"
                className={LOAD_LABELS.OPTIMAL?.className ?? ""}
              >{`${count}/${o.meetingsPerWeek}`}</Pill>
            ) : (
              <Pill
                key="s"
                className={LOAD_LABELS.EXCEEDS_MAX?.className ?? ""}
              >{`${count}/${o.meetingsPerWeek}`}</Pill>
            );
            return {
              key: o.code,
              search: `${o.subjectCode} ${subject?.name ?? ""} ${o.sectionCode}`.toLowerCase(),
              cells: [
                <span key="c" className="font-mono">
                  {o.subjectCode}
                </span>,
                subject?.name ?? "—",
                o.sectionCode,
                componentLabel(o.component),
                `${o.meetingsPerWeek} × ${formatDuration(o.minutesPerMeeting)}`,
                roomTypeLabel(o.requiredRoomType),
                status,
              ],
              csv: {
                Subject: o.subjectCode,
                Title: subject?.name ?? "",
                Section: o.sectionCode,
                Component: componentLabel(o.component),
                "Meetings per Week": o.meetingsPerWeek,
                "Minutes per Meeting": o.minutesPerMeeting,
                "Room Type": roomTypeLabel(o.requiredRoomType),
                Placed: hasSchedule ? count : "",
              },
            };
          }),
        };
      }
      case "rooms": {
        const util = new Map((analytics?.roomUtilizations ?? []).map((r) => [r.roomCode, r]));
        return {
          headers: ["Code", "Name", "Type", "Capacity", "Meetings", "Utilization", "Status"],
          href: "/rooms",
          linkLabel: "Manage rooms & labs",
          empty: "No rooms yet.",
          rows: rooms.map((r) => {
            const u = util.get(r.code);
            return {
              key: r.code,
              search: `${r.code} ${r.name} ${r.type}`.toLowerCase(),
              cells: [
                <span key="c" className="font-mono">
                  {r.code}
                </span>,
                r.name,
                roomTypeLabel(r.type),
                r.capacity,
                hasSchedule ? (u?.meetingCount ?? 0) : "—",
                hasSchedule ? `${u?.utilizationPct ?? 0}%` : "—",
                titleCase(r.status),
              ],
              csv: {
                Code: r.code,
                Name: r.name,
                Type: roomTypeLabel(r.type),
                Capacity: r.capacity,
                Meetings: hasSchedule ? (u?.meetingCount ?? 0) : "",
                "Utilization %": hasSchedule ? (u?.utilizationPct ?? 0) : "",
                Status: titleCase(r.status),
              },
            };
          }),
        };
      }
      case "schedule":
        return {
          headers: ["Subject", "Section", "Day", "Time", "Room", "Faculty", "Status"],
          href: "/schedules",
          linkLabel: "Open schedule workspace",
          empty: hasSchedule ? "This schedule has no entries." : "No schedule generated yet.",
          rows: meetings.map((m) => {
            const roomLabel = displayRoomLabel(m.roomCode);
            const facultyLabel = displayFacultyLabel(m.facultyCode, m.facultyName);
            return {
              key: m.id,
              search:
                `${m.subjectCode} ${m.subjectName} ${m.sectionCode} ${roomLabel} ${facultyLabel} ${m.weekday}`.toLowerCase(),
              cells: [
                <span key="c" className="font-mono">
                  {m.subjectCode}
                </span>,
                m.sectionCode,
                WEEKDAY_SHORT[m.weekday],
                formatTimeRange(m.startMin, m.endMin),
                roomLabel,
                facultyLabel,
                m.hasConflict ? (
                  <Pill key="s" className={LOAD_LABELS.EXCEEDS_MAX?.className ?? ""}>
                    Conflict
                  </Pill>
                ) : (
                  <Pill key="s" className={LOAD_LABELS.OPTIMAL?.className ?? ""}>
                    OK
                  </Pill>
                ),
              ],
              csv: {
                Subject: m.subjectCode,
                Title: m.subjectName,
                Section: m.sectionCode,
                Day: weekdayLabel(m.weekday),
                Start: formatClock(m.startMin),
                End: formatClock(m.endMin),
                Room: roomLabel,
                Faculty: facultyLabel,
                Status: m.hasConflict ? "Conflict" : "OK",
              },
            };
          }),
        };
    }
  }, [
    activeTab,
    faculty,
    subjects,
    rooms,
    offerings,
    meetings,
    analytics,
    unscheduled,
    hasSchedule,
  ]);

  const query = search.trim().toLowerCase();
  const rows = React.useMemo(() => {
    return query ? model.rows.filter((r) => r.search.includes(query)) : model.rows;
  }, [query, model.rows]);

  const { currentPage, setCurrentPage, pageSize, setPageSize, paginatedItems, totalItems } =
    usePagination(rows, 15);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, setCurrentPage]);

  const exportExcel = () => {
    const first = rows[0];
    if (!first) return;
    const headers = Object.keys(first.csv);
    return downloadExcelExport({
      fileName: `ordiq-${activeTab}.xlsx`,
      sheetName: activeTab,
      headers,
      rows: rows.map((r) => headers.map((key) => r.csv[key])),
    });
  };

  const tabs = [
    { id: "faculty", label: "Faculty Data", icon: Users, count: faculty.length },
    { id: "courses", label: "Courses & Sections", icon: BookOpen, count: offerings.length },
    { id: "rooms", label: "Rooms & Labs", icon: Building2, count: rooms.length },
    { id: "schedule", label: "Schedule", icon: CalendarDays, count: meetings.length },
  ] as const;

  return (
    <Card className="border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs overflow-hidden">
      <div className="p-2 sm:p-2.5 bg-[var(--ordiq-surface-muted)]/70">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 w-full" role="tablist">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  onTabChange(tab.id);
                  setSearch("");
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs transition-all cursor-pointer",
                  active
                    ? "bg-[var(--ordiq-surface)] text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)] font-bold shadow-xs ring-1 ring-[var(--ordiq-border)]"
                    : "text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface)]/60 font-medium",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
                <span className="ml-1 rounded-full border border-[var(--ordiq-border)]/40 px-2 py-0.5 text-[10px] font-bold">
                  {props.loadingTabs[tab.id] ? "…" : tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between p-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={model.href}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "font-semibold",
            })}
          >
            {model.linkLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={exportExcel}
            disabled={rows.length === 0}
            className="text-xs font-semibold"
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export Excel
          </Button>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ordiq-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this tab…"
            aria-label="Search this tab"
            className="h-8 w-full rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] pl-8 pr-3 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
          />
        </div>
      </div>

      <TableRefreshBar active={props.refreshing && !tabLoading} />
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full border-collapse text-xs whitespace-nowrap">
          <thead className="bg-[var(--ordiq-surface-muted)]">
            <tr className="text-[11px] font-semibold text-[var(--ordiq-muted)]">
              {model.headers.map((h, i) => (
                <th
                  key={h}
                  className={cn("px-3 py-2.5 font-bold", i === 0 ? "text-left" : "text-center")}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tabLoading ? (
              <TableSkeletonRows
                columns={model.headers.length}
                rows={skeletonRowCount(pageSize)}
                label={`Loading ${activeTab}`}
              />
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={model.headers.length}
                  className="px-3 py-8 text-center text-[var(--ordiq-muted)]"
                >
                  {query ? "No rows match your search." : model.empty}
                </td>
              </tr>
            ) : (
              paginatedItems.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-[var(--ordiq-border)]/50 hover:bg-[var(--ordiq-surface-muted)]/50"
                >
                  {row.cells.map((cell, i) => (
                    <td
                      key={model.headers[i] ?? i}
                      className={cn(
                        "px-3 py-2 text-[var(--ordiq-ink)]",
                        i === 0 ? "text-left" : "text-center",
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TablePagination
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[5, 10, 15, 20, 50]}
        itemLabel="records"
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Weekly schedule preview
// ---------------------------------------------------------------------------

function SubjectChip({ group, onSelect }: { group: CellSubjectGroup; onSelect: () => void }) {
  const first = group.representative;
  const title =
    group.meetings.length === 1
      ? `${group.subjectCode} · ${first.sectionCode || "—"} · ${formatTimeRange(first.startMin, first.endMin)}`
      : `${group.subjectCode} · ${group.meetings.length} schedules in this slot — click to view all`;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      className={cn(
        "block w-full truncate rounded-md border px-1.5 py-1 text-[11px] font-bold shadow-2xs transition hover:scale-[1.02] cursor-pointer",
        chipThemeFor(group.subjectCode),
        group.hasConflict && "ring-2 ring-red-500",
      )}
    >
      {group.subjectCode}
    </button>
  );
}

function WeeklyScheduleCard({
  meetings,
  sections,
  selectedSection,
  onSectionChange,
  onSelectClass,
  onSelectSlot,
  hasSchedule,
  loading,
  initialLoading,
}: {
  meetings: DashboardMeeting[];
  sections: SectionDto[];
  selectedSection: string;
  onSectionChange: (code: string) => void;
  onSelectClass: (target: ClassDetailsTarget) => void;
  onSelectSlot: (slot: WeeklySlot) => void;
  hasSchedule: boolean;
  loading: boolean;
  /** No schedule data yet: draw the empty week with placeholder classes. */
  initialLoading: boolean;
}) {
  const shown = filterMeetingsBySection(meetings, selectedSection);
  const days = visibleWeekdays(meetings);
  const { selectedTerm } = useShell();
  // Fixed rows for the term's teaching day; empty hours stay visible.
  const hours = hourRows(meetings, selectedTerm.dayStartMin, selectedTerm.dayEndMin);
  const [mobileDay, setMobileDay] = React.useState<WeekdayCode>("MONDAY");

  const cell = (day: WeekdayCode, hour: number) => meetingsForHourSlot(shown, day, hour);

  return (
    <Card className="xl:col-span-7 border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs flex flex-col h-full">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[var(--ordiq-maroon)]" />
          <CardTitle className="text-sm font-bold text-[var(--ordiq-ink)]">
            Weekly Schedule
          </CardTitle>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ordiq-muted)]" />}
        </div>
        <div className="relative">
          <select
            aria-label="Filter schedule by section"
            value={selectedSection}
            onChange={(e) => onSectionChange(e.target.value)}
            className="h-8 appearance-none rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] pl-3 pr-7 text-xs font-semibold text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
          >
            <option value="ALL">All sections</option>
            {sections.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} ({s.programCode} {s.yearLevel})
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-4 flex-1 flex flex-col min-h-0">
        {initialLoading ? (
          <WeekSkeleton hours={hours} days={days} />
        ) : !hasSchedule ? (
          <div className="py-10 text-center text-xs text-[var(--ordiq-muted)]">
            No schedule yet. Generate the optimal schedule to see the week here.
          </div>
        ) : (
          <>
            <div className="flex sm:hidden gap-1 pb-2 mb-3 overflow-x-auto">
              {days.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => setMobileDay(day)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-center text-xs font-bold",
                    mobileDay === day
                      ? "bg-[var(--ordiq-maroon)] text-white"
                      : "bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-muted)]",
                  )}
                >
                  {WEEKDAY_SHORT[day]}
                </button>
              ))}
            </div>

            <div className="hidden sm:flex sm:flex-col overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-xs">
                <thead className="sticky top-0 bg-[var(--ordiq-surface-muted)] shrink-0">
                  <tr className="text-[11px] font-semibold text-[var(--ordiq-muted)]">
                    <th className="w-16 px-2 py-1.5 text-left">Time</th>
                    {days.map((day) => (
                      <th key={day} className="px-1 py-1.5 font-bold text-center">
                        {WEEKDAY_SHORT[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hours.map((hour) => (
                    <tr key={hour} className="border-t border-[var(--ordiq-border)]/40">
                      <td className="px-2 py-1.5 text-left font-mono text-[11px] text-[var(--ordiq-muted)] whitespace-nowrap align-top">
                        {formatClock(hour * 60)}
                      </td>
                      {days.map((day) => {
                        const items = cell(day, hour);
                        const subjectGroups = groupCellSubjects(items);
                        const first = subjectGroups.slice(0, 2);
                        return (
                          <td key={day} className="p-1 align-top">
                            <div className="space-y-1">
                              {first.map((group) => (
                                <SubjectChip
                                  key={group.subjectCode}
                                  group={group}
                                  onSelect={() =>
                                    onSelectClass({
                                      subjectCode: group.subjectCode,
                                      slot: { day, hour },
                                    })
                                  }
                                />
                              ))}
                              {subjectGroups.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => onSelectSlot({ day, hour })}
                                  aria-label={`Show all ${subjectGroups.length} subjects (${items.length} classes) on ${weekdayLabel(day)} at ${formatClock(hour * 60)}`}
                                  className="block w-full cursor-pointer rounded px-0.5 text-left text-[10px] font-medium text-[var(--ordiq-muted)] transition-colors hover:text-[var(--ordiq-maroon)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ordiq-maroon)] dark:hover:text-[var(--ordiq-orange)]"
                                >
                                  +{subjectGroups.length - 2} more
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sm:hidden space-y-2">
              {shown.filter((m) => m.weekday === mobileDay).length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--ordiq-muted)]">
                  No classes on this day.
                </div>
              ) : (
                shown
                  .filter((m) => m.weekday === mobileDay)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        onSelectClass({
                          subjectCode: m.subjectCode,
                          slot: { day: m.weekday, hour: Math.floor(m.startMin / 60) },
                          highlightMeetingId: m.id,
                        })
                      }
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg border p-2.5 text-left",
                        chipThemeFor(m.subjectCode),
                        m.hasConflict && "ring-2 ring-red-500",
                      )}
                    >
                      <div>
                        <div className="text-sm font-bold">{m.subjectCode}</div>
                        <div className="text-[11px] opacity-80">
                          {displayRoomLabel(m.roomCode)} ·{" "}
                          {displayFacultyLabel(m.facultyCode, m.facultyName)} · {m.sectionCode}
                        </div>
                      </div>
                      <span className="font-mono text-[11px]">{formatClock(m.startMin)}</span>
                    </button>
                  ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Same rows and columns as the weekly grid, with pulsing class chips. */
function WeekSkeleton({ hours, days }: { hours: number[]; days: WeekdayCode[] }) {
  return (
    <div className="overflow-x-auto" role="status" aria-label="Loading the weekly schedule">
      <table className="w-full table-fixed border-collapse text-xs">
        <thead className="bg-[var(--ordiq-surface-muted)]">
          <tr className="text-[11px] font-semibold text-[var(--ordiq-muted)]">
            <th className="w-16 px-2 py-1.5 text-left">Time</th>
            {days.map((day) => (
              <th key={day} className="px-1 py-1.5 font-bold text-center">
                {WEEKDAY_SHORT[day]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hours.map((hour, r) => (
            <tr key={hour} className="border-t border-[var(--ordiq-border)]/40">
              <td className="px-2 py-1.5 font-mono text-[11px] text-[var(--ordiq-muted)] whitespace-nowrap align-top">
                {formatClock(hour * 60)}
              </td>
              {days.map((day, c) => (
                <td key={day} className="p-1 align-top">
                  {(r + c) % 3 !== 2 && <SkeletonBlock className="h-7 w-full rounded-md" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytics and top conflicts
// ---------------------------------------------------------------------------

function QualityRing({ score }: { score: number }) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <svg
        width="124"
        height="124"
        viewBox="0 0 120 120"
        className="rotate-[-90deg]"
        aria-hidden="true"
      >
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--ordiq-surface-muted)"
          strokeWidth="12"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#0d9488"
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] text-[var(--ordiq-muted)]">Quality</span>
        <span className="font-mono text-xl font-bold text-[var(--ordiq-ink)]">
          {Math.round(clamped)}
        </span>
        <span className="text-[9px] text-[var(--ordiq-muted)]">out of 100</span>
      </div>
    </div>
  );
}

function AnalyticsCard({
  analytics,
  hasSchedule,
}: {
  analytics: AnalyticsDto | undefined;
  hasSchedule: boolean;
}) {
  const m = analytics?.metrics;
  const allUnwaivedConflicts = React.useMemo(
    () => (analytics?.topConflicts ?? []).filter((c) => !c.waived),
    [analytics?.topConflicts],
  );
  const topConflicts = React.useMemo(
    () => allUnwaivedConflicts.slice(0, 5),
    [allUnwaivedConflicts],
  );
  const legend: Array<{ label: string; value: string; dot: string }> =
    m && hasSchedule
      ? [
          { label: "Meetings placed", value: `${m.scheduledPct}%`, dot: "bg-[#0d9488]" },
          { label: "Room utilization", value: `${m.roomUtilizationPct}%`, dot: "bg-[#b91c1c]" },
          {
            label: "Faculty load balance",
            value: m.facultyLoadBalanceScore == null ? "—" : `${m.facultyLoadBalanceScore}`,
            dot: "bg-amber-500",
          },
          {
            label: "Unmet preferences",
            value: String(m.unmetPreferencesCount),
            dot: "bg-slate-400",
          },
        ]
      : [];

  return (
    <Card
      id="analytics-conflicts-section"
      className="xl:col-span-5 border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs flex flex-col h-full"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-[var(--ordiq-ink)]">
            System Analytics
          </CardTitle>
          {analytics && hasSchedule && (
            <Badge variant="neutral" className="text-[10px]">
              {analytics.candidateLabel}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 flex flex-col flex-1 gap-4">
        {!m || !hasSchedule ? (
          <div className="py-6 text-center text-xs text-[var(--ordiq-muted)]">
            {analytics
              ? `Data readiness ${analytics.dataReadiness.overallScore}% · ${analytics.dataReadiness.criticalCount} critical, ${analytics.dataReadiness.warningCount} warning(s). Metrics appear after the first generation.`
              : "Loading analytics…"}
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6">
            <QualityRing score={m.qualityScore} />
            <div className="w-full flex-1 space-y-2 text-xs">
              {legend.map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", item.dot)} />
                    <span className="text-[var(--ordiq-muted)]">{item.label}</span>
                  </div>
                  <span className="font-mono font-bold text-[var(--ordiq-ink)]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2.5 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-bold tracking-tight text-[var(--ordiq-ink)]">
                Top Conflicts
              </h4>
              {allUnwaivedConflicts.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-100 dark:bg-red-950/80 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                  {allUnwaivedConflicts.length} Unresolved
                </span>
              )}
            </div>
            <Link
              href="/schedules"
              className="group inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)] hover:underline"
            >
              <span>View all</span>
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          {!hasSchedule ? (
            <div className="rounded-xl border border-dashed border-[var(--ordiq-border)] p-4 text-center text-xs text-[var(--ordiq-muted)]">
              No schedule to check yet.
            </div>
          ) : allUnwaivedConflicts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-8 text-center text-xs text-emerald-900 dark:text-emerald-200 space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shadow-2xs">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="font-bold text-sm">No Conflicts Detected</div>
              <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 max-w-xs">
                All required scheduling rules are satisfied with no unresolved conflicts.
              </div>
            </div>
          ) : (
            <div className="space-y-2 overflow-hidden no-scrollbar flex-1 flex flex-col justify-start">
              {topConflicts.map((c, i) => (
                <div
                  key={`${c.constraintId}-${i}`}
                  className={cn(
                    "rounded-xl border p-2.5 sm:p-3 text-xs space-y-1 transition-colors",
                    c.severity === "HARD"
                      ? "border-red-200/80 bg-red-50/40 hover:bg-red-50/70 hover:border-red-300 dark:border-red-900/40 dark:bg-red-950/20 dark:hover:bg-red-950/30"
                      : "border-amber-200/80 bg-amber-50/40 hover:bg-amber-50/70 hover:border-amber-300 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
                  )}
                >
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <AlertTriangle
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        c.severity === "HARD"
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[10px] font-semibold",
                        c.severity === "HARD"
                          ? "text-red-600 dark:text-red-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {HARD_CONSTRAINT_NAMES[c.constraintId] ??
                        (c.severity === "HARD" ? "Must-follow rule" : "Preference")}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--ordiq-ink)]/90 break-words font-medium">
                    {c.description ?? c.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {allUnwaivedConflicts.length > topConflicts.length && (
            <div className="flex items-center justify-between text-[10px] text-[var(--ordiq-muted)] pt-0.5">
              <span>
                Showing top {topConflicts.length} of {allUnwaivedConflicts.length} conflicts
              </span>
              <Link
                href="/schedules"
                className="font-semibold text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)] hover:underline"
              >
                Review in schedule &rarr;
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Slot overflow modal & class details
// ---------------------------------------------------------------------------

function ModalPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function SlotMeetingsModal({
  slot,
  meetings,
  onSelectClass,
  onClose,
}: {
  slot: WeeklySlot;
  meetings: DashboardMeeting[];
  onSelectClass: (target: ClassDetailsTarget) => void;
  onClose: () => void;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && dialog) {
        const controls = dialog.querySelectorAll<HTMLElement>("button:not(:disabled)");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  const subjectGroups = React.useMemo(() => groupCellSubjects(meetings), [meetings]);
  const hourStart = formatClock(slot.hour * 60);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center overscroll-none bg-black/45 backdrop-blur-xs p-3 sm:p-6"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="slot-modal-title"
          aria-describedby="slot-modal-description"
          tabIndex={-1}
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-2xl outline-none sm:max-h-[min(88dvh,44rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--ordiq-border)] px-5 py-5 sm:px-7">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]">
                <CalendarDays className="h-4 w-4" aria-hidden="true" /> Weekly schedule
              </p>
              <h2
                id="slot-modal-title"
                className="text-lg font-semibold tracking-tight text-[var(--ordiq-ink)] sm:text-xl"
              >
                {weekdayLabel(slot.day)}, {hourStart}
              </h2>
              <p id="slot-modal-description" className="mt-1.5 text-xs text-[var(--ordiq-muted)]">
                Select a subject to view its sections and room assignments.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close scheduled subjects"
              onClick={onClose}
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ordiq-maroon)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain ordiq-scrollbar px-5 py-4 sm:px-7">
            <div className="mb-3 flex items-center justify-between gap-3 text-[10px] text-[var(--ordiq-muted)]">
              <p className="font-semibold uppercase tracking-[0.14em]">Scheduled subjects</p>
              <p className="tabular-nums sm:text-xs">
                {subjectGroups.length} {subjectGroups.length === 1 ? "subject" : "subjects"}
              </p>
            </div>
            <div className="space-y-2">
              {subjectGroups.map((group) => {
                const single = group.meetings.length === 1 ? group.meetings[0] : null;
                const distinctTimes = Array.from(
                  new Set(group.meetings.map((m) => formatTimeRange(m.startMin, m.endMin))),
                );
                const sections = Array.from(new Set(group.meetings.map((m) => m.sectionCode)));
                const rooms = Array.from(
                  new Set(
                    group.meetings
                      .map((m) => displayRoomLabel(m.roomCode))
                      .filter((room) => room !== "Unassigned"),
                  ),
                );

                return (
                  <button
                    key={group.subjectCode}
                    type="button"
                    onClick={() =>
                      onSelectClass({
                        subjectCode: group.subjectCode,
                        slot,
                        ...(single ? { highlightMeetingId: single.id } : {}),
                      })
                    }
                    className={cn(
                      "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-4 py-3 text-left transition hover:border-[var(--ordiq-maroon)]/40 hover:bg-[var(--ordiq-surface-muted)]/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ordiq-maroon)]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span className="shrink-0 text-xs font-semibold text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]">
                          {group.subjectCode}
                        </span>
                        {group.subjectName && (
                          <span className="min-w-0 text-xs font-medium leading-relaxed text-[var(--ordiq-ink)]">
                            {group.subjectName}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--ordiq-muted)]">
                        <span className="inline-flex items-center gap-1.5 tabular-nums">
                          <Clock3 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {distinctTimes.join(", ")}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {sections.length === 1 ? sections[0] : `${sections.length} sections`}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          {rooms.length === 0
                            ? "Room unassigned"
                            : rooms.length === 1
                              ? rooms[0]
                              : `${rooms.length} rooms`}
                        </span>
                      </div>
                    </div>
                    {group.hasConflict && (
                      <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-red-700 dark:text-red-300">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        <span className="hidden sm:inline">Conflict</span>
                        <span className="sr-only sm:hidden">Conflict</span>
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ordiq-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--ordiq-ink)]" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex shrink-0 justify-end border-t border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/25 px-5 py-3 sm:px-7">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function ClassDetailsModal({
  target,
  meetings,
  fromSlot,
  onBack,
  onClose,
}: {
  target: ClassDetailsTarget;
  meetings: DashboardMeeting[];
  fromSlot: WeeklySlot | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab" && dialog) {
        const controls = dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  const timeSlots = React.useMemo(() => groupSubjectByTimeSlot(meetings), [meetings]);
  const subjectName = meetings.find((m) => m.subjectName)?.subjectName ?? "";
  const distinctComponents = Array.from(new Set(meetings.map((m) => m.component).filter(Boolean)));
  const componentDisplay =
    distinctComponents.length > 0
      ? distinctComponents.map((comp) => componentLabel(comp)).join(", ")
      : "";
  const hasConflict = meetings.some((m) => m.hasConflict);
  const sectionCount = new Set(meetings.map((m) => m.sectionCode)).size;
  const showFaculty = timeSlots.some((slot) =>
    slot.sections.some((section) => section.facultyLabel !== "Unassigned"),
  );

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center overscroll-none bg-black/45 backdrop-blur-xs p-3 sm:p-6"
        onClick={onClose}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="class-details-title"
          aria-describedby="class-details-summary"
          tabIndex={-1}
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-2xl outline-none sm:max-h-[min(88dvh,48rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="shrink-0 border-b border-[var(--ordiq-border)] px-5 py-5 sm:px-7 sm:py-6">
            {fromSlot && (
              <button
                type="button"
                onClick={onBack}
                className="mb-4 inline-flex cursor-pointer items-center gap-1.5 rounded text-xs font-medium text-[var(--ordiq-muted)] transition hover:text-[var(--ordiq-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ordiq-maroon)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>
                  {weekdayLabel(fromSlot.day)}, {formatClock(fromSlot.hour * 60)}
                </span>
              </button>
            )}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <BookOpen
                      className="h-4 w-4 shrink-0 text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]"
                      aria-hidden="true"
                    />
                    <span className="text-xs font-bold tracking-wide text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]">
                      {target.subjectCode}
                    </span>
                    {componentDisplay && (
                      <span className="rounded-md bg-[var(--ordiq-surface-muted)] px-2 py-0.5 text-[10px] font-medium text-[var(--ordiq-muted)]">
                        {componentDisplay}
                      </span>
                    )}
                  </div>
                  <h2
                    id="class-details-title"
                    className="text-lg font-semibold leading-snug tracking-tight text-[var(--ordiq-ink)] sm:text-xl"
                  >
                    {subjectName || target.subjectCode}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close schedule details"
                onClick={onClose}
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ordiq-maroon)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Time schedules grouped chronologically */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain ordiq-scrollbar px-5 py-5 sm:px-7">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ordiq-muted)]">
                Weekly meetings
              </p>
              <p
                id="class-details-summary"
                className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-[var(--ordiq-muted)] sm:text-xs"
              >
                {sectionCount} {sectionCount === 1 ? "section" : "sections"}
                <span className="mx-1.5" aria-hidden="true">
                  ·
                </span>
                {timeSlots.length} {timeSlots.length === 1 ? "time slot" : "time slots"}
              </p>
            </div>
            <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
              {timeSlots.map((slotGroup) => (
                <section
                  key={slotGroup.id}
                  aria-label={slotGroup.whenLabel}
                  className="min-w-0 overflow-hidden rounded-xl border border-[var(--ordiq-border)]"
                >
                  <div className="flex flex-col items-start gap-1.5 border-b border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/45 px-4 py-2.5">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-[var(--ordiq-ink)]">
                      <CalendarDays
                        className="h-3.5 w-3.5 shrink-0 text-[var(--ordiq-muted)]"
                        aria-hidden="true"
                      />
                      {slotGroup.daysLabel}
                    </h3>
                    <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-[var(--ordiq-ink)]">
                      <Clock3
                        className="h-3.5 w-3.5 shrink-0 text-[var(--ordiq-muted)]"
                        aria-hidden="true"
                      />
                      {slotGroup.timeLabel}
                    </span>
                  </div>
                  <table className="w-full table-fixed text-left text-xs">
                    <caption className="sr-only">
                      Sections and room assignments for {slotGroup.whenLabel}
                    </caption>
                    <thead>
                      <tr className="text-[10px] font-medium uppercase tracking-wider text-[var(--ordiq-muted)]">
                        <th
                          scope="col"
                          className={cn(
                            "px-4 pb-1 pt-2 font-medium",
                            showFaculty && slotGroup.hasConflict ? "w-[24%]" : "w-[32%]",
                          )}
                        >
                          Section
                        </th>
                        {slotGroup.hasConflict && (
                          <th
                            scope="col"
                            className={cn(
                              "px-1 pb-1 pt-2 text-center font-medium",
                              showFaculty ? "w-[24%]" : "w-[32%]",
                            )}
                          >
                            <span className="sr-only">Status</span>
                          </th>
                        )}
                        <th
                          scope="col"
                          className={cn("px-4 pb-1 pt-2 font-medium", !showFaculty && "text-right")}
                        >
                          Room
                        </th>
                        {showFaculty && (
                          <th
                            scope="col"
                            className={cn(
                              "px-4 pb-1 pt-2 text-right font-medium",
                              slotGroup.hasConflict ? "w-[32%]" : "w-2/5",
                            )}
                          >
                            Faculty
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ordiq-border)]/50">
                      {slotGroup.sections.map((sec) => {
                        return (
                          <tr
                            key={sec.id}
                            className={cn(
                              "text-[var(--ordiq-ink)]",
                              sec.hasConflict && "bg-red-50/80 dark:bg-red-950/30",
                            )}
                          >
                            <th scope="row" className="break-words px-4 py-2 font-semibold">
                              {sec.sectionCode}
                            </th>
                            {slotGroup.hasConflict && (
                              <td className="px-1 py-2 text-center align-middle">
                                {sec.hasConflict ? (
                                  <span className="inline-flex items-center justify-center gap-1 text-[10px] font-medium text-red-700 dark:text-red-300">
                                    <AlertTriangle
                                      className="h-3 w-3 shrink-0"
                                      aria-hidden="true"
                                    />{" "}
                                    Conflict
                                  </span>
                                ) : (
                                  <span className="sr-only">No conflict</span>
                                )}
                              </td>
                            )}
                            <td
                              className={cn(
                                "break-words px-4 py-2 text-[var(--ordiq-muted)]",
                                !showFaculty && "text-right",
                              )}
                            >
                              {sec.roomLabel}
                            </td>
                            {showFaculty && (
                              <td className="break-words px-4 py-2 text-right text-[var(--ordiq-muted)]">
                                {sec.facultyLabel}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/25 px-5 py-4 sm:px-7">
            {hasConflict && (
              <p
                role="note"
                className="mr-auto flex min-w-0 items-center gap-2 text-[11px] font-medium text-red-700 dark:text-red-300 sm:text-xs"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Schedule conflict requires review</span>
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              <Link href="/schedules" className={buttonVariants({ size: "sm" })}>
                Edit in Schedules
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
