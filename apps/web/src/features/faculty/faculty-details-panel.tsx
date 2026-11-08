"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenCheck, CalendarClock, Heart, Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import {
  type FieldOption,
  type FormField,
  type FormValues,
  RecordFormDialog,
} from "@/components/ui/record-form-dialog";
import { RowEditButton } from "@/components/ui/row-edit-button";
import { TableRefreshBar, TableSkeletonRows } from "@/components/ui/table-skeleton";
import { deleteRecord, errorMessage, fetchItems, saveRecord } from "@/features/data/record-api";
import { WEEKDAY_OPTIONS, titleCase } from "@/features/data/record-fields";
import { useCodeOptions, useRecordEditor } from "@/features/data/use-record-editor";
import { cn } from "@/lib/utils";

/**
 * Per-faculty records the solver reads: availability windows (HC-06),
 * subject qualifications (HC-09) and preferences (SC-01 / SC-04).
 */

export interface AvailabilityItem {
  id: string;
  facultyCode: string;
  termCode: string;
  weekday: string;
  startMin: number;
  endMin: number;
  status: "AVAILABLE" | "UNAVAILABLE";
  reason: string;
}

export interface QualificationItem {
  id: string;
  facultyCode: string;
  subjectCode: string;
  source: "DECLARED" | "HISTORY" | "DEAN";
}

export interface PreferenceItem {
  id: string;
  facultyCode: string;
  termCode: string;
  type: PreferenceType;
  value: string;
  weight: number;
  source: "SURVEY" | "LEARNED" | "DEAN";
}

type PreferenceType = "PREFERRED_DAY" | "AVOID_DAY" | "PREFERRED_TIME_WINDOW" | "PREFERRED_ROOM";

const PREFERENCE_LABELS: Record<PreferenceType, string> = {
  PREFERRED_DAY: "Preferred day",
  AVOID_DAY: "Day to avoid",
  PREFERRED_TIME_WINDOW: "Preferred time window",
  PREFERRED_ROOM: "Preferred room",
};

type DetailsTab = "availability" | "qualifications" | "preferences";

type PendingDelete =
  | { kind: "availability"; item: AvailabilityItem }
  | { kind: "qualification"; item: QualificationItem }
  | { kind: "preference"; item: PreferenceItem };

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function parseHHMM(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "07:30-12:00" → [450, 720] */
function parseWindow(value: string): [number, number] | null {
  const [a, b] = value.split("-");
  if (a === undefined || b === undefined) return null;
  const start = parseHHMM(a);
  const end = parseHHMM(b);
  return start === null || end === null ? null : [start, end];
}

function preferenceValueLabel(p: PreferenceItem): string {
  if (p.type === "PREFERRED_TIME_WINDOW") {
    const w = parseWindow(p.value);
    return w ? `${formatMinutes(w[0])} – ${formatMinutes(w[1])}` : p.value;
  }
  if (p.type === "PREFERRED_DAY" || p.type === "AVOID_DAY") return titleCase(p.value);
  return p.value;
}

const availabilityFields: FormField[] = [
  { name: "weekday", label: "Day", kind: "select", required: true, options: WEEKDAY_OPTIONS },
  {
    name: "status",
    label: "Status",
    kind: "select",
    required: true,
    options: [
      { value: "AVAILABLE", label: "Available" },
      { value: "UNAVAILABLE", label: "Unavailable" },
    ],
  },
  { name: "startMin", label: "From", kind: "time", required: true },
  { name: "endMin", label: "Until", kind: "time", required: true },
  { name: "reason", label: "Reason / note", kind: "text", maxLength: 200, wide: true, help: "Shown to the Dean when a window blocks a placement." },
];

function qualificationFields(subjects: FieldOption[]): FormField[] {
  return [
    { name: "subjectCode", label: "Subject", kind: "select", required: true, options: subjects, wide: true },
    {
      name: "source",
      label: "Source",
      kind: "select",
      required: true,
      options: [
        { value: "DECLARED", label: "Declared by faculty" },
        { value: "HISTORY", label: "Taught before" },
        { value: "DEAN", label: "Set by the Dean" },
      ],
    },
  ];
}

function preferenceFields(type: PreferenceType, rooms: FieldOption[]): FormField[] {
  const value: FormField[] =
    type === "PREFERRED_TIME_WINDOW"
      ? [
          { name: "windowStart", label: "From", kind: "time", required: true },
          { name: "windowEnd", label: "Until", kind: "time", required: true },
        ]
      : type === "PREFERRED_ROOM"
        ? [{ name: "value", label: "Room", kind: "select", required: true, options: rooms, wide: true }]
        : [{ name: "value", label: "Day", kind: "select", required: true, options: WEEKDAY_OPTIONS }];
  return [
    ...value,
    { name: "weight", label: "Weight", kind: "number", required: true, min: 0, max: 10, step: 0.5, help: "0 to 10; higher counts more in SC-01 / SC-04." },
    {
      name: "source",
      label: "Source",
      kind: "select",
      required: true,
      options: [
        { value: "SURVEY", label: "Faculty survey" },
        { value: "LEARNED", label: "Learned from history" },
        { value: "DEAN", label: "Set by the Dean" },
      ],
    },
  ];
}

const deleteButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors";

export function FacultyDetailsPanel({
  faculty,
  termCode,
  onClose,
}: {
  faculty: { code: string; name: string };
  termCode: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<DetailsTab>("availability");
  const [newPreferenceType, setNewPreferenceType] = React.useState<PreferenceType>("PREFERRED_DAY");
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const modalRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();

  const availabilityEditor = useRecordEditor<AvailabilityItem>();
  const qualificationEditor = useRecordEditor<QualificationItem>();
  const preferenceEditor = useRecordEditor<PreferenceItem>();

  const subjectOptions = useCodeOptions("subjects");
  const roomOptions = useCodeOptions("rooms");

  const availabilityQuery = useQuery({
    queryKey: ["faculty-availability", faculty.code, termCode],
    queryFn: () =>
      fetchItems<AvailabilityItem>("faculty-availability", { facultyCode: faculty.code, termCode }),
  });
  const qualificationsQuery = useQuery({
    queryKey: ["faculty-qualifications", faculty.code],
    queryFn: () => fetchItems<QualificationItem>("faculty-qualifications", { facultyCode: faculty.code }),
  });
  const preferencesQuery = useQuery({
    queryKey: ["faculty-preferences", faculty.code, termCode],
    queryFn: () =>
      fetchItems<PreferenceItem>("faculty-preferences", { facultyCode: faculty.code, termCode }),
  });

  const weekdayIndex = (d: string) => WEEKDAY_OPTIONS.findIndex((o) => o.value === d);
  const availability = [...(availabilityQuery.data ?? [])].sort(
    (a, b) => weekdayIndex(a.weekday) - weekdayIndex(b.weekday) || a.startMin - b.startMin,
  );
  const qualifications = [...(qualificationsQuery.data ?? [])].sort((a, b) =>
    a.subjectCode.localeCompare(b.subjectCode),
  );
  const preferences = preferencesQuery.data ?? [];

  const subjectName = React.useMemo(() => {
    const map = new Map(subjectOptions.map((o) => [o.value, o.label]));
    return (code: string) => map.get(code) ?? code;
  }, [subjectOptions]);

  const anyDialogOpen =
    availabilityEditor.state !== null ||
    qualificationEditor.state !== null ||
    preferenceEditor.state !== null ||
    pendingDelete !== null;

  React.useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyDialogOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const controls = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      );
      const first = controls?.[0];
      const last = controls?.[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyDialogOpen, onClose]);

  const refresh = async (key: string) => {
    await queryClient.invalidateQueries({ queryKey: [key, faculty.code] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };

  // Availability
  const saveAvailability = async (values: FormValues) => {
    const original = availabilityEditor.state?.original;
    await saveRecord("faculty-availability", {
      ...values,
      facultyCode: faculty.code,
      termCode,
      ...(original ? { replaceId: original.id } : {}),
    });
    availabilityEditor.close();
    await refresh("faculty-availability");
  };

  // Qualifications
  const saveQualification = async (values: FormValues) => {
    const original = qualificationEditor.state?.original;
    await saveRecord("faculty-qualifications", {
      ...values,
      facultyCode: faculty.code,
      ...(original ? { replaceId: original.id } : {}),
    });
    qualificationEditor.close();
    await refresh("faculty-qualifications");
  };

  // Preferences
  const editingPreferenceType = preferenceEditor.state?.original?.type ?? newPreferenceType;

  const openPreference = (p: PreferenceItem | null) => {
    if (!p) {
      preferenceEditor.openCreate({
        value:
          newPreferenceType === "PREFERRED_ROOM" ? (roomOptions[0]?.value ?? "") : "MONDAY",
        windowStart: 8 * 60,
        windowEnd: 12 * 60,
        weight: 1,
        source: "DEAN",
      });
      return;
    }
    const window = p.type === "PREFERRED_TIME_WINDOW" ? parseWindow(p.value) : null;
    preferenceEditor.openEdit({
      ...p,
      ...(window ? { windowStart: window[0], windowEnd: window[1] } : {}),
    } as PreferenceItem);
  };

  const savePreference = async (values: FormValues) => {
    const original = preferenceEditor.state?.original;
    const { windowStart, windowEnd, ...rest } = values;
    let value = rest.value;
    if (editingPreferenceType === "PREFERRED_TIME_WINDOW") {
      const start = Number(windowStart);
      const end = Number(windowEnd);
      if (!(end > start)) {
        throw Object.assign(new Error("The window must end after it starts."), {
          issues: [{ path: ["windowEnd"], message: "Must be after the start." }],
        });
      }
      value = `${toHHMM(start)}-${toHHMM(end)}`;
    }
    await saveRecord("faculty-preferences", {
      ...rest,
      value,
      type: editingPreferenceType,
      facultyCode: faculty.code,
      termCode,
      ...(original ? { replaceId: original.id } : {}),
    });
    preferenceEditor.close();
    await refresh("faculty-preferences");
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      const segment =
        pendingDelete.kind === "availability"
          ? "faculty-availability"
          : pendingDelete.kind === "qualification"
            ? "faculty-qualifications"
            : "faculty-preferences";
      await deleteRecord(segment, { id: pendingDelete.item.id });
      await refresh(segment);
    } catch (e) {
      setError(errorMessage(e, "The record could not be deleted."));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const tabs = [
    { id: "availability", label: "Availability", icon: CalendarClock, count: availability.length },
    { id: "qualifications", label: "Qualifications", icon: BookOpenCheck, count: qualifications.length },
    { id: "preferences", label: "Preferences", icon: Heart, count: preferences.length },
  ] as const;

  const loadError =
    availabilityQuery.isError || qualificationsQuery.isError || preferencesQuery.isError;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close details"
        className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        tabIndex={-1}
        disabled={anyDialogOpen}
        onClick={onClose}
      />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-[640px] max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--ordiq-border)] p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ordiq-maroon)] text-white">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-base font-semibold text-[var(--ordiq-ink)]">{faculty.name}</h2>
              <p className="mt-1 text-xs text-[var(--ordiq-muted)]">
                {faculty.code} · {termCode}
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-3 gap-1.5 bg-[var(--ordiq-surface-muted)]/70 p-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs transition-all",
                  active
                    ? "bg-[var(--ordiq-surface)] font-bold text-[var(--ordiq-maroon)] shadow-xs ring-1 ring-[var(--ordiq-border)] dark:text-[var(--ordiq-orange)]"
                    : "font-medium text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface)]/60 hover:text-[var(--ordiq-ink)]",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t.label}</span>
                <span className="rounded-full border border-[var(--ordiq-border)]/40 bg-[var(--ordiq-surface)] px-1.5 text-[10px] font-bold">
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="min-w-0 flex-1 basis-64 text-xs leading-relaxed text-[var(--ordiq-muted)]">
            {tab === "availability" && "Set teaching hours. Without any windows, the whole teaching day is available."}
            {tab === "qualifications" && "Subjects this faculty member is qualified to teach."}
            {tab === "preferences" && "Scheduling preferences are considered when possible."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {tab === "preferences" && (
              <select
                value={newPreferenceType}
                onChange={(e) => setNewPreferenceType(e.target.value as PreferenceType)}
                className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2 text-xs text-[var(--ordiq-ink)]"
                aria-label="Preference type to add"
              >
                {(Object.keys(PREFERENCE_LABELS) as PreferenceType[]).map((type) => (
                  <option key={type} value={type}>
                    {PREFERENCE_LABELS[type]}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-xs font-semibold"
              onClick={() => {
                if (tab === "availability") {
                  availabilityEditor.openCreate({
                    weekday: "MONDAY",
                    status: "AVAILABLE",
                    startMin: 8 * 60,
                    endMin: 17 * 60,
                    reason: "",
                  });
                } else if (tab === "qualifications") {
                  qualificationEditor.openCreate({ subjectCode: "", source: "DEAN" });
                } else {
                  openPreference(null);
                }
              }}
            >
              <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Add
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <TableRefreshBar
          active={[availabilityQuery, qualificationsQuery, preferencesQuery].some(
            (q) => q.isFetching && !q.isLoading,
          )}
        />
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
          {loadError ? (
            <p className="py-10 text-center text-xs text-[var(--ordiq-muted)]">
              Sign in with the Dean account (/login) to view these records.
            </p>
          ) : (
            <table className="w-full border-collapse text-xs">
              {tab === "availability" && (
                <>
                  <thead>
                    <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                      <th className="px-3 py-2 text-left">Day</th>
                      <th className="px-3 py-2 text-center">Window</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-center">Note</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {availabilityQuery.isLoading ? (
                      <TableSkeletonRows
                        columns={5}
                        rows={3}
                        align="center"
                        actionColumns={[4]}
                        label="Loading availability"
                      />
                    ) : availability.length === 0 ? (
                      <EmptyRow colSpan={5} text="No availability windows for this term." />
                    ) : (
                      availability.map((a) => (
                        <tr key={a.id} className="border-b border-[var(--ordiq-border)]/50">
                          <td className="px-3 py-2 font-medium">{titleCase(a.weekday)}</td>
                          <td className="px-3 py-2 text-center font-mono text-[11px]">
                            {formatMinutes(a.startMin)} – {formatMinutes(a.endMin)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={a.status === "AVAILABLE" ? "success" : "danger"}>
                              {titleCase(a.status)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-center text-[11px] text-[var(--ordiq-muted)]">{a.reason || "—"}</td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <RowEditButton label={`${a.weekday} window`} onClick={() => availabilityEditor.openEdit(a)} />
                            <button
                              type="button"
                              className={deleteButtonClass}
                              aria-label={`Delete ${a.weekday} window`}
                              title="Delete window"
                              onClick={() => setPendingDelete({ kind: "availability", item: a })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </>
              )}

              {tab === "qualifications" && (
                <>
                  <thead>
                    <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                      <th className="px-3 py-2 text-left">Subject</th>
                      <th className="px-3 py-2 text-center">Source</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualificationsQuery.isLoading ? (
                      <TableSkeletonRows
                        columns={3}
                        rows={3}
                        align="center"
                        actionColumns={[2]}
                        label="Loading qualifications"
                      />
                    ) : qualifications.length === 0 ? (
                      <EmptyRow colSpan={3} text="No qualifications yet. Without any, the solver cannot assign this faculty member." />
                    ) : (
                      qualifications.map((q) => (
                        <tr key={q.id} className="border-b border-[var(--ordiq-border)]/50">
                          <td className="px-3 py-2">{subjectName(q.subjectCode)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="neutral">{titleCase(q.source)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <RowEditButton label={q.subjectCode} onClick={() => qualificationEditor.openEdit(q)} />
                            <button
                              type="button"
                              className={deleteButtonClass}
                              aria-label={`Delete qualification ${q.subjectCode}`}
                              title="Delete qualification"
                              onClick={() => setPendingDelete({ kind: "qualification", item: q })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </>
              )}

              {tab === "preferences" && (
                <>
                  <thead>
                    <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-center">Value</th>
                      <th className="px-3 py-2 text-center">Weight</th>
                      <th className="px-3 py-2 text-center">Source</th>
                      <th className="px-3 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preferencesQuery.isLoading ? (
                      <TableSkeletonRows
                        columns={5}
                        rows={3}
                        align="center"
                        actionColumns={[4]}
                        label="Loading preferences"
                      />
                    ) : preferences.length === 0 ? (
                      <EmptyRow colSpan={5} text="No preferences for this term." />
                    ) : (
                      preferences.map((p) => (
                        <tr key={p.id} className="border-b border-[var(--ordiq-border)]/50">
                          <td className="px-3 py-2 font-medium">{PREFERENCE_LABELS[p.type]}</td>
                          <td className="px-3 py-2 text-center">{preferenceValueLabel(p)}</td>
                          <td className="px-3 py-2 text-center font-mono text-[11px]">{p.weight}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="neutral">{titleCase(p.source)}</Badge>
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <RowEditButton label={PREFERENCE_LABELS[p.type]} onClick={() => openPreference(p)} />
                            <button
                              type="button"
                              className={deleteButtonClass}
                              aria-label={`Delete ${PREFERENCE_LABELS[p.type]}`}
                              title="Delete preference"
                              onClick={() => setPendingDelete({ kind: "preference", item: p })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </>
              )}
            </table>
          )}
        </div>
      </div>

      <RecordFormDialog
        open={availabilityEditor.state !== null}
        mode={availabilityEditor.state?.mode ?? "create"}
        entityLabel="Availability Window"
        description={`${faculty.name} · ${termCode}`}
        fields={availabilityFields}
        initialValues={availabilityEditor.state?.values}
        onClose={availabilityEditor.close}
        onSubmit={saveAvailability}
      />

      <RecordFormDialog
        open={qualificationEditor.state !== null}
        mode={qualificationEditor.state?.mode ?? "create"}
        entityLabel="Qualification"
        description={faculty.name}
        fields={qualificationFields(subjectOptions)}
        initialValues={qualificationEditor.state?.values}
        onClose={qualificationEditor.close}
        onSubmit={saveQualification}
      />

      <RecordFormDialog
        open={preferenceEditor.state !== null}
        mode={preferenceEditor.state?.mode ?? "create"}
        entityLabel={PREFERENCE_LABELS[editingPreferenceType]}
        description={`${faculty.name} · ${termCode}`}
        fields={preferenceFields(editingPreferenceType, roomOptions)}
        initialValues={preferenceEditor.state?.values}
        onClose={preferenceEditor.close}
        onSubmit={savePreference}
      />

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        isLoading={deleting}
        title="Delete Record?"
        description={
          pendingDelete?.kind === "availability"
            ? `The ${titleCase(pendingDelete.item.weekday)} ${formatMinutes(pendingDelete.item.startMin)} – ${formatMinutes(pendingDelete.item.endMin)} window will be removed.`
            : pendingDelete?.kind === "qualification"
              ? `${faculty.name} will no longer be qualified for ${pendingDelete.item.subjectCode}.`
              : pendingDelete
                ? `The preference "${PREFERENCE_LABELS[pendingDelete.item.type]}: ${preferenceValueLabel(pendingDelete.item)}" will be removed.`
                : ""
        }
        confirmText="Delete"
        variant="danger"
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </div>,
    document.body,
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-xs text-[var(--ordiq-muted)]">
        {text}
      </td>
    </tr>
  );
}
