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
  CheckCircle2,
  GitBranch,
  Lock,
  Pin,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Table2,
  Unlock,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

export function ScheduleWorkspace() {
  const [schedules, setSchedules] = useState<ScheduleDto[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "calendar" | "compare">(
    "grid",
  );
  const [filterText, setFilterText] = useState("");
  const [filterDay, setFilterDay] = useState<string>("ALL");
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [waiverCode, setWaiverCode] = useState<HardConstraintCode>("HC-04");
  const [waiverReason, setWaiverReason] = useState("");

  async function refreshSchedules() {
    setLoading(true);
    try {
      const resp = await fetch("/api/v1/schedules?termCode=AY2026-2027-S1");
      if (resp.ok) {
        const data = (await resp.json()) as { schedules: ScheduleDto[] };
        setSchedules(data.schedules ?? []);
        if (!activeId && data.schedules?.[0]) {
          setActiveId(data.schedules[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshSchedules();
  }, []);

  const activeSchedule =
    schedules.find((s) => s.id === activeId) ?? schedules[0] ?? null;

  async function handleGenerateCandidates() {
    setLoading(true);
    setStatusMessage("Generating 3 candidate profiles via CP-SAT...");
    try {
      const resp = await fetch("/api/v1/generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          termCode: "AY2026-2027-S1",
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

  const filteredEntries = (activeSchedule?.entries ?? []).filter((e) => {
    const matchesDay = filterDay === "ALL" || e.weekday === filterDay;
    const q = filterText.trim().toLowerCase();
    const matchesText =
      !q ||
      e.offeringCode.toLowerCase().includes(q) ||
      e.facultyCode.toLowerCase().includes(q) ||
      e.roomCode.toLowerCase().includes(q);
    return matchesDay && matchesText;
  });

  return (
    <div className="space-y-6">
      {/* Candidate Disclaimer Banner (Phase 3 task 13) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
        <div className="flex items-center gap-2 font-medium">
          <ShieldAlert className="h-4 w-4 text-amber-700" />
          <span>
            <strong>CANDIDATE DECISION-SUPPORT NOTICE:</strong> Schedules inside
            ORDIQ are candidate proposals for the Dean&apos;s review and are{" "}
            <u>not official and not for release</u> until encoded in the
            university portal.
          </span>
        </div>
        {statusMessage && (
          <Badge variant="neutral" className="bg-white text-amber-900">
            {statusMessage}
          </Badge>
        )}
      </div>

      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Schedule Workspace & Candidate Comparison
          </h1>
          <p className="text-sm text-stone-600">
            Spreadsheet grid, weekly timetable, instant conflict validation,
            optimistic locking, and documented waivers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => void handleGenerateCandidates()}
            disabled={loading}
            className="bg-[#7b1113] text-white hover:bg-[#5e0c0e]"
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            Generate 3 Candidates (CP-SAT)
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleCheckConflicts()}
            disabled={!activeSchedule || loading}
          >
            <Play className="mr-1.5 h-4 w-4" />
            Check Existing Schedule
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleUndo()}
            disabled={!activeSchedule || loading}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Undo Edit
          </Button>
          {activeSchedule?.status === "CANDIDATE" && (
            <Button
              onClick={() => void handleAccept()}
              disabled={loading}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Accept Candidate
            </Button>
          )}
          {activeSchedule?.status === "ACCEPTED" && (
            <Button
              variant="outline"
              onClick={() => void handleStartRevision()}
              disabled={loading}
            >
              <GitBranch className="mr-1.5 h-4 w-4" />
              Start Revision
            </Button>
          )}
        </div>
      </div>

      {/* Candidate Selector & View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase text-stone-500">
            Schedule:
          </span>
          <select
            aria-label="Select candidate schedule"
            value={activeSchedule?.id ?? ""}
            onChange={(e) => setActiveId(e.target.value)}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-900"
          >
            {schedules.length === 0 && (
              <option value="">No schedules yet — load fixture or generate</option>
            )}
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.candidateLabel} [{s.status}] (v{s.version}
                {s.qualityScore !== null ? ` • Score ${s.qualityScore}` : ""})
              </option>
            ))}
          </select>
          {activeSchedule?.solverStatus && (
            <Badge variant="neutral">
              Solver: {activeSchedule.solverStatus}
            </Badge>
          )}
          {activeSchedule?.recheckNeeded && (
            <Badge variant="warning">Recheck Needed (Master Data Changed)</Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={viewMode === "grid" ? "default" : "outline"}
            onClick={() => setViewMode("grid")}
          >
            <Table2 className="mr-1.5 h-4 w-4" />
            Spreadsheet Grid
          </Button>
          <Button
            size="sm"
            variant={viewMode === "calendar" ? "default" : "outline"}
            onClick={() => setViewMode("calendar")}
          >
            <Calendar className="mr-1.5 h-4 w-4" />
            Weekly Timetable
          </Button>
          <Button
            size="sm"
            variant={viewMode === "compare" ? "default" : "outline"}
            onClick={() => setViewMode("compare")}
          >
            Compare Candidates ({schedules.length})
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Filter by offering, faculty, or room code..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Filter by weekday"
          value={filterDay}
          onChange={(e) => setFilterDay(e.target.value)}
          className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
        >
          <option value="ALL">All Weekdays</option>
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Main View Area */}
      {viewMode === "compare" ? (
        <Card>
          <CardHeader>
            <CardTitle>Side-by-Side Candidate Comparison (D-19)</CardTitle>
            <CardDescription>
              Compare conflicts, waived rules, unscheduled meetings, and quality
              scores across profiles.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-600">
                  <tr>
                    <th className="px-3 py-2">Candidate</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Solver Status</th>
                    <th className="px-3 py-2">Quality Score</th>
                    <th className="px-3 py-2">Hard Violations</th>
                    <th className="px-3 py-2">Waived Exceptions</th>
                    <th className="px-3 py-2">Unscheduled</th>
                    <th className="px-3 py-2">Meetings Placed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {schedules.map((s) => (
                    <tr key={s.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium">
                        {s.candidateLabel}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="neutral">{s.status}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        {s.solverStatus ?? "IMPORTED"}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {s.qualityScore ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {s.validationReport?.hard_violation_count ?? 0}
                      </td>
                      <td className="px-3 py-2">
                        {s.validationReport?.waived_violation_count ?? 0}
                      </td>
                      <td className="px-3 py-2">
                        {s.unscheduled?.length ?? 0}
                      </td>
                      <td className="px-3 py-2">{s.entries.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : viewMode === "calendar" ? (
        <Card>
          <CardHeader>
            <CardTitle>Weekly Timetable View (Monday – Saturday)</CardTitle>
            <CardDescription>
              Visual weekly grid grouped by teaching day and time slot.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {WEEKDAYS.map((day) => {
                const dayEntries = filteredEntries
                  .filter((e) => e.weekday === day)
                  .sort((a, b) => a.startMin - b.startMin);
                return (
                  <div
                    key={day}
                    className="rounded-lg border border-stone-200 bg-stone-50/60 p-2.5"
                  >
                    <div className="mb-2 border-b border-stone-200 pb-1.5 text-xs font-bold uppercase tracking-wider text-[#7b1113]">
                      {day} ({dayEntries.length})
                    </div>
                    <div className="space-y-2">
                      {dayEntries.map((e) => (
                        <div
                          key={e.id}
                          className="rounded border border-stone-200 bg-white p-2 text-xs shadow-xs"
                        >
                          <div className="font-semibold text-stone-900">
                            {e.offeringCode}
                          </div>
                          <div className="text-stone-600">
                            {formatMin(e.startMin)} – {formatMin(e.endMin)}
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-stone-500">
                            <span>{e.facultyCode}</span>
                            <span>{e.roomCode}</span>
                          </div>
                        </div>
                      ))}
                      {dayEntries.length === 0 && (
                        <p className="py-4 text-center text-xs text-stone-400">
                          No classes
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Spreadsheet Schedule Grid ({filteredEntries.length} meetings)
            </CardTitle>
            <CardDescription>
              Version v{activeSchedule?.version ?? 1} • Pin/unpin meetings or
              inspect validation status in real time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-600">
                  <tr>
                    <th className="px-3 py-2">Offering</th>
                    <th className="px-3 py-2">Faculty</th>
                    <th className="px-3 py-2">Room</th>
                    <th className="px-3 py-2">Weekday</th>
                    <th className="px-3 py-2">Time Slot</th>
                    <th className="px-3 py-2">Lock / Pin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {filteredEntries.map((e) => (
                    <tr key={e.id} className="hover:bg-stone-50">
                      <td className="px-3 py-2 font-medium text-stone-900">
                        {e.offeringCode}
                      </td>
                      <td className="px-3 py-2">{e.facultyCode}</td>
                      <td className="px-3 py-2">{e.roomCode}</td>
                      <td className="px-3 py-2">{e.weekday}</td>
                      <td className="px-3 py-2">
                        {formatMin(e.startMin)} – {formatMin(e.endMin)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleTogglePin(e)}
                        >
                          {e.pinned ? (
                            <>
                              <Lock className="mr-1 h-3.5 w-3.5 text-amber-700" />
                              Pinned
                            </>
                          ) : (
                            <>
                              <Unlock className="mr-1 h-3.5 w-3.5 text-stone-400" />
                              Pin
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredEntries.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-8 text-center text-stone-500"
                      >
                        No schedule entries loaded. Use &ldquo;Generate 3
                        Candidates (CP-SAT)&rdquo; above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Violations, Documented Exceptions (D-18), and Unscheduled Diagnostics */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
            <div className="space-y-2">
              {(activeSchedule?.validationReport?.violations ?? []).map(
                (v, i) => (
                  <div
                    key={`${v.code}-${i}`}
                    className={`rounded-md border p-2.5 text-xs ${
                      v.waived
                        ? "border-stone-200 bg-stone-50 text-stone-600"
                        : "border-red-200 bg-red-50 text-red-900"
                    }`}
                  >
                    <div className="flex items-center justify-between font-semibold">
                      <span>
                        {v.code} {v.waived ? "(WAIVED)" : "(ACTIVE VIOLATION)"}
                      </span>
                      <span>
                        {v.waivable ? "Waivable with reason" : "Never waivable"}
                      </span>
                    </div>
                    <p className="mt-1">{v.message}</p>
                    {v.waiver_reason && (
                      <p className="mt-1 italic text-stone-500">
                        Reason: {v.waiver_reason}
                      </p>
                    )}
                  </div>
                ),
              )}
              {(activeSchedule?.validationReport?.violations?.length ?? 0) ===
                0 && (
                <p className="text-xs text-emerald-700">
                  Zero hard constraint violations detected by the independent
                  Python validator.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
              <select
                aria-label="Select waivable rule code"
                value={waiverCode}
                onChange={(e) =>
                  setWaiverCode(e.target.value as HardConstraintCode)
                }
                className="rounded border border-stone-300 px-2.5 py-1.5 text-xs"
              >
                {HARD_CONSTRAINT_CODES.filter(
                  (c) => !NON_WAIVABLE_HARD_CONSTRAINTS.includes(c),
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Documented exception reason (required)..."
                value={waiverReason}
                onChange={(e) => setWaiverReason(e.target.value)}
                className="flex-1 rounded border border-stone-300 px-2.5 py-1.5 text-xs"
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Pin className="h-4 w-4 text-[#7b1113]" />
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
                  className="rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950"
                >
                  <div className="font-semibold">
                    {u.offeringCode} (Meeting #{u.meetingIndex + 1}) —{" "}
                    {u.reasonCode}
                  </div>
                  <p className="mt-0.5">{u.reasonDetail}</p>
                </div>
              ))}
              {(activeSchedule?.unscheduled?.length ?? 0) === 0 && (
                <p className="text-xs text-stone-600">
                  All required meetings are placed.
                </p>
              )}
            </div>

            <div className="border-t border-stone-200 pt-3">
              <div className="mb-1.5 text-xs font-semibold uppercase text-stone-500">
                Revision History ({activeSchedule?.changes?.length ?? 0})
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto text-xs text-stone-600">
                {(activeSchedule?.changes ?? []).map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span>
                      {c.action} by <strong>{c.actor}</strong>
                    </span>
                    <span className="text-stone-400">
                      {new Date(c.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
