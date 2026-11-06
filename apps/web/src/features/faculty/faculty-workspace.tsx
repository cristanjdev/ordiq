"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Download,
  Filter,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  Users,
} from "lucide-react";
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
import { ApiRequestError, saveRecord } from "@/features/data/record-api";
import { titleCase } from "@/lib/display-labels";
import { EMPLOYMENT_TYPE_LABELS, facultyFields } from "@/features/data/record-fields";
import { useCodeOptions, useRecordEditor } from "@/features/data/use-record-editor";
import { ImportWorkbookDialog } from "@/features/data/import-workbook-dialog";
import { useShell } from "@/features/shell/providers";
import { FacultyDetailsPanel } from "./faculty-details-panel";

export interface FacultyItem {
  id: string;
  code: string;
  alias: string;
  name: string;
  programCode: string | null;
  employmentType:
    | "FULL_TIME_PERMANENT"
    | "FULL_TIME_NON_PERMANENT"
    | "PART_TIME"
    | "VISITING";
  specialization: string;
  education: string;
  maxLoadUnits: number;
  maxLoadHours: number;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
}

function formatEmploymentType(type: FacultyItem["employmentType"]): {
  label: string;
  variant: "default" | "neutral" | "orange" | "success" | "warning";
} {
  switch (type) {
    case "FULL_TIME_PERMANENT":
      return { label: "Full-Time (Perm)", variant: "success" };
    case "FULL_TIME_NON_PERMANENT":
      return { label: "Full-Time (Contract)", variant: "orange" };
    case "PART_TIME":
      return { label: "Part-Time", variant: "warning" };
    case "VISITING":
      return { label: "Visiting", variant: "neutral" };
    default:
      return { label: type, variant: "neutral" };
  }
}

/** Next free FAC-### code. */
function nextFacultyCode(list: FacultyItem[]): string {
  const max = list.reduce((m, f) => {
    const n = /^FAC-(\d+)$/.exec(f.code)?.[1];
    return n ? Math.max(m, Number(n)) : m;
  }, 0);
  return `FAC-${String(max + 1).padStart(3, "0")}`;
}

export function FacultyWorkspace() {
  const { selectedTerm } = useShell();
  const queryClient = useQueryClient();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedProgram, setSelectedProgram] = React.useState<string>("ALL");
  const [selectedType, setSelectedType] = React.useState<string>("ALL");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  // Modal states
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [facultyToDelete, setFacultyToDelete] = React.useState<FacultyItem | null>(null);
  const [detailsFor, setDetailsFor] = React.useState<FacultyItem | null>(null);
  const editor = useRecordEditor<FacultyItem>();
  const programOptions = useCodeOptions("programs");

  // Fetch faculty records
  const facultyQuery = useQuery<{ items: FacultyItem[] }>({
    queryKey: ["faculty-data", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/faculty?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: FacultyItem[] };
    },
  });

  const saveFaculty = async (values: FormValues) => {
    const creating = editor.state?.mode === "create";
    if (creating && facultyQuery.data?.items.some((f) => f.code === values.code)) {
      throw new ApiRequestError("DUPLICATE", "That faculty code is already in use.", [
        { path: ["code"], message: "Already in use by another faculty member." },
      ]);
    }
    const saved = await saveRecord<FacultyItem>("faculty", values);
    setStatusMessage(`${creating ? "Added" : "Updated"} faculty record "${saved.name}".`);
    editor.close();
    await queryClient.invalidateQueries({ queryKey: ["faculty-data"] });
    await queryClient.invalidateQueries({ queryKey: ["options", "faculty"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };

  const deleteFacultyMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(
        `/api/v1/faculty?code=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `Failed to delete ${code}`);
      }
      return res.json();
    },
    onSuccess: async (_, code) => {
      setStatusMessage(`Deleted faculty member record "${code}".`);
      await queryClient.invalidateQueries({ queryKey: ["faculty-data"] });
      await queryClient.invalidateQueries({ queryKey: ["readiness"] });
      setFacultyToDelete(null);
    },
    onError: (err) => {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to delete record",
      );
      setFacultyToDelete(null);
    },
  });

  const facultyList = facultyQuery.data?.items ?? [];

  // Compute Faculty Domain KPIs
  const totalFaculty = facultyList.length;
  const fullTimeCount = facultyList.filter(
    (f) =>
      f.employmentType === "FULL_TIME_PERMANENT" ||
      f.employmentType === "FULL_TIME_NON_PERMANENT",
  ).length;
  const permanentCount = facultyList.filter(
    (f) => f.employmentType === "FULL_TIME_PERMANENT",
  ).length;
  const partTimeCount = facultyList.filter(
    (f) => f.employmentType === "PART_TIME" || f.employmentType === "VISITING",
  ).length;
  const activeCount = facultyList.filter((f) => f.status === "ACTIVE").length;

  // Filtered List
  const filteredFaculty = facultyList.filter((faculty) => {
    if (selectedProgram !== "ALL" && faculty.programCode !== selectedProgram) {
      return false;
    }
    if (selectedType !== "ALL" && faculty.employmentType !== selectedType) {
      return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      faculty.name.toLowerCase().includes(q) ||
      faculty.code.toLowerCase().includes(q) ||
      faculty.alias.toLowerCase().includes(q) ||
      faculty.specialization.toLowerCase().includes(q) ||
      faculty.education.toLowerCase().includes(q) ||
      (faculty.programCode ?? "").toLowerCase().includes(q)
    );
  });

  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    paginatedItems: paginatedFaculty,
    totalItems: totalFilteredFaculty,
  } = usePagination(filteredFaculty, 15);

  const programs = Array.from(
    new Set(facultyList.map((f) => f.programCode).filter(Boolean)),
  ).sort() as string[];

  // Export to CSV
  const handleExportCsv = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Code,Alias,Name,Program,Type,Teaching Load (Units),Teaching Load (Hours),Specialization,Education,Status\n";
    facultyList.forEach((f) => {
      csvContent += `"${f.code}","${f.alias}","${f.name}","${f.programCode ?? "General"}","${EMPLOYMENT_TYPE_LABELS[f.employmentType] ?? titleCase(f.employmentType)}",${f.maxLoadUnits},${f.maxLoadHours},"${f.specialization}","${f.education}","${titleCase(f.status)}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mseuf-faculty-export-${selectedTerm.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
          Faculty Directory & Teaching Load
        </h1>
        <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
          Manage MSEUF College of Engineering faculty, academic ranks, department assignments, teaching load limits, and AI-safe pseudonym aliases.
        </p>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* Domain KPI Cards (Dedicated to Faculty) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Total Engineering Faculty
              </span>
              <Users className="h-4 w-4 text-[var(--ordiq-maroon)]" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalFaculty}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Across 7 engineering departments
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Full-Time Faculty
              </span>
              <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {fullTimeCount}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              {permanentCount} Permanent, {fullTimeCount - permanentCount} Contractual
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Part-Time & Visiting
              </span>
              <Filter className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {partTimeCount}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Max load 12 units (CHED compliance)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Active & AI-Anonymized
              </span>
              <ShieldCheck className="h-4 w-4 text-[var(--ordiq-maroon)]" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {activeCount}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              100% mapped to pseudonym aliases
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Container Card */}
      <Card>
        {/* Toolbar: + Add, Import, Export, Search, Filters */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between p-3.5">
          {/* Left Action Buttons (Dashboard consistent style) */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                editor.openCreate({
                  code: nextFacultyCode(facultyList),
                  programCode: null,
                  employmentType: "FULL_TIME_PERMANENT",
                  status: "ACTIVE",
                  maxLoadUnits: 21,
                  maxLoadHours: 24,
                })
              }
              className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)] hover:text-[var(--ordiq-maroon)]"
            >
              <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              <span>Add</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImportModal(true)}
              className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)]"
            >
              <Upload className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <span>Import</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)]"
            >
              <Download className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <span>Export</span>
            </Button>
          </div>

          {/* Right Search & Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search faculty..."
                className="w-48 sm:w-56 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
              />
            </div>

            {/* Department Filter */}
            <select
              value={selectedProgram}
              onChange={(e) => setSelectedProgram(e.target.value)}
              className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
              aria-label="Filter by Program"
            >
              <option value="ALL">All Departments</option>
              {programs.map((p) => (
                <option key={p} value={p}>
                  {p} Engineering
                </option>
              ))}
            </select>

            {/* Employment Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
              aria-label="Filter by Employment Type"
            >
              <option value="ALL">All Employment Types</option>
              <option value="FULL_TIME_PERMANENT">Full-Time Permanent</option>
              <option value="FULL_TIME_NON_PERMANENT">Full-Time Contractual</option>
              <option value="PART_TIME">Part-Time</option>
              <option value="VISITING">Visiting Lecturer</option>
            </select>
          </div>
        </div>

        {/* Table Content (Original Faculty Table Columns) */}
        <TableRefreshBar active={facultyQuery.isFetching && !facultyQuery.isLoading} />
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[880px] border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Faculty Member</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">AI Alias</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Department</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Employment Type</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Specialization & Education</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Max Load</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {facultyQuery.isLoading ? (
                <TableSkeletonRows
                  columns={8}
                  rows={skeletonRowCount(pageSize)}
                  actionColumns={[7]}
                  label="Loading faculty"
                />
              ) : filteredFaculty.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]"
                  >
                    {facultyQuery.isError
                      ? "Sign in with the Dean account and TOTP code (/login) to view or manage faculty records."
                      : totalFaculty === 0
                        ? 'No faculty records yet. Use "Add" or "Import" above to build the college directory.'
                        : "No faculty members match the current search and filter criteria."}
                  </td>
                </tr>
              ) : (
                paginatedFaculty.map((faculty) => {
                  const empType = formatEmploymentType(faculty.employmentType);
                  return (
                    <tr
                      key={faculty.code}
                      className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-left whitespace-nowrap">
                        <div className="font-semibold text-[var(--ordiq-ink)]">
                          {faculty.name}
                        </div>
                        <div className="font-mono text-[10px] text-[var(--ordiq-muted)]">
                          {faculty.code}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span
                          className="inline-block rounded border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ordiq-ink)]"
                          title="Anonymized token forwarded to LLM for zero-knowledge schedule optimization under RA 10173."
                        >
                          {faculty.alias}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge variant="neutral" className="font-semibold">
                          {faculty.programCode ?? "GEN"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge variant={empType.variant}>
                          {empType.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center min-w-[200px]">
                        <div className="text-[var(--ordiq-ink)]">
                          {faculty.specialization}
                        </div>
                        <div className="text-[11px] text-[var(--ordiq-muted)]">
                          {faculty.education}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <div className="font-semibold text-[var(--ordiq-ink)]">
                          {faculty.maxLoadUnits} units
                        </div>
                        <div className="text-[10px] text-[var(--ordiq-muted)]">
                          {faculty.maxLoadHours} hrs / wk
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge
                          variant={
                            faculty.status === "ACTIVE"
                              ? "success"
                              : faculty.status === "ON_LEAVE"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {faculty.status === "ACTIVE"
                            ? "Active"
                            : faculty.status === "ON_LEAVE"
                              ? "On Leave"
                              : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDetailsFor(faculty)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] transition-colors hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-maroon)]"
                          title={`Availability, qualifications and preferences of ${faculty.name}`}
                          aria-label={`Open details for ${faculty.name}`}
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                        </button>
                        <RowEditButton label={faculty.name} onClick={() => editor.openEdit(faculty)} />
                        <button
                          type="button"
                          onClick={() => setFacultyToDelete(faculty)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                          title={`Delete ${faculty.name}`}
                          aria-label={`Delete ${faculty.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          currentPage={currentPage}
          pageSize={pageSize}
          totalItems={totalFilteredFaculty}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[5, 10, 15, 20, 50]}
          itemLabel="faculty members"
        />
      </Card>

      {detailsFor && (
        <FacultyDetailsPanel
          faculty={detailsFor}
          termCode={selectedTerm.id}
          onClose={() => setDetailsFor(null)}
        />
      )}

      <RecordFormDialog
        open={editor.state !== null}
        mode={editor.state?.mode ?? "create"}
        entityLabel="Faculty Member"
        description="Load limits are checked by the solver (HC-07). Status On Leave or Inactive keeps the member out of new schedules."
        fields={facultyFields(programOptions)}
        initialValues={editor.state?.values}
        onClose={editor.close}
        onSubmit={saveFaculty}
      />

      {/* Import workbook (checked first, then imported) */}
      <ImportWorkbookDialog
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        termCode={selectedTerm.id}
        title="Import Faculty Workbook (.xlsx)"
        sheetsHint={["Faculty", "FacultyAvailability", "FacultyQualifications", "FacultyPreferences"]}
        onImported={async (summary) => {
          await queryClient.invalidateQueries({ queryKey: ["faculty-data"] });
          await queryClient.invalidateQueries({ queryKey: ["faculty-availability"] });
          await queryClient.invalidateQueries({ queryKey: ["faculty-qualifications"] });
          await queryClient.invalidateQueries({ queryKey: ["faculty-preferences"] });
          await queryClient.invalidateQueries({ queryKey: ["options"] });
          await queryClient.invalidateQueries({ queryKey: ["readiness"] });
          setStatusMessage(
            summary.alreadyCommitted
              ? "This workbook was already imported; no changes were made."
              : `Imported ${summary.rowCount} rows from the workbook.`,
          );
        }}
      />

      {/* Confirmation Modal: Single Delete Record */}
      <ConfirmationModal
        isOpen={facultyToDelete !== null}
        onClose={() => setFacultyToDelete(null)}
        onConfirm={async () => {
          if (!facultyToDelete) return;
          await deleteFacultyMutation.mutateAsync(facultyToDelete.code);
        }}
        title="Delete Faculty Member?"
        description={`Are you sure you want to delete "${facultyToDelete?.name}" (${facultyToDelete?.code})? This will remove them from the active semester and trigger an automatic schedule re-check.`}
        confirmText="Delete Faculty"
        variant="danger"
        isLoading={deleteFacultyMutation.isPending}
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </div>
  );
}
