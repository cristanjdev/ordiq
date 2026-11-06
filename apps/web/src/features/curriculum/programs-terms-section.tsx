"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Landmark, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { programFields, termFields, titleCase } from "@/features/data/record-fields";
import { useRecordEditor } from "@/features/data/use-record-editor";
import { cn } from "@/lib/utils";

interface ProgramItem {
  id: string;
  code: string;
  name: string;
  coordinator: string;
}

interface TermItem {
  id: string;
  code: string;
  academicYear: string;
  semester: 1 | 2;
  status: "DRAFT" | "READY" | "ACTIVE" | "ARCHIVED";
  slotSizeMin: number;
  teachingDays: string[];
  dayStartMin: number;
  dayEndMin: number;
}

type Tab = "programs" | "terms";
type PendingDelete = { kind: "program"; item: ProgramItem } | { kind: "term"; item: TermItem };

const TERM_STATUS_VARIANT = {
  ACTIVE: "success",
  READY: "default",
  DRAFT: "warning",
  ARCHIVED: "neutral",
} as const;

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const displayH = h % 12 === 0 ? 12 : h % 12;
  return `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const deleteButtonClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors";

/** Programs and academic terms: the reference data every other table points to. */
export function ProgramsTermsSection() {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("programs");
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const programEditor = useRecordEditor<ProgramItem>();
  const termEditor = useRecordEditor<TermItem>();

  const programsQuery = useQuery({
    queryKey: ["programs-data"],
    queryFn: () => fetchItems<ProgramItem>("programs"),
  });
  const termsQuery = useQuery({
    queryKey: ["terms-data"],
    queryFn: () => fetchItems<TermItem>("terms"),
  });

  const programs = [...(programsQuery.data ?? [])].sort((a, b) => a.code.localeCompare(b.code));
  const terms = [...(termsQuery.data ?? [])].sort((a, b) => b.code.localeCompare(a.code));

  const refreshPrograms = async () => {
    await queryClient.invalidateQueries({ queryKey: ["programs-data"] });
    await queryClient.invalidateQueries({ queryKey: ["options", "programs"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };
  const refreshTerms = async () => {
    await queryClient.invalidateQueries({ queryKey: ["terms-data"] });
    // The header term picker.
    await queryClient.invalidateQueries({ queryKey: ["terms"] });
  };

  const saveProgram = async (values: FormValues) => {
    if (programEditor.state?.mode === "create" && programs.some((p) => p.code === values.code)) {
      throw Object.assign(new Error("Program code already exists."), {
        issues: [{ path: ["code"], message: "This code is already used." }],
      });
    }
    await saveRecord("programs", values);
    programEditor.close();
    await refreshPrograms();
  };

  const saveTerm = async (values: FormValues) => {
    if (termEditor.state?.mode === "create" && terms.some((t) => t.code === values.code)) {
      throw Object.assign(new Error("Term code already exists."), {
        issues: [{ path: ["code"], message: "This code is already used." }],
      });
    }
    await saveRecord("terms", { ...values, semester: Number(values.semester) });
    termEditor.close();
    await refreshTerms();
  };

  const programsPagination = usePagination(programs, 15);
  const termsPagination = usePagination(terms, 15);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      if (pendingDelete.kind === "program") {
        await deleteRecord("programs", { code: pendingDelete.item.code });
        await refreshPrograms();
      } else {
        await deleteRecord("terms", { code: pendingDelete.item.code });
        await refreshTerms();
      }
    } catch (e) {
      setError(errorMessage(e, "The record could not be deleted."));
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const openCreate = () => {
    setError(null);
    if (tab === "programs") {
      programEditor.openCreate({ code: "", name: "", coordinator: "" });
      return;
    }
    const latest = terms[0];
    const [y1, y2] = (latest?.academicYear ?? "2026-2027").split("-").map(Number);
    const nextSemester = latest?.semester === 1 ? 2 : 1;
    const year =
      latest?.semester === 2 && y1 !== undefined && y2 !== undefined
        ? `${y1 + 1}-${y2 + 1}`
        : (latest?.academicYear ?? "2026-2027");
    termEditor.openCreate({
      code: `AY${year}-S${nextSemester}`,
      academicYear: year,
      semester: String(nextSemester),
      status: "DRAFT",
      dayStartMin: latest?.dayStartMin ?? 450,
      dayEndMin: latest?.dayEndMin ?? 1230,
      slotSizeMin: latest?.slotSizeMin ?? 30,
      teachingDays: latest?.teachingDays ?? ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
    });
  };

  const loadError = tab === "programs" ? programsQuery.isError : termsQuery.isError;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div>
          <h2 className="text-sm font-bold text-[var(--ordiq-ink)]">Programs & Academic Terms</h2>
          <p className="text-[11px] text-[var(--ordiq-muted)]">
            Reference data for sections, subjects and schedules. Terms in use cannot be deleted; archive them instead.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-[var(--ordiq-surface-muted)] p-1">
            {(
              [
                { id: "programs", label: "Programs", icon: Landmark, count: programs.length },
                { id: "terms", label: "Terms", icon: CalendarRange, count: terms.length },
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all",
                    tab === t.id
                      ? "bg-[var(--ordiq-surface)] font-bold text-[var(--ordiq-maroon)] shadow-xs dark:text-[var(--ordiq-orange)]"
                      : "font-medium text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span className="text-[10px] font-bold">{t.count}</span>
                </button>
              );
            })}
          </div>
          <Button variant="outline" size="sm" className="text-xs font-semibold" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
            {tab === "programs" ? "Add Program" : "Add Term"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <TableRefreshBar
        active={(tab === "programs" ? programsQuery : termsQuery).isFetching &&
          !(tab === "programs" ? programsQuery : termsQuery).isLoading}
      />
      <div className="overflow-x-auto no-scrollbar">
        {loadError ? (
          <p className="py-10 text-center text-xs text-[var(--ordiq-muted)]">
            Sign in with the Dean account (/login) to view these records.
          </p>
        ) : tab === "programs" ? (
          <div>
            <table className="w-full min-w-[600px] border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">Code</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Program</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Coordinator</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {programsQuery.isLoading ? (
                  <TableSkeletonRows
                    columns={4}
                    rows={skeletonRowCount(programsPagination.pageSize)}
                    actionColumns={[3]}
                    label="Loading programs"
                  />
                ) : programs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-[var(--ordiq-muted)]">
                      No programs yet.
                    </td>
                  </tr>
                ) : (
                  programsPagination.paginatedItems.map((p) => (
                    <tr key={p.code} className="hover:bg-[var(--ordiq-surface-muted)]/60">
                      <td className="px-4 py-2.5 font-mono font-bold whitespace-nowrap">{p.code}</td>
                      <td className="px-4 py-2.5 text-center font-semibold text-[var(--ordiq-ink)] whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-2.5 text-center text-[var(--ordiq-muted)] whitespace-nowrap">{p.coordinator}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <RowEditButton label={p.name} onClick={() => programEditor.openEdit(p)} />
                        <button
                          type="button"
                          className={deleteButtonClass}
                          title={`Delete ${p.name}`}
                          aria-label={`Delete ${p.name}`}
                          onClick={() => setPendingDelete({ kind: "program", item: p })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              currentPage={programsPagination.currentPage}
              pageSize={programsPagination.pageSize}
              totalItems={programsPagination.totalItems}
              onPageChange={programsPagination.setCurrentPage}
              onPageSizeChange={programsPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20]}
              itemLabel="programs"
            />
          </div>
        ) : (
          <div>
            <table className="w-full min-w-[760px] border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                  <th className="px-4 py-2.5 text-left whitespace-nowrap">Code</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Academic Year</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Semester</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Status</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Teaching Hours</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Days</th>
                  <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {termsQuery.isLoading ? (
                  <TableSkeletonRows
                    columns={7}
                    rows={skeletonRowCount(termsPagination.pageSize)}
                    actionColumns={[6]}
                    label="Loading terms"
                  />
                ) : terms.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-[var(--ordiq-muted)]">
                      No terms yet.
                    </td>
                  </tr>
                ) : (
                  termsPagination.paginatedItems.map((t) => (
                    <tr key={t.code} className="hover:bg-[var(--ordiq-surface-muted)]/60">
                      <td className="px-4 py-2.5 font-mono font-bold whitespace-nowrap">{t.code}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">{t.academicYear}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">{t.semester === 1 ? "1st" : "2nd"}</td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge variant={TERM_STATUS_VARIANT[t.status]}>{titleCase(t.status)}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center font-mono text-[11px] whitespace-nowrap">
                        {formatMinutes(t.dayStartMin)} – {formatMinutes(t.dayEndMin)} · {t.slotSizeMin}m slots
                      </td>
                      <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-muted)] whitespace-nowrap">
                        {t.teachingDays.map((d) => titleCase(d).slice(0, 3)).join(", ")}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <RowEditButton
                          label={t.code}
                          onClick={() => termEditor.openEdit({ ...t, semester: String(t.semester) } as unknown as TermItem)}
                        />
                        <button
                          type="button"
                          className={deleteButtonClass}
                          title={`Delete ${t.code}`}
                          aria-label={`Delete ${t.code}`}
                          onClick={() => setPendingDelete({ kind: "term", item: t })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              currentPage={termsPagination.currentPage}
              pageSize={termsPagination.pageSize}
              totalItems={termsPagination.totalItems}
              onPageChange={termsPagination.setCurrentPage}
              onPageSizeChange={termsPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20]}
              itemLabel="terms"
            />
          </div>
        )}
      </div>

      <RecordFormDialog
        open={programEditor.state !== null}
        mode={programEditor.state?.mode ?? "create"}
        entityLabel="Program"
        fields={programFields()}
        initialValues={programEditor.state?.values}
        onClose={programEditor.close}
        onSubmit={saveProgram}
      />

      <RecordFormDialog
        open={termEditor.state !== null}
        mode={termEditor.state?.mode ?? "create"}
        entityLabel="Term"
        description="Only one term should be Active at a time. Changing teaching hours or days flags the term's schedules for a recheck on the next validation."
        fields={termFields()}
        initialValues={termEditor.state?.values}
        onClose={termEditor.close}
        onSubmit={saveTerm}
      />

      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        isLoading={deleting}
        title={pendingDelete?.kind === "term" ? "Delete Term?" : "Delete Program?"}
        description={
          pendingDelete?.kind === "term"
            ? `Term ${pendingDelete.item.code} will be deleted. Terms that already have offerings, schedules or other records are kept; archive those instead.`
            : pendingDelete
              ? `Program ${pendingDelete.item.code} (${pendingDelete.item.name}) will be deleted. Faculty and subjects in it become unassigned. Programs with sections cannot be deleted.`
              : ""
        }
        confirmText="Delete"
        variant="danger"
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </Card>
  );
}
