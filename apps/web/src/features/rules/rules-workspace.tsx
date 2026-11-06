"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gavel,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  ShieldOff,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { type FormValues, RecordFormDialog } from "@/components/ui/record-form-dialog";
import { RowEditButton } from "@/components/ui/row-edit-button";
import {
  skeletonRowCount,
  TableRefreshBar,
  TableSkeletonRows,
} from "@/components/ui/table-skeleton";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { deleteRecord, errorMessage, fetchItems, saveRecord } from "@/features/data/record-api";
import {
  DIRECTIVE_TYPE_LABELS,
  EDITABLE_DIRECTIVE_TYPES,
  type EditableDirectiveType,
  directiveFields,
  fixedBlockFields,
  titleCase,
} from "@/features/data/record-fields";
import { severityLabel } from "@/lib/display-labels";
import { useCodeOptions, useRecordEditor } from "@/features/data/use-record-editor";
import { useShell } from "@/features/shell/providers";
import { cn } from "@/lib/utils";

export type RulesTab = "constraints" | "soft-rules" | "directives" | "fixed-blocks" | "readiness";

export interface FixedBlockItem {
  id: string;
  termCode: string;
  sectionCode: string;
  weekday: string;
  startMin: number;
  endMin: number;
  label: string;
  location: string;
}

export interface DirectiveItem {
  id: string;
  termCode: string;
  type: string;
  hardness: "HARD" | "SOFT";
  approved: boolean;
  facultyCode: string | null;
  sectionCode: string | null;
  roomCode: string | null;
  offeringCode: string | null;
  weekday: string | null;
  startMin: number | null;
  endMin: number | null;
  weight: number;
  createdBy: string;
  createdAt: string;
}

interface SoftWeightsDto {
  defaults: Record<string, number>;
  overrides: Record<string, number>;
}

export interface ReadinessReportDto {
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

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/** Hard constraints as defined in the implementation plan (Section 6). */
const HARD_CONSTRAINTS_REGISTRY = [
  { code: "HC-01", name: "Faculty one class at a time", category: "Conflict", waivable: false, description: "A faculty member never teaches two meetings that overlap.", adjust: { label: "Schedules", href: "/schedules" } },
  { code: "HC-02", name: "Room one class at a time", category: "Conflict", waivable: false, description: "A room never hosts two meetings that overlap, except offerings in the same combined-class group.", adjust: { label: "Schedules", href: "/schedules" } },
  { code: "HC-03", name: "Section one class at a time", category: "Conflict", waivable: false, description: "A section never has two meetings that overlap.", adjust: { label: "Schedules", href: "/schedules" } },
  { code: "HC-04", name: "Room capacity fits the section", category: "Room", waivable: true, description: "The room seats at least the section's student count (combined classes add their counts).", adjust: { label: "Room capacity", href: "/rooms" } },
  { code: "HC-05", name: "Room type matches", category: "Room", waivable: true, description: "Each meeting uses a room of the type the offering requires (lecture, laboratory, and so on).", adjust: { label: "Room types", href: "/rooms" } },
  { code: "HC-06", name: "Faculty available", category: "Faculty", waivable: true, description: "Faculty are scheduled only inside their availability windows for the term.", adjust: { label: "Faculty availability", href: "/faculty" } },
  { code: "HC-07", name: "Maximum teaching load", category: "Faculty", waivable: true, description: "Each faculty member stays within the unit and hour limits of their employment type.", adjust: { label: "Faculty loads", href: "/faculty" } },
  { code: "HC-08", name: "All required meetings scheduled", category: "Coverage", waivable: true, description: "Every offering receives its required meetings and contact hours per week.", adjust: { label: "Offerings", href: "/courses-sections" } },
  { code: "HC-09", name: "Specialization matches subject", category: "Faculty", waivable: true, description: "Faculty teach only subjects they are qualified for.", adjust: { label: "Faculty qualifications", href: "/faculty" } },
  { code: "HC-10", name: "Rooms available", category: "Room", waivable: true, description: "Rooms are used only while active and inside their availability windows.", adjust: { label: "Room availability", href: "/rooms" } },
  { code: "HC-11", name: "Allowed periods and breaks", category: "Calendar", waivable: true, description: "Meetings fall inside the term's teaching days and hours and avoid official breaks.", adjust: { label: "Term hours", href: "/courses-sections" } },
  { code: "HC-12", name: "Dean directives respected", category: "Directive", waivable: true, description: "Approved hard directives (time windows, rooms, assignments) are always honoured.", adjust: { label: "Dean directives", tab: "directives" } },
  { code: "HC-13", name: "Duration and meeting pattern", category: "Calendar", waivable: true, description: "Each meeting has the offering's length and follows its meeting pattern (MWF, TTH, once a week).", adjust: { label: "Offerings", href: "/courses-sections" } },
  { code: "HC-14", name: "Calendar and maintenance restrictions", category: "Calendar", waivable: true, description: "No meetings during calendar restrictions or room maintenance periods.", adjust: { label: "Room maintenance", href: "/rooms" } },
  { code: "HC-15", name: "Sections clear of fixed blocks", category: "Calendar", waivable: true, description: "Sections are never scheduled during their locked fixed blocks (PATHFIT, NSTP, GenEd).", adjust: { label: "Fixed blocks", tab: "fixed-blocks" } },
] as const;

/** Soft objectives as defined in the implementation plan (Section 6). */
const SOFT_OBJECTIVES_REGISTRY = [
  { code: "SC-01", name: "Preferred days and times", description: "Honour faculty preferences for days and time windows." },
  { code: "SC-02", name: "Balanced faculty loads", description: "Spread teaching load evenly across faculty." },
  { code: "SC-03", name: "Minimal gaps", description: "Reduce idle time between classes for sections and faculty." },
  { code: "SC-04", name: "Preferred rooms", description: "Place faculty in the rooms they prefer." },
  { code: "SC-05", name: "Even spread across the week and day", description: "Distribute classes evenly across weekdays and hours instead of crowding one time." },
  { code: "SC-06", name: "Stability on regeneration", description: "Keep the previous schedule where possible when regenerating." },
  { code: "SC-07", name: "Faculty fit score", description: "Favour assignments with a high learned fit score." },
  { code: "SC-08", name: "Room efficiency", description: "Match room size to section size to avoid wasted seats." },
  { code: "SC-09", name: "No evening classes for lower years", description: "Keep first- and second-year sections out of evening slots." },
  { code: "SC-10", name: "Lower-year priority", description: "Give lower-year sections the better time slots first." },
  { code: "SC-11", name: "Labs away from late hours", description: "Schedule laboratory meetings earlier in the day." },
  { code: "SC-12", name: "Spread major and math subjects", description: "Avoid stacking heavy major or mathematics subjects on the same day." },
  { code: "SC-13", name: "Breaks between long classes", description: "Leave a break after long back-to-back classes." },
  { code: "SC-14", name: "No late-then-early turnarounds", description: "Avoid a late class followed by an early class the next day." },
  { code: "SC-15", name: "PATHFIT late or before a vacant period", description: "Place PATHFIT at the end of the day or before a free period." },
  { code: "SC-16", name: "Few very early starts", description: "Limit classes that start at the earliest time of day." },
] as const;

type PendingDelete =
  | { kind: "block"; item: FixedBlockItem }
  | { kind: "directive"; item: DirectiveItem };

function directiveTarget(d: DirectiveItem): string {
  const window =
    d.startMin !== null && d.endMin !== null
      ? `${formatMinutes(d.startMin)} – ${formatMinutes(d.endMin)}`
      : null;
  switch (d.type) {
    case "FACULTY_NOT_ON_DAY":
      return `${d.facultyCode ?? "?"} not on ${d.weekday ? titleCase(d.weekday) : "?"}`;
    case "FACULTY_TIME_WINDOW":
      return `${d.facultyCode ?? "?"} only ${window ?? "?"}`;
    case "SECTION_TIME_WINDOW":
      return `${d.sectionCode ?? "?"} only ${window ?? "?"}`;
    case "AVOID_ROOM":
      return [
        `Avoid ${d.roomCode ?? "?"}`,
        d.offeringCode ? `for ${d.offeringCode}` : null,
        d.facultyCode ? `with ${d.facultyCode}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    case "REQUIRE_ROOM":
      return `${d.offeringCode ?? "?"} in ${d.roomCode ?? "?"}`;
    case "ASSIGN_FACULTY":
      return `${d.offeringCode ?? "?"} taught by ${d.facultyCode ?? "?"}`;
    case "PIN_MEETING":
      return [d.offeringCode, d.weekday ? titleCase(d.weekday) : null, window, d.roomCode]
        .filter(Boolean)
        .join(" · ");
    default:
      return "—";
  }
}

export function RulesWorkspace() {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<RulesTab>("constraints");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [newDirectiveType, setNewDirectiveType] =
    React.useState<EditableDirectiveType>("FACULTY_NOT_ON_DAY");
  const [busyDirectiveId, setBusyDirectiveId] = React.useState<string | null>(null);

  const blockEditor = useRecordEditor<FixedBlockItem>();
  const directiveEditor = useRecordEditor<DirectiveItem>();

  // Queries
  const fixedBlocksQuery = useQuery({
    queryKey: ["fixed-blocks-data", termCode],
    queryFn: () => fetchItems<FixedBlockItem>("fixed-blocks", { termCode }),
  });

  const directivesQuery = useQuery({
    queryKey: ["directives-data", termCode],
    queryFn: () => fetchItems<DirectiveItem>("directives", { termCode }),
  });

  const softWeightsQuery = useQuery<SoftWeightsDto>({
    queryKey: ["soft-weights", termCode],
    queryFn: async () => {
      const res = await fetch(`/api/v1/soft-weights?termCode=${encodeURIComponent(termCode)}`);
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as SoftWeightsDto;
    },
  });

  const readinessQuery = useQuery<ReadinessReportDto>({
    queryKey: ["readiness", termCode],
    queryFn: async () => {
      const res = await fetch(`/api/v1/readiness?termCode=${encodeURIComponent(termCode)}`);
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as ReadinessReportDto;
    },
  });

  const sectionOptions = useCodeOptions("sections");
  const facultyOptions = useCodeOptions("faculty");
  const roomOptions = useCodeOptions("rooms");
  const offeringParams = React.useMemo(() => ({ termCode }), [termCode]);
  const offeringOptions = useCodeOptions("offerings", offeringParams);

  const fixedBlocks = fixedBlocksQuery.data ?? [];
  const directives = directivesQuery.data ?? [];
  const readiness = readinessQuery.data;

  // Soft weights: server values plus unsaved slider changes.
  const [weightDraft, setWeightDraft] = React.useState<Record<string, number>>({});
  const [savingWeights, setSavingWeights] = React.useState(false);
  React.useEffect(() => {
    setWeightDraft({});
  }, [termCode, softWeightsQuery.data]);

  const defaults = softWeightsQuery.data?.defaults ?? {};
  const savedWeight = (code: string) =>
    softWeightsQuery.data?.overrides[code] ?? defaults[code] ?? 0;
  const currentWeight = (code: string) => weightDraft[code] ?? savedWeight(code);
  const weightsDirty = Object.keys(weightDraft).some(
    (code) => weightDraft[code] !== savedWeight(code),
  );
  const overrideCount = Object.keys(softWeightsQuery.data?.overrides ?? {}).length;

  const saveWeights = async () => {
    setSavingWeights(true);
    setNotice(null);
    try {
      const weights: Record<string, number> = {};
      for (const sc of SOFT_OBJECTIVES_REGISTRY) {
        if (sc.code in defaults) weights[sc.code] = currentWeight(sc.code);
      }
      const res = await fetch("/api/v1/soft-weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termCode, weights }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The weights could not be saved.");
      }
      await queryClient.invalidateQueries({ queryKey: ["soft-weights", termCode] });
      setNotice({ tone: "success", text: "Objective weights saved. The next generation run uses them." });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "The weights could not be saved.") });
    } finally {
      setSavingWeights(false);
    }
  };

  const resetWeightsToDefaults = () => {
    const next: Record<string, number> = {};
    for (const sc of SOFT_OBJECTIVES_REGISTRY) {
      const fallback = defaults[sc.code];
      if (fallback !== undefined) next[sc.code] = fallback;
    }
    setWeightDraft(next);
  };

  // Fixed blocks
  const openNewBlock = () =>
    blockEditor.openCreate({
      label: "",
      sectionCode: sectionOptions[0]?.value ?? "",
      weekday: "MONDAY",
      startMin: 8 * 60,
      endMin: 10 * 60,
      location: "",
    });

  const saveBlock = async (values: FormValues) => {
    const original = blockEditor.state?.original;
    await saveRecord("fixed-blocks", {
      ...values,
      termCode,
      ...(original ? { replaceId: original.id } : {}),
    });
    blockEditor.close();
    await queryClient.invalidateQueries({ queryKey: ["fixed-blocks-data"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
    setNotice({ tone: "success", text: `Fixed block "${String(values.label)}" saved.` });
  };

  // Directives
  const editingDirectiveType = directiveEditor.state?.original?.type ?? newDirectiveType;

  const openNewDirective = () =>
    directiveEditor.openCreate({
      hardness: "HARD",
      weight: 1,
      facultyCode: facultyOptions[0]?.value ?? "",
      sectionCode: sectionOptions[0]?.value ?? "",
      roomCode: roomOptions[0]?.value ?? "",
      offeringCode:
        newDirectiveType === "AVOID_ROOM" ? null : (offeringOptions[0]?.value ?? ""),
      weekday: "MONDAY",
      startMin: 8 * 60,
      endMin: 17 * 60,
    });

  const saveDirective = async (values: FormValues) => {
    const original = directiveEditor.state?.original;
    await saveRecord("directives", {
      ...values,
      termCode,
      type: editingDirectiveType,
      ...(original ? { replaceId: original.id } : {}),
    });
    directiveEditor.close();
    await queryClient.invalidateQueries({ queryKey: ["directives-data"] });
    setNotice({
      tone: "success",
      text: original
        ? "Directive updated. It needs approval again before it is enforced."
        : "Directive added. Hard directives are enforced once approved.",
    });
  };

  const setApproval = async (directive: DirectiveItem, approved: boolean) => {
    setBusyDirectiveId(directive.id);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/directives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: directive.id, approved }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The directive could not be updated.");
      }
      await queryClient.invalidateQueries({ queryKey: ["directives-data"] });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "The directive could not be updated.") });
    } finally {
      setBusyDirectiveId(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setNotice(null);
    try {
      if (pendingDelete.kind === "block") {
        await deleteRecord("fixed-blocks", { id: pendingDelete.item.id });
        await queryClient.invalidateQueries({ queryKey: ["fixed-blocks-data"] });
        await queryClient.invalidateQueries({ queryKey: ["readiness"] });
      } else {
        await deleteRecord("directives", { id: pendingDelete.item.id });
        await queryClient.invalidateQueries({ queryKey: ["directives-data"] });
      }
      setPendingDelete(null);
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error, "The record could not be deleted.") });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const q = searchQuery.trim().toLowerCase();

  const filteredFixedBlocks = fixedBlocks.filter(
    (block) =>
      !q ||
      block.sectionCode.toLowerCase().includes(q) ||
      block.label.toLowerCase().includes(q) ||
      block.location.toLowerCase().includes(q) ||
      block.weekday.toLowerCase().includes(q),
  );

  const filteredHardConstraints = HARD_CONSTRAINTS_REGISTRY.filter(
    (hc) =>
      !q ||
      hc.code.toLowerCase().includes(q) ||
      hc.name.toLowerCase().includes(q) ||
      hc.category.toLowerCase().includes(q) ||
      hc.description.toLowerCase().includes(q),
  );

  const filteredDirectives = directives.filter(
    (d) =>
      !q ||
      d.type.toLowerCase().includes(q) ||
      (DIRECTIVE_TYPE_LABELS[d.type] ?? "").toLowerCase().includes(q) ||
      directiveTarget(d).toLowerCase().includes(q),
  );

  const constraintsPagination = usePagination(filteredHardConstraints, 15);
  const directivesPagination = usePagination(filteredDirectives, 15);
  const fixedBlocksPagination = usePagination(filteredFixedBlocks, 15);

  const pendingApproval = directives.filter((d) => d.hardness === "HARD" && !d.approved).length;
  const searchable = activeTab === "constraints" || activeTab === "fixed-blocks" || activeTab === "directives";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
          Scheduling Rules, Constraints & Fixed Blocks
        </h1>
        <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
          Hard constraints, objective weights, Dean directives, locked blocks (PATHFIT/GenEd), and ISO/IEC 25012 readiness for {termCode}.
        </p>
      </div>

      {/* Rules KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Hard Constraints (HC)
              </span>
              <Lock className="h-4 w-4 text-[var(--ordiq-maroon)]" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {HARD_CONSTRAINTS_REGISTRY.length} Enforced
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              3 can never be waived (HC-01..03)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Soft Objectives (SC)
              </span>
              <Scale className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {SOFT_OBJECTIVES_REGISTRY.length} Objectives
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              {overrideCount === 0 ? "Using default weights" : `${overrideCount} custom weights for this term`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Dean Directives
              </span>
              <Gavel className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {directives.length} Directives
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              {pendingApproval} hard directives awaiting approval
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                ISO/IEC 25012 Gate
              </span>
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {readiness?.canGenerate ? "Ready" : "Blocked"}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              {readiness?.criticalCount ?? 0} Critical Gaps
            </p>
          </CardContent>
        </Card>
      </div>

      {notice && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border p-3 text-xs",
            notice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
          )}
          role="status"
        >
          <span className="flex items-center gap-2">
            {notice.tone === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {notice.text}
          </span>
          <button
            type="button"
            className="text-[11px] font-semibold underline-offset-2 hover:underline"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Rules Workspace Sub-Navigation Card */}
      <Card className="overflow-hidden">
        <div className="p-2 sm:p-2.5 bg-[var(--ordiq-surface-muted)]/70">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-2 w-full">
            {(
              [
                { id: "constraints", label: "Hard Constraints", icon: Lock, count: null },
                { id: "soft-rules", label: "Objective Weights", icon: Scale, count: null },
                { id: "directives", label: "Dean Directives", icon: Gavel, count: directives.length },
                { id: "fixed-blocks", label: "Locked Fixed Blocks", icon: Clock, count: fixedBlocks.length },
                { id: "readiness", label: "Readiness Gate", icon: Sparkles, count: null },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-xs transition-all cursor-pointer",
                    active
                      ? "bg-[var(--ordiq-surface)] text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)] font-bold shadow-xs ring-1 ring-[var(--ordiq-border)]"
                      : "text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface)]/60 font-medium",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active
                        ? "text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]"
                        : "text-[var(--ordiq-muted)]",
                    )}
                  />
                  <span className="truncate">{tab.label}</span>
                  {tab.count !== null && (
                    <span
                      className={cn(
                        "ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 transition-colors",
                        active
                          ? "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]"
                          : "bg-[var(--ordiq-surface)] text-[var(--ordiq-muted)] border border-[var(--ordiq-border)]/40",
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between p-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === "fixed-blocks" && (
              <Button
                variant="outline"
                size="sm"
                onClick={openNewBlock}
                className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)] hover:text-[var(--ordiq-maroon)]"
              >
                <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
                <span>Add Block</span>
              </Button>
            )}
            {activeTab === "directives" && (
              <>
                <select
                  value={newDirectiveType}
                  onChange={(e) => setNewDirectiveType(e.target.value as EditableDirectiveType)}
                  className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2 text-xs text-[var(--ordiq-ink)]"
                  aria-label="Directive type to add"
                >
                  {EDITABLE_DIRECTIVE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {DIRECTIVE_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openNewDirective}
                  className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)] hover:text-[var(--ordiq-maroon)]"
                >
                  <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
                  <span>Add Directive</span>
                </Button>
              </>
            )}
            {activeTab === "soft-rules" && (
              <>
                <Button
                  size="sm"
                  onClick={() => void saveWeights()}
                  disabled={!weightsDirty || savingWeights || !softWeightsQuery.data}
                  className="text-xs font-semibold"
                >
                  <Save className="h-3.5 w-3.5" />
                  <span>{savingWeights ? "Saving..." : "Save Weights"}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWeightDraft({})}
                  disabled={!weightsDirty || savingWeights}
                  className="text-xs"
                >
                  Discard Changes
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetWeightsToDefaults}
                  disabled={savingWeights || !softWeightsQuery.data}
                  className="text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restore Defaults</span>
                </Button>
              </>
            )}
          </div>

          {searchable && (
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rules, directives or blocks..."
                className="w-44 sm:w-56 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Tab 1: Hard Constraints Table */}
        {activeTab === "constraints" && (
          <div>
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[860px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Code</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Rule</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Category</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Waivability</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">What It Checks</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Adjust In</th>
                  </tr>
                </thead>
                <tbody>
                  {constraintsPagination.paginatedItems.map((hc) => (
                    <tr key={hc.code} className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors">
                      <td className="px-4 py-2.5 text-left font-mono text-[11px] font-bold text-[var(--ordiq-ink)] whitespace-nowrap">
                        {hc.code}
                      </td>
                      <td className="px-4 py-2.5 text-center font-semibold text-[var(--ordiq-ink)] whitespace-nowrap">
                        {hc.name}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge variant="neutral">{hc.category}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {hc.waivable ? (
                          <Badge variant="neutral">Waivable with reason</Badge>
                        ) : (
                          <Badge variant="danger">Never waivable</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-muted)] min-w-[280px] leading-relaxed">
                        {hc.description}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {/* The rule itself is fixed; this is where its inputs are edited. */}
                        {"tab" in hc.adjust ? (
                          <button
                            type="button"
                            onClick={((tab) => () => setActiveTab(tab))(hc.adjust.tab)}
                            className="inline-flex cursor-pointer items-center gap-1 font-semibold text-[var(--ordiq-maroon)] hover:underline dark:text-[var(--ordiq-orange)]"
                          >
                            {hc.adjust.label} <ArrowRight className="h-3 w-3" />
                          </button>
                        ) : (
                          <Link
                            href={hc.adjust.href}
                            className="inline-flex items-center gap-1 font-semibold text-[var(--ordiq-maroon)] hover:underline dark:text-[var(--ordiq-orange)]"
                          >
                            {hc.adjust.label} <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              currentPage={constraintsPagination.currentPage}
              pageSize={constraintsPagination.pageSize}
              totalItems={constraintsPagination.totalItems}
              onPageChange={constraintsPagination.setCurrentPage}
              onPageSizeChange={constraintsPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20, 50]}
              itemLabel="constraints"
            />
          </div>
        )}

        {/* Tab 2: Soft objective weights */}
        {activeTab === "soft-rules" && (
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3 text-xs text-[var(--ordiq-muted)]">
              <span className="font-semibold text-[var(--ordiq-ink)]">Objective weights for {termCode}:</span>{" "}
              Higher weights make the solver work harder on that goal. Saved weights set the Balanced
              candidate; the Faculty-first and Student-first candidates scale by the same ratio. A weight of 0
              turns the objective off. They apply from the next generation run.
            </div>

            {softWeightsQuery.isError ? (
              <div className="py-8 text-center text-xs text-[var(--ordiq-muted)]">
                Sign in with the Dean account (/login) to view objective weights.
              </div>
            ) : !softWeightsQuery.data ? (
              <div className="py-8 text-center text-xs text-[var(--ordiq-muted)]">Loading weights...</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {SOFT_OBJECTIVES_REGISTRY.map((sc) => {
                  const value = currentWeight(sc.code);
                  const fallback = defaults[sc.code];
                  const custom = fallback !== undefined && value !== fallback;
                  const unsaved = weightDraft[sc.code] !== undefined && weightDraft[sc.code] !== savedWeight(sc.code);
                  return (
                    <div
                      key={sc.code}
                      className="rounded-lg border border-[var(--ordiq-border)] p-3.5 space-y-2 hover:bg-[var(--ordiq-surface-muted)]/30 transition-colors"
                    >
                      <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-[var(--ordiq-maroon)]">{sc.code}</span>
                          <span className="font-semibold text-xs text-[var(--ordiq-ink)]">{sc.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[var(--ordiq-ink)]">{value}</span>
                          {unsaved ? (
                            <Badge variant="warning">Unsaved</Badge>
                          ) : custom ? (
                            <Badge variant="orange">Custom (default {fallback})</Badge>
                          ) : (
                            <Badge variant="neutral">Default</Badge>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[var(--ordiq-muted)]">{sc.description}</p>
                      <div className="flex items-center gap-3 pt-1">
                        <Sliders className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
                        <input
                          type="range"
                          min="0"
                          max="30"
                          step="1"
                          value={value}
                          disabled={fallback === undefined}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setWeightDraft((prev) => ({ ...prev, [sc.code]: val }));
                          }}
                          className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[var(--ordiq-border)] accent-[var(--ordiq-maroon)]"
                          aria-label={`Weight for ${sc.name}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Dean directives */}
        {activeTab === "directives" && (
          <div>
            <TableRefreshBar active={directivesQuery.isFetching && !directivesQuery.isLoading} />
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Directive</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Applies To</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Strength</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Weight</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Approval</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Created By</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {directivesQuery.isLoading ? (
                    <TableSkeletonRows
                      columns={7}
                      rows={skeletonRowCount(directivesPagination.pageSize)}
                      actionColumns={[6]}
                      label="Loading directives"
                    />
                  ) : filteredDirectives.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]">
                        {directivesQuery.isError
                          ? "Sign in with the Dean account (/login) to view directives."
                          : directives.length === 0
                            ? 'No directives for this term yet. Pick a type and use "Add Directive" above.'
                            : "No directives match the search."}
                      </td>
                    </tr>
                  ) : (
                    directivesPagination.paginatedItems.map((d) => {
                    const editable = (EDITABLE_DIRECTIVE_TYPES as readonly string[]).includes(d.type);
                    const busy = busyDirectiveId === d.id;
                    return (
                      <tr key={d.id} className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors">
                        <td className="px-4 py-2.5 text-left whitespace-nowrap">
                          <div className="font-semibold text-[var(--ordiq-ink)]">
                            {DIRECTIVE_TYPE_LABELS[d.type] ?? titleCase(d.type)}
                          </div>
                          <div className="font-mono text-[10px] text-[var(--ordiq-muted)]">{d.id}</div>
                        </td>
                        <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-ink)] min-w-[220px]">
                          {directiveTarget(d)}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <Badge variant={d.hardness === "HARD" ? "default" : "neutral"}>
                            {d.hardness === "HARD" ? "Hard" : "Soft"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-[11px] whitespace-nowrap">
                          {d.hardness === "SOFT" ? d.weight : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          {d.approved ? (
                            <Badge variant="success">Approved</Badge>
                          ) : (
                            <Badge variant="warning">Pending</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-muted)] whitespace-nowrap">
                          {d.createdBy}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void setApproval(d, !d.approved)}
                              className={cn(
                                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors disabled:opacity-50",
                                d.approved
                                  ? "text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                                  : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
                              )}
                              title={d.approved ? "Revoke approval" : "Approve directive"}
                            >
                              {d.approved ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                              {d.approved ? "Revoke" : "Approve"}
                            </button>
                            {editable && (
                              <RowEditButton
                                label={`Edit directive ${d.id}`}
                                onClick={() => directiveEditor.openEdit(d)}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => setPendingDelete({ kind: "directive", item: d })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                              title={`Delete directive ${d.id}`}
                              aria-label={`Delete directive ${d.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={directivesPagination.currentPage}
            pageSize={directivesPagination.pageSize}
            totalItems={directivesPagination.totalItems}
            onPageChange={directivesPagination.setCurrentPage}
            onPageSizeChange={directivesPagination.setPageSize}
            pageSizeOptions={[5, 10, 15, 20, 50]}
            itemLabel="directives"
          />
        </div>
        )}

        {/* Tab 4: Locked fixed blocks */}
        {activeTab === "fixed-blocks" && (
          <div>
            <TableRefreshBar active={fixedBlocksQuery.isFetching && !fixedBlocksQuery.isLoading} />
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Reserved Activity</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Section</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Day</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Time Window</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Location</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fixedBlocksQuery.isLoading ? (
                    <TableSkeletonRows
                      columns={6}
                      rows={skeletonRowCount(fixedBlocksPagination.pageSize)}
                      actionColumns={[5]}
                      label="Loading fixed blocks"
                    />
                  ) : filteredFixedBlocks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]">
                        {fixedBlocksQuery.isError
                          ? "Sign in with the Dean account (/login) to view locked fixed blocks."
                          : fixedBlocks.length === 0
                            ? 'No locked blocks for this term yet. Use "Add Block" above.'
                            : "No fixed blocks match the search."}
                      </td>
                    </tr>
                  ) : (
                    fixedBlocksPagination.paginatedItems.map((block) => (
                      <tr key={block.id} className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors">
                        <td className="px-4 py-2.5 text-left font-semibold text-[var(--ordiq-ink)] whitespace-nowrap">
                          <div className="flex items-center justify-start gap-1.5">
                            <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>{block.label}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center font-bold whitespace-nowrap">{block.sectionCode}</td>
                        <td className="px-4 py-2.5 text-center font-medium whitespace-nowrap">{titleCase(block.weekday)}</td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <span className="font-mono text-[11px]">
                            {formatMinutes(block.startMin)} – {formatMinutes(block.endMin)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-muted)] min-w-[200px]">
                          {block.location}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <RowEditButton label={`Edit ${block.label}`} onClick={() => blockEditor.openEdit(block)} />
                            <button
                              type="button"
                              onClick={() => setPendingDelete({ kind: "block", item: block })}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                              title={`Delete ${block.label}`}
                              aria-label={`Delete ${block.label}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination
              currentPage={fixedBlocksPagination.currentPage}
              pageSize={fixedBlocksPagination.pageSize}
              totalItems={fixedBlocksPagination.totalItems}
              onPageChange={fixedBlocksPagination.setCurrentPage}
              onPageSizeChange={fixedBlocksPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20, 50]}
              itemLabel="fixed blocks"
            />
          </div>
        )}

        {/* Tab 4: ISO/IEC 25012 Readiness Gate */}
        {activeTab === "readiness" && (
          <div className="p-4 space-y-4">
            {readiness ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ordiq-border)] p-3">
                  <div>
                    <h3 className="font-semibold text-xs text-[var(--ordiq-ink)]">
                      ISO/IEC 25012 Data Quality Audit ({readiness.termCode})
                    </h3>
                    <p className="text-[11px] text-[var(--ordiq-muted)]">
                      Evaluates completeness, accuracy, consistency, and currentness before CP-SAT schedule generation
                    </p>
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

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                    <div className="text-[11px] text-[var(--ordiq-muted)]">
                      Completeness
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {readiness.iso25012Scores.completeness}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                    <div className="text-[11px] text-[var(--ordiq-muted)]">
                      Accuracy
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {readiness.iso25012Scores.accuracy}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                    <div className="text-[11px] text-[var(--ordiq-muted)]">
                      Consistency
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {readiness.iso25012Scores.consistency}%
                    </div>
                  </div>
                  <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                    <div className="text-[11px] text-[var(--ordiq-muted)]">
                      Currentness
                    </div>
                    <div className="mt-1 text-xl font-bold">
                      {readiness.iso25012Scores.currentness}%
                    </div>
                  </div>
                </div>

                {readiness.issues.length > 0 ? (
                  <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3 text-xs">
                    <p className="font-semibold">
                      Readiness Findings ({readiness.criticalCount} critical, {readiness.warningCount} warnings):
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {readiness.issues.map((issue, idx) => (
                        <li
                          key={`${issue.code}-${issue.entityCode}-${idx}`}
                          className="flex items-center gap-2"
                        >
                          <Badge
                            variant={
                              issue.severity === "CRITICAL"
                                ? "danger"
                                : "warning"
                            }
                          >
                            {severityLabel(issue.severity)}
                          </Badge>
                          <span className="font-mono text-[11px] text-[var(--ordiq-muted)]">
                            {titleCase(issue.dimension)}
                          </span>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--ordiq-border)] bg-emerald-50/50 dark:bg-emerald-950/20 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>All ISO/IEC 25012 criteria satisfied. Master data is ready for solver execution.</span>
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 text-center text-xs text-[var(--ordiq-muted)]">
                Loading data readiness metrics...
              </div>
            )}
          </div>
        )}
      </Card>

      <RecordFormDialog
        open={blockEditor.state !== null}
        mode={blockEditor.state?.mode ?? "create"}
        entityLabel="Fixed Block"
        description={`Sections are never scheduled during a locked block (HC-15). Term ${termCode}.`}
        fields={fixedBlockFields(sectionOptions)}
        initialValues={blockEditor.state?.values}
        onClose={blockEditor.close}
        onSubmit={saveBlock}
      />

      <RecordFormDialog
        open={directiveEditor.state !== null}
        mode={directiveEditor.state?.mode ?? "create"}
        entityLabel={`Directive: ${DIRECTIVE_TYPE_LABELS[editingDirectiveType] ?? titleCase(editingDirectiveType)}`}
        description="Hard directives are enforced by HC-12 only after approval. Saving changes clears the approval."
        fields={directiveFields(editingDirectiveType, {
          faculty: facultyOptions,
          sections: sectionOptions,
          rooms: roomOptions,
          offerings: offeringOptions,
        })}
        initialValues={directiveEditor.state?.values}
        onClose={directiveEditor.close}
        onSubmit={saveDirective}
      />

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        isLoading={deleting}
        title={pendingDelete?.kind === "directive" ? "Delete Directive?" : "Delete Fixed Block?"}
        description={
          pendingDelete?.kind === "directive"
            ? `Directive ${pendingDelete.item.id} (${directiveTarget(pendingDelete.item)}) will be removed. The action is recorded in the audit log.`
            : pendingDelete
              ? `The fixed block "${pendingDelete.item.label}" for section ${pendingDelete.item.sectionCode} will be removed. Affected schedules are flagged for a recheck.`
              : ""
        }
        confirmText="Delete"
        variant="danger"
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </div>
  );
}
