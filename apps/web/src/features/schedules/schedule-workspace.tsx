"use client";

import {
  HARD_CONSTRAINT_CODES,
  NON_WAIVABLE_HARD_CONSTRAINTS,
  WEEKDAYS,
  type HardConstraintCode,
  type Weekday,
} from "@ordiq/contracts";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock,
  Columns,
  GitBranch,
  LayoutGrid,
  Lock,
  MapPin,
  Pin,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Table2,
  Unlock,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { useShell } from "@/features/shell/providers";
import {
  SkeletonBlock,
  skeletonRowCount,
  TableRefreshBar,
  TableSkeletonRows,
} from "@/components/ui/table-skeleton";
import {
  changeActionLabel,
  hardConstraintLabel,
  scheduleStatusLabel,
  solverStatusLabel,
  unscheduledReasonLabel,
  weekdayLabel,
} from "@/lib/display-labels";
import { chipThemeFor, formatClock } from "@/features/dashboard/dashboard-data";
import { cn } from "@/lib/utils";

interface ScheduleEntryDto {
  id: string;
  offeringCode: string;
  meetingIndex?: number;
  facultyCode: string;
  roomCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  pinned: boolean;
}

interface ViolationDto {
  code: HardConstraintCode;
  message: string;
  /** Plain-language sentence added by the schedules API. */
  description?: string;
  waivable: boolean;
  waived?: boolean;
  waiver_reason?: string | null;
  offering_codes?: string[];
  faculty_codes?: string[];
  room_codes?: string[];
  section_codes?: string[];
}

interface ScheduleDto {
  id: string;
  termCode: string;
  candidateLabel: string;
  profileName?: string;
  status: "CANDIDATE" | "ACCEPTED" | "ARCHIVED";
  source: "GENERATED" | "IMPORTED";
  solverStatus?: "PROVEN_OPTIMAL" | "BEST_FOUND" | "INFEASIBLE" | "CANCELLED";
  optimalityGapPct?: number;
  recheckNeeded: boolean;
  version: number;
  qualityScore: number | null;
  entries: ScheduleEntryDto[];
  unscheduled?: Array<{
    offeringCode: string;
    meetingIndex: number;
    reasonCode: string;
    reasonDetail: string;
  }>;
  exceptions?: Array<{
    id: string;
    code: HardConstraintCode;
    reason: string;
    approvedBy: string;
  }>;
  changes?: Array<{
    id: string;
    actor: string;
    action: string;
    createdAt: string;
  }>;
  validationReport?: {
    valid: boolean;
    hard_violation_count: number;
    waived_violation_count?: number;
    violations: ViolationDto[];
    quality: {
      quality_score: number;
      total_penalty: number;
      unmet_preferences?: Array<{
        code: string;
        description: string;
        penalty: number;
      }>;
    };
  } | null;
}

function formatMin(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDurationHours(startMin: number, endMin: number): string {
  const mins = Math.max(0, endMin - startMin);
  const hrs = mins / 60;
  return hrs % 1 === 0 ? `${hrs}h` : `${hrs.toFixed(1)}h`;
}

function formatTimeRangeClean(startMin: number, endMin: number): string {
  const sH24 = Math.floor(startMin / 60);
  const sM = startMin % 60;
  const sPeriod = sH24 >= 12 ? "PM" : "AM";
  const sH12 = sH24 % 12 === 0 ? 12 : sH24 % 12;

  const eH24 = Math.floor(endMin / 60);
  const eM = endMin % 60;
  const ePeriod = eH24 >= 12 ? "PM" : "AM";
  const eH12 = eH24 % 12 === 0 ? 12 : eH24 % 12;

  const sTime = `${sH12}:${String(sM).padStart(2, "0")}`;
  const eTime = `${eH12}:${String(eM).padStart(2, "0")}`;

  if (sPeriod === ePeriod) {
    return `${sTime} – ${eTime} ${ePeriod}`;
  }
  return `${sTime} ${sPeriod} – ${eTime} ${ePeriod}`;
}

function parseOfferingCode(
  code: string,
  termCode?: string,
): { subjectCode: string; sectionCode: string; component: string } {
  let cleaned = code;
  if (cleaned.startsWith("OFF-")) cleaned = cleaned.slice(4);
  if (termCode && cleaned.startsWith(`${termCode}-`)) {
    cleaned = cleaned.slice(termCode.length + 1);
  } else if (/^AY\d{4}-\d{4}-S\d-/.test(cleaned)) {
    cleaned = cleaned.replace(/^AY\d{4}-\d{4}-S\d-/, "");
  }
  const match = cleaned.match(/^([A-Za-z0-9]+-[A-Za-z0-9]+)-(.*)$/);
  if (match && match[1] && match[2]) {
    const subj = match[2];
    const comp = subj.endsWith("L") ? "LAB" : "LECTURE";
    return { sectionCode: match[1], subjectCode: subj, component: comp };
  }
  const lastHyphen = cleaned.lastIndexOf("-");
  if (lastHyphen > 0) {
    const sec = cleaned.slice(0, lastHyphen);
    const subj = cleaned.slice(lastHyphen + 1);
    if (sec && subj) {
      const comp = subj.endsWith("L") ? "LAB" : "LECTURE";
      return { sectionCode: sec, subjectCode: subj, component: comp };
    }
  }
  return { sectionCode: "", subjectCode: code, component: code.endsWith("L") ? "LAB" : "LECTURE" };
}

export function ScheduleWorkspace() {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;
  // The term the page currently shows; replies for an older term are ignored.
  const termRef = useRef(termCode);
  termRef.current = termCode;
  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "calendar" | "compare">(
    "grid",
  );
  const [filterText, setFilterText] = useState("");
  const [filterDay, setFilterDay] = useState<string>("ALL");
  const [filterSection, setFilterSection] = useState<string>("ALL");
  const [calendarLayout, setCalendarLayout] = useState<"columns" | "grid">("columns");
  const [offeringsMap, setOfferingsMap] = useState<
    Map<string, { subjectCode: string; sectionCode: string; component: string }>
  >(new Map());
  const [loading, setLoading] = useState(false);
  // Schedule list fetch, separate from action buttons; true until the first load.
  const [loadingSchedules, setLoadingSchedules] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [waiverCode, setWaiverCode] = useState<HardConstraintCode>("HC-04");
  const [waiverReason, setWaiverReason] = useState("");
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [showUndoModal, setShowUndoModal] = useState(false);

  async function refreshSchedules(term: string = termRef.current) {
    setLoading(true);
    setLoadingSchedules(true);
    try {
      const [schedulesResp, offeringsResp] = await Promise.all([
        fetch(`/api/v1/schedules?termCode=${encodeURIComponent(term)}`),
        fetch(`/api/v1/offerings?termCode=${encodeURIComponent(term)}`).catch(() => null),
      ]);
      if (term !== termRef.current) return; // the Dean switched term meanwhile
      if (offeringsResp && offeringsResp.ok) {
        const offData = (await offeringsResp.json()) as {
          items?: Array<{ code: string; subjectCode: string; sectionCode: string; component: string }>;
        };
        const map = new Map<string, { subjectCode: string; sectionCode: string; component: string }>();
        for (const item of offData.items ?? []) {
          map.set(item.code, {
            subjectCode: item.subjectCode,
            sectionCode: item.sectionCode,
            component: item.component,
          });
        }
        setOfferingsMap(map);
      }
      if (schedulesResp.ok) {
        const data = (await schedulesResp.json()) as { schedules: ScheduleDto[] };
        const list = data.schedules ?? [];
        setSchedules(list);
        // Keep the open schedule if it is still there; otherwise open the
        // term's accepted schedule, else its first candidate.
        setActiveId((current) =>
          list.some((x) => x.id === current)
            ? current
            : ((list.find((x) => x.status === "ACCEPTED") ?? list[0])?.id ?? ""),
        );
      }
    } finally {
      if (term === termRef.current) {
        setLoading(false);
        setLoadingSchedules(false);
      }
    }
  }

  // Reload whenever the term selector at the top changes.
  useEffect(() => {
    setSchedules([]);
    setActiveId("");
    setStatusMessage(null);
    setFilterText("");
    setFilterDay("ALL");
    setFilterSection("ALL");
    void refreshSchedules(termCode);
  }, [termCode]);

  const activeSchedule =
    schedules.find((s) => s.id === activeId) ?? schedules[0] ?? null;
  // First load shows placeholder rows; later reloads show a thin bar instead.
  const initialLoading = loadingSchedules && schedules.length === 0;

  async function handleGenerateCandidates() {
    setLoading(true);
    setStatusMessage(`Generating 3 candidate profiles for ${selectedTerm.label}...`);
    try {
      const resp = await fetch("/api/v1/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          termCode,
          profiles: ["BALANCED", "FACULTY_FIRST", "STUDENT_FIRST"],
          timeLimitSeconds: 8,
        }),
      });
      if (resp.ok) {
        await refreshSchedules();
        setStatusMessage("Generated 3 validated candidate schedules.");
      } else {
        const err = (await resp.json()) as { error?: { message?: string } };
        setStatusMessage(err.error?.message ?? "Generation failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckConflicts() {
    if (!activeSchedule) return;
    setLoading(true);
    try {
      const resp = await fetch("/api/v1/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_schedule",
          scheduleId: activeSchedule.id,
        }),
      });
      if (resp.ok) {
        await refreshSchedules();
        setStatusMessage("Independent validator check completed.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePin(entry: ScheduleEntryDto) {
    if (!activeSchedule) return;
    const resp = await fetch("/api/v1/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "edit_entry",
        scheduleId: activeSchedule.id,
        entryId: entry.id,
        expectedVersion: activeSchedule.version,
        pinned: !entry.pinned,
      }),
    });
    if (resp.ok) {
      await refreshSchedules();
    } else {
      const err = (await resp.json()) as { error?: { message?: string } };
      setStatusMessage(err.error?.message ?? "Edit rejected.");
    }
  }

  async function handleUndo() {
    if (!activeSchedule) return;
    const resp = await fetch("/api/v1/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "undo",
        scheduleId: activeSchedule.id,
      }),
    });
    if (resp.ok) {
      await refreshSchedules();
      setStatusMessage("Last change undone and re-validated.");
    }
  }

  async function handleAddException() {
    if (!activeSchedule || !waiverReason.trim()) return;
    const resp = await fetch("/api/v1/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_exception",
        scheduleId: activeSchedule.id,
        code: waiverCode,
        reason: waiverReason,
      }),
    });
    if (resp.ok) {
      setWaiverReason("");
      await refreshSchedules();
      setStatusMessage(`Documented waiver recorded for ${waiverCode}.`);
    } else {
      const err = (await resp.json()) as { error?: { message?: string } };
      setStatusMessage(err.error?.message ?? "Could not add waiver.");
    }
  }

  async function handleAccept() {
    if (!activeSchedule) return;
    const resp = await fetch("/api/v1/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "accept",
        scheduleId: activeSchedule.id,
      }),
    });
    if (resp.ok) {
      await refreshSchedules();
      setStatusMessage("Candidate accepted for portal encoding.");
    } else {
      const err = (await resp.json()) as { error?: { message?: string } };
      setStatusMessage(err.error?.message ?? "Accept blocked by validator.");
    }
  }

  async function handleStartRevision() {
    if (!activeSchedule) return;
    const resp = await fetch("/api/v1/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_revision",
        scheduleId: activeSchedule.id,
      }),
    });
    if (resp.ok) {
      await refreshSchedules();
      setStatusMessage("Started new candidate revision from accepted schedule.");
    }
  }

  const getOfferingInfo = (offeringCode: string) => {
    const found = offeringsMap.get(offeringCode);
    if (found) return found;
    return parseOfferingCode(offeringCode, termCode);
  };

  const availableSections = useMemo(() => {
    const set = new Set<string>();
    for (const e of activeSchedule?.entries ?? []) {
      const info = getOfferingInfo(e.offeringCode);
      if (info.sectionCode) set.add(info.sectionCode);
    }
    return Array.from(set).sort();
  }, [activeSchedule?.entries, offeringsMap, termCode]);

  const conflictedOfferingCodes = useMemo(() => {
    const set = new Set<string>();
    for (const v of activeSchedule?.validationReport?.violations ?? []) {
      if (v.waived) continue;
      for (const code of v.offering_codes ?? []) set.add(code);
    }
    return set;
  }, [activeSchedule?.validationReport?.violations]);

  const filteredEntries = (activeSchedule?.entries ?? []).filter((e) => {
    const matchesDay = filterDay === "ALL" || e.weekday === filterDay;
    const info = getOfferingInfo(e.offeringCode);
    const matchesSection = filterSection === "ALL" || info.sectionCode === filterSection;
    const q = filterText.trim().toLowerCase();
    const matchesText =
      !q ||
      e.offeringCode.toLowerCase().includes(q) ||
      info.subjectCode.toLowerCase().includes(q) ||
      info.sectionCode.toLowerCase().includes(q) ||
      e.facultyCode.toLowerCase().includes(q) ||
      e.roomCode.toLowerCase().includes(q);
    return matchesDay && matchesSection && matchesText;
  });

  const entriesPagination = usePagination(filteredEntries, 15);
  const schedulesPagination = usePagination(schedules, 5);

  const startHour = Math.floor((selectedTerm.dayStartMin ?? 7 * 60 + 30) / 60);
  const endHour = Math.ceil((selectedTerm.dayEndMin ?? 20 * 60 + 30) / 60);
  const hourSlots = Array.from(
    { length: Math.max(1, endHour - startHour) },
    (_, i) => startHour + i,
  );
  const activeWeekdays =
    filterDay === "ALL" ? WEEKDAYS : WEEKDAYS.filter((d) => d === filterDay);

  return (
    <div className="space-y-6">
      {/* Candidate Disclaimer Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-[var(--ordiq-ink)]">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>CANDIDATE DECISION-SUPPORT NOTICE:</strong> Schedules inside
            ORDIQ are candidate proposals for the Dean&apos;s review and are{" "}
            <u>not official and not for release</u> until encoded in the
            university portal.
          </span>
        </div>
        {statusMessage && (
          <Badge variant="neutral" className="border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)]">
            {statusMessage}
          </Badge>
        )}
      </div>

      {/* Page Header & Action Bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
            Schedule Workspace & Candidate Comparison
          </h1>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            Spreadsheet grid, weekly timetable, instant conflict validation,
            optimistic locking, and documented waivers.
          </p>
        </div>

        {/* Action buttons (Clean, formal, dashboard consistent) */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleGenerateCandidates()}
            disabled={loading}
            className="h-8 border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)] hover:text-[var(--ordiq-maroon)]"
          >
            <Sparkles className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
            <span>Generate (CP-SAT)</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCheckConflicts()}
            disabled={!activeSchedule || loading}
            className="h-8 border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)]"
          >
            <Play className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
            <span>Check Schedule</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUndoModal(true)}
            disabled={!activeSchedule || loading}
            className="h-8 border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)]"
          >
            <RotateCcw className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
            <span>Undo Edit</span>
          </Button>
          {activeSchedule?.status === "CANDIDATE" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAcceptModal(true)}
              disabled={loading}
              className="h-8 border-emerald-600/60 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span>Accept Candidate</span>
            </Button>
          )}
          {activeSchedule?.status === "ACCEPTED" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRevisionModal(true)}
              disabled={loading}
              className="h-8 border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)] hover:text-[var(--ordiq-maroon)]"
            >
              <GitBranch className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              <span>Start Revision</span>
            </Button>
          )}
        </div>
      </div>

      {/* Candidate Selector & View Switcher Bar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-3">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
            Schedule:
          </span>
          <select
            aria-label="Select candidate schedule"
            title={
              activeSchedule
                ? `${activeSchedule.candidateLabel} · ${scheduleStatusLabel(activeSchedule.status)} (version ${activeSchedule.version}${
                    activeSchedule.qualityScore !== null ? ` • Score ${activeSchedule.qualityScore}` : ""
                  })`
                : undefined
            }
            value={activeSchedule?.id ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="h-8 min-w-0 max-w-[240px] sm:max-w-[280px] md:max-w-[340px] lg:max-w-[380px] xl:max-w-[440px] 2xl:max-w-[500px] truncate rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 sm:px-3 text-xs font-medium text-[var(--ordiq-ink)] focus:outline-none"
          >
            {schedules.length === 0 && (
              <option value="">
                {initialLoading ? "Loading schedules…" : "No schedules yet — generate candidates first"}
              </option>
            )}
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.candidateLabel} · {scheduleStatusLabel(s.status)} (version {s.version}
                {s.qualityScore !== null ? ` • Score ${s.qualityScore}` : ""})
              </option>
            ))}
          </select>
          {activeSchedule?.recheckNeeded && (
            <Badge variant="warning" className="shrink-0 whitespace-nowrap">
              Recheck Needed
            </Badge>
          )}
        </div>

        {/* View Switchers */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1 sm:gap-1.5 shrink-0">
          <Button
            size="sm"
            variant={viewMode === "grid" ? "default" : "outline"}
            onClick={() => setViewMode("grid")}
            className="h-8 px-2.5 sm:px-3 text-xs font-semibold whitespace-nowrap"
          >
            <Table2 className="mr-1.5 h-3.5 w-3.5" />
            Spreadsheet Grid
          </Button>
          <Button
            size="sm"
            variant={viewMode === "calendar" ? "default" : "outline"}
            onClick={() => setViewMode("calendar")}
            className="h-8 px-2.5 sm:px-3 text-xs font-semibold whitespace-nowrap"
          >
            <Calendar className="mr-1.5 h-3.5 w-3.5" />
            Weekly Timetable
          </Button>
          <Button
            size="sm"
            variant={viewMode === "compare" ? "default" : "outline"}
            onClick={() => setViewMode("compare")}
            className="h-8 px-2.5 sm:px-3 text-xs font-semibold whitespace-nowrap"
          >
            <span className="hidden sm:inline xl:hidden">Compare ({schedules.length})</span>
            <span className="sm:hidden xl:inline">Compare Candidates ({schedules.length})</span>
          </Button>
        </div>
      </div>

      {/* Main View Area */}
      <TableRefreshBar active={loadingSchedules && !initialLoading} className="rounded-full" />
      {viewMode === "compare" ? (
        <Card>
          <CardHeader>
            <CardTitle>Side-by-Side Candidate Comparison (D-19)</CardTitle>
            <CardDescription>
              Compare conflicts, waived rules, unscheduled meetings, and quality
              scores across profiles.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-[var(--ordiq-surface-muted)] text-[11px] uppercase tracking-wider text-[var(--ordiq-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Candidate</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Status</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Solver Status</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Quality Score</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Hard Violations</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Waived Exceptions</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Unscheduled</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Meetings Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {initialLoading && (
                    <TableSkeletonRows columns={8} rows={4} label="Loading candidate schedules" />
                  )}
                  {schedulesPagination.paginatedItems.map((s) => (
                    <tr key={s.id} className="hover:bg-[var(--ordiq-surface-muted)]/60">
                      <td className="px-3 py-2 font-medium text-left">
                        {s.candidateLabel}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant={s.status === "ACCEPTED" ? "success" : "neutral"}>
                          {scheduleStatusLabel(s.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {solverStatusLabel(s.solverStatus)}
                      </td>
                      <td className="px-3 py-2 font-semibold text-center">
                        {s.qualityScore ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.validationReport?.hard_violation_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.validationReport?.waived_violation_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.unscheduled?.length ?? 0}
                      </td>
                      <td className="px-3 py-2 text-center">{s.entries.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedules.length > 5 && (
              <TablePagination
                currentPage={schedulesPagination.currentPage}
                pageSize={schedulesPagination.pageSize}
                totalItems={schedulesPagination.totalItems}
                onPageChange={schedulesPagination.setCurrentPage}
                onPageSizeChange={schedulesPagination.setPageSize}
                pageSizeOptions={[5, 10, 20]}
                itemLabel="candidates"
              />
            )}
          </CardContent>
        </Card>
      ) : viewMode === "calendar" ? (
        <Card className="border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs">
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[var(--ordiq-maroon)]" />
                <CardTitle className="text-base font-bold text-[var(--ordiq-ink)]">
                  Weekly Timetable View
                </CardTitle>
                <span className="rounded-full bg-[var(--ordiq-surface-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ordiq-muted)]">
                  {filteredEntries.length} {filteredEntries.length === 1 ? "meeting" : "meetings"}
                </span>
              </div>
              <CardDescription className="text-xs text-[var(--ordiq-muted)] mt-0.5">
                Organized weekly schedule by teaching day and time slot with section and faculty assignments.
              </CardDescription>
            </div>

            {/* Timetable Toolbar */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Search */}
              <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
                <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)] shrink-0" />
                <input
                  type="search"
                  placeholder="Search subject, section, faculty..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="w-40 sm:w-48 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
                />
              </div>

              {/* Section Filter */}
              {availableSections.length > 0 && (
                <select
                  aria-label="Filter by section"
                  value={filterSection}
                  onChange={(e) => setFilterSection(e.target.value)}
                  className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none"
                >
                  <option value="ALL">All Sections</option>
                  {availableSections.map((sec) => (
                    <option key={sec} value={sec}>
                      Section {sec}
                    </option>
                  ))}
                </select>
              )}

              {/* Weekday Filter */}
              <select
                aria-label="Filter by weekday"
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none"
              >
                <option value="ALL">All Weekdays</option>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {weekdayLabel(d)}
                  </option>
                ))}
              </select>

              {/* Layout Switcher: Columns vs Grid */}
              <div className="flex items-center rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-0.5">
                <button
                  type="button"
                  onClick={() => setCalendarLayout("columns")}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-all",
                    calendarLayout === "columns"
                      ? "bg-[var(--ordiq-surface)] text-[var(--ordiq-maroon)] shadow-2xs dark:text-rose-300"
                      : "text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)]",
                  )}
                  title="Day Column Cards"
                >
                  <Columns className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Days</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarLayout("grid")}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold transition-all",
                    calendarLayout === "grid"
                      ? "bg-[var(--ordiq-surface)] text-[var(--ordiq-maroon)] shadow-2xs dark:text-rose-300"
                      : "text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)]",
                  )}
                  title="Hourly Schedule Grid"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Time Grid</span>
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {calendarLayout === "columns" ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 xl:gap-3">
                {activeWeekdays.map((day) => {
                  const dayEntries = filteredEntries
                    .filter((e) => e.weekday === day)
                    .sort((a, b) => a.startMin - b.startMin);
                  const totalDayMinutes = dayEntries.reduce(
                    (acc, e) => acc + (e.endMin - e.startMin),
                    0,
                  );
                  return (
                    <div
                      key={day}
                      className="flex flex-col rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/30 p-2 sm:p-2.5 shadow-2xs"
                    >
                      {/* Day Column Header */}
                      <div className="flex items-center justify-between pb-1.5 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--ordiq-ink)]">
                          {weekdayLabel(day)}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-bold",
                            dayEntries.length > 0
                              ? "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-maroon)]/30 dark:text-rose-300"
                              : "bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-muted)]",
                          )}
                        >
                          {dayEntries.length} {dayEntries.length === 1 ? "class" : "classes"}
                        </span>
                      </div>

                      {/* Day Classes List - full height, no scrollbar */}
                      <div className="space-y-2 flex-1">
                        {dayEntries.map((e) => {
                          const info = getOfferingInfo(e.offeringCode);
                          const hasConflict = conflictedOfferingCodes.has(e.offeringCode);
                          return (
                            <div
                              key={e.id}
                              className={cn(
                                "group relative rounded-xl border p-2 sm:p-2.5 transition-all shadow-xs hover:shadow-md",
                                chipThemeFor(info.subjectCode),
                                hasConflict && "ring-2 ring-red-500",
                              )}
                            >
                              {/* Subject + Section + Lab/Pin */}
                              <div className="flex items-center justify-between gap-1 mb-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-xs font-bold tracking-tight truncate">
                                    {info.subjectCode}
                                  </span>
                                  {info.component === "LAB" && (
                                    <span className="rounded bg-amber-200/80 px-1 py-0.2 text-[9px] font-bold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 uppercase shrink-0">
                                      LAB
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {info.sectionCode && (
                                    <span className="rounded-md border border-current/20 bg-white/70 px-1.5 py-0.5 text-[10px] font-bold dark:bg-black/30">
                                      {info.sectionCode}
                                    </span>
                                  )}
                                  {e.pinned && (
                                    <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                  )}
                                </div>
                              </div>

                              {/* Time Window (Single Row, Responsive, No Wrap) */}
                              <div className="flex items-center justify-between gap-1 text-[11px] font-medium opacity-90 whitespace-nowrap mb-1.5">
                                <div className="flex items-center gap-1 min-w-0">
                                  <Clock className="h-3 w-3 shrink-0 opacity-60" />
                                  <span className="font-mono">{formatTimeRangeClean(e.startMin, e.endMin)}</span>
                                </div>
                                <span className="text-[10px] opacity-70 font-normal shrink-0 font-sans">
                                  {formatDurationHours(e.startMin, e.endMin)}
                                </span>
                              </div>

                              {/* Faculty & Room (Responsively in a row on wider/large screens, wrapped cleanly if space is tight) */}
                              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10.5px] xl:text-[11px]">
                                <div
                                  className="flex items-center gap-1 font-medium opacity-85 whitespace-nowrap"
                                  title={`Faculty: ${e.facultyCode}`}
                                >
                                  <User className="h-3 w-3 shrink-0 opacity-60" />
                                  <span>{e.facultyCode}</span>
                                </div>
                                <div
                                  className="flex items-center gap-1 font-semibold opacity-90 whitespace-nowrap shrink-0"
                                  title={`Room: ${e.roomCode}`}
                                >
                                  <MapPin className="h-3 w-3 shrink-0 text-[var(--ordiq-maroon)] dark:text-rose-400" />
                                  <span>{e.roomCode}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {initialLoading &&
                          [0, 1, 2].map((i) => (
                            <div
                              key={i}
                              className="space-y-1.5 rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-2.5"
                            >
                              <SkeletonBlock className="h-3 w-3/4" />
                              <SkeletonBlock className="h-2.5 w-1/2" />
                              <SkeletonBlock className="h-2.5 w-2/3" />
                            </div>
                          ))}

                        {!initialLoading && dayEntries.length === 0 && (
                          <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-[var(--ordiq-muted)]">
                            <div className="mb-2 rounded-full bg-[var(--ordiq-surface-muted)] p-2.5 text-[var(--ordiq-muted)]/50">
                              <CalendarDays className="h-5 w-5" />
                            </div>
                            <span className="font-medium">No classes scheduled</span>
                            <span className="text-[10px] text-[var(--ordiq-muted)]/70 mt-0.5">Day is open</span>
                          </div>
                        )}
                      </div>

                      {/* Day Load Summary (No line separator) */}
                      {dayEntries.length > 0 && (
                        <div className="mt-2.5 flex items-center justify-between text-[10px] text-[var(--ordiq-muted)]">
                          <span>Total Day Load</span>
                          <span className="font-mono font-semibold text-[var(--ordiq-ink)]">
                            {(totalDayMinutes / 60).toFixed(1)} hrs
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Time Grid View */
              <div className="overflow-x-auto no-scrollbar rounded-xl border border-[var(--ordiq-border)]">
                <table className="w-full min-w-[850px] border-collapse text-xs table-fixed">
                  <thead className="bg-[var(--ordiq-surface-muted)] sticky top-0 z-10">
                    <tr className="border-b border-[var(--ordiq-border)] text-[11px] font-semibold text-[var(--ordiq-muted)] uppercase tracking-wider">
                      <th className="w-20 px-3 py-2.5 text-left font-bold">Time</th>
                      {activeWeekdays.map((day) => (
                        <th key={day} className="px-2 py-2.5 text-center font-bold">
                          {weekdayLabel(day)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hourSlots.map((hour) => (
                      <tr key={hour} className="border-b border-[var(--ordiq-border)]/50 hover:bg-[var(--ordiq-surface-muted)]/20 transition-colors">
                        <td className="px-3 py-2 text-left font-mono text-[11px] text-[var(--ordiq-muted)] font-semibold align-top whitespace-nowrap bg-[var(--ordiq-surface-muted)]/10">
                          {formatClock(hour * 60)}
                        </td>
                        {activeWeekdays.map((day) => {
                          const slotEntries = filteredEntries.filter(
                            (e) => e.weekday === day && Math.floor(e.startMin / 60) === hour,
                          );
                          return (
                            <td key={day} className="p-1.5 align-top border-l border-[var(--ordiq-border)]/30 min-h-[56px]">
                              <div className="space-y-1.5">
                                {slotEntries.map((e) => {
                                  const info = getOfferingInfo(e.offeringCode);
                                  const hasConflict = conflictedOfferingCodes.has(e.offeringCode);
                                  return (
                                    <div
                                      key={e.id}
                                      className={cn(
                                        "rounded-lg border p-1.5 text-left transition-all shadow-2xs hover:shadow-xs",
                                        chipThemeFor(info.subjectCode),
                                        hasConflict && "ring-1.5 ring-red-500",
                                      )}
                                    >
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="font-bold text-xs truncate">
                                          {info.subjectCode}
                                        </span>
                                        {info.sectionCode && (
                                          <span className="rounded bg-white/70 px-1 py-0.2 text-[9px] font-bold dark:bg-black/40">
                                            {info.sectionCode}
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-0.5 text-[10px] font-mono opacity-80 flex items-center justify-between gap-1 whitespace-nowrap">
                                        <span>{formatTimeRangeClean(e.startMin, e.endMin)}</span>
                                        <span className="text-[9px] opacity-70 font-sans">{formatDurationHours(e.startMin, e.endMin)}</span>
                                      </div>
                                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-1.5 gap-y-0.5 text-[10px] opacity-80">
                                        <div
                                          className="flex items-center gap-1 font-medium whitespace-nowrap"
                                          title={`Faculty: ${e.facultyCode}`}
                                        >
                                          <User className="h-2.5 w-2.5 shrink-0 opacity-60" />
                                          <span>{e.facultyCode}</span>
                                        </div>
                                        <div
                                          className="flex items-center gap-1 font-semibold whitespace-nowrap shrink-0"
                                          title={`Room: ${e.roomCode}`}
                                        >
                                          <MapPin className="h-2.5 w-2.5 shrink-0 text-[var(--ordiq-maroon)] dark:text-rose-400" />
                                          <span>{e.roomCode}</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>
                Spreadsheet Schedule Grid ({filteredEntries.length} meetings)
              </CardTitle>
              <CardDescription>
                Version v{activeSchedule?.version ?? 1} • Pin/unpin meetings or
                inspect validation status in real time.
              </CardDescription>
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
              <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
                <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
                <input
                  type="search"
                  placeholder="Search offering, faculty, room..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="w-48 sm:w-56 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
                />
              </div>
              <select
                aria-label="Filter by weekday"
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none"
              >
                <option value="ALL">All Weekdays</option>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {weekdayLabel(d)}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-[var(--ordiq-surface-muted)] text-[11px] uppercase tracking-wider text-[var(--ordiq-muted)]">
                  <tr>
                    <th className="px-3 py-2 text-left whitespace-nowrap">Offering</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Faculty</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Room</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Weekday</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Time Slot</th>
                    <th className="px-3 py-2 text-center whitespace-nowrap">Lock / Pin</th>
                  </tr>
                </thead>
                <tbody>
                  {entriesPagination.paginatedItems.map((e) => (
                    <tr key={e.id} className="hover:bg-[var(--ordiq-surface-muted)]/60">
                      <td className="px-3 py-2 font-medium text-[var(--ordiq-ink)] text-left">
                        {e.offeringCode}
                      </td>
                      <td className="px-3 py-2 text-center">{e.facultyCode}</td>
                      <td className="px-3 py-2 text-center">{e.roomCode}</td>
                      <td className="px-3 py-2 text-center">{weekdayLabel(e.weekday)}</td>
                      <td className="px-3 py-2 text-center font-mono">
                        {formatMin(e.startMin)} – {formatMin(e.endMin)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleTogglePin(e)}
                        >
                          {e.pinned ? (
                            <>
                              <Lock className="mr-1 h-3.5 w-3.5 text-amber-600" />
                              Pinned
                            </>
                          ) : (
                            <>
                              <Unlock className="mr-1 h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
                              Pin
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {initialLoading && (
                    <TableSkeletonRows
                      columns={6}
                      rows={skeletonRowCount(entriesPagination.pageSize)}
                      label="Loading schedule entries"
                    />
                  )}
                  {!initialLoading && filteredEntries.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-xs text-[var(--ordiq-muted)]"
                      >
                        No schedule entries loaded. Use &ldquo;Generate 3
                        Candidates (CP-SAT)&rdquo; above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination
              currentPage={entriesPagination.currentPage}
              pageSize={entriesPagination.pageSize}
              totalItems={entriesPagination.totalItems}
              onPageChange={entriesPagination.setCurrentPage}
              onPageSizeChange={entriesPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20, 50]}
              itemLabel="meetings"
            />
          </CardContent>
        </Card>
      )}

      {/* Violations, Documented Exceptions (D-18), and Unscheduled Diagnostics */}
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Validation & Documented Exceptions (D-18)
            </CardTitle>
            <CardDescription>
              Double-booking (HC-01 to HC-03) is never waivable. All other rules
              require a documented reason.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Select waivable rule code"
                value={waiverCode}
                onChange={(e) =>
                  setWaiverCode(e.target.value as HardConstraintCode)
                }
                className="rounded border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 py-1.5 text-xs text-[var(--ordiq-ink)] focus:outline-none"
              >
                {HARD_CONSTRAINT_CODES.filter(
                  (c) => !NON_WAIVABLE_HARD_CONSTRAINTS.includes(c),
                ).map((c) => (
                  <option key={c} value={c}>
                    {hardConstraintLabel(c)}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Documented exception reason (required)..."
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                className="flex-1 rounded border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 py-1.5 text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleAddException()}
                disabled={!activeSchedule || waiverReason.trim().length < 5}
              >
                Add Waiver
              </Button>
            </div>

            <div className="space-y-2">
              {(activeSchedule?.validationReport?.violations ?? []).map(
                (v, i) => (
                  <div
                    key={`${v.code}-${i}`}
                    className={`rounded-md border p-2.5 text-xs ${
                      v.waived
                        ? "border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-muted)]"
                        : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>
                        {hardConstraintLabel(v.code)} {v.waived ? "(waived)" : "(needs fixing)"}
                      </span>
                      <span>
                        {v.waivable ? "Waivable with reason" : "Never waivable"}
                      </span>
                    </div>
                    <p className="mt-1" title={v.message}>
                      {v.description ?? v.message}
                    </p>
                    {v.waiver_reason && (
                      <p className="mt-1 italic text-[var(--ordiq-muted)]">
                        Reason: {v.waiver_reason}
                      </p>
                    )}
                  </div>
                ),
              )}
              {(activeSchedule?.validationReport?.violations?.length ?? 0) ===
                0 && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Zero hard constraint violations detected by the independent
                  Python validator.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Pin className="h-4 w-4 text-[var(--ordiq-maroon)]" />
              Unscheduled Meetings & Revision History
            </CardTitle>
            <CardDescription>
              Meetings left unplaced by D-07 partial solve and audit trail of
              workspace edits.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {(activeSchedule?.unscheduled ?? []).map((u, idx) => (
                <div
                  key={`${u.offeringCode}-${idx}`}
                  className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-[var(--ordiq-ink)]"
                >
                  <div className="font-semibold">
                    {u.offeringCode} (meeting {u.meetingIndex + 1}) —{" "}
                    {unscheduledReasonLabel(u.reasonCode)}
                  </div>
                  <p className="mt-0.5 text-[var(--ordiq-muted)]">{u.reasonDetail}</p>
                </div>
              ))}
              {(activeSchedule?.unscheduled?.length ?? 0) === 0 && (
                <p className="text-xs text-[var(--ordiq-muted)]">
                  All required meetings are placed.
                </p>
              )}
            </div>

            <div className="pt-2">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                Revision History ({activeSchedule?.changes?.length ?? 0})
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--ordiq-ink)]">
                {(activeSchedule?.changes ?? []).map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span>
                      {changeActionLabel(c.action)} by <strong>{c.actor}</strong>
                    </span>
                    <span className="text-[var(--ordiq-muted)]">
                      {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Modal: Accept Candidate */}
      <ConfirmationModal
        isOpen={showAcceptModal}
        onClose={() => setShowAcceptModal(false)}
        onConfirm={async () => {
          setShowAcceptModal(false);
          await handleAccept();
        }}
        title="Accept Candidate Schedule?"
        description={`Are you sure you want to accept "${activeSchedule?.candidateLabel ?? "Candidate"}" as the official schedule? Once accepted, this schedule will be published for portal encoding. You can create a revision later if adjustments are needed.`}
        confirmText="Accept Schedule"
        variant="default"
        isLoading={loading}
        icon={<CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
      />

      {/* Confirmation Modal: Start Revision */}
      <ConfirmationModal
        isOpen={showRevisionModal}
        onClose={() => setShowRevisionModal(false)}
        onConfirm={async () => {
          setShowRevisionModal(false);
          await handleStartRevision();
        }}
        title="Start Schedule Revision?"
        description={`This will branch a new candidate draft (v${(activeSchedule?.version ?? 1) + 1}) from this accepted schedule so you can safely make edits without affecting the accepted baseline.`}
        confirmText="Start Revision"
        variant="default"
        isLoading={loading}
        icon={<GitBranch className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
      />

      {/* Confirmation Modal: Undo Edit */}
      <ConfirmationModal
        isOpen={showUndoModal}
        onClose={() => setShowUndoModal(false)}
        onConfirm={async () => {
          setShowUndoModal(false);
          await handleUndo();
        }}
        title="Undo Last Schedule Change?"
        description="Are you sure you want to revert the most recent adjustment to this schedule? The schedule will be restored to its previous state and re-validated against all 11 constraint checkers."
        confirmText="Undo Change"
        variant="warning"
        isLoading={loading}
        icon={<RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />}
      />
    </div>
  );
}
