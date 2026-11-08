"use client";

import { downloadExcelExport } from "@/lib/excel-export";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarCheck2,
  Download,
  GraduationCap,
  Plus,
  Search,
  Trash2,
  Upload,
  Users2,
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
import {
  offeringFields,
  sectionFields,
  subjectFields,
  toOptions,
} from "@/features/data/record-fields";
import { useCodeOptions, useRecordEditor } from "@/features/data/use-record-editor";
import {
  componentLabel,
  formatHours,
  formatHoursSplit,
  formatMeetingPlan,
  formatUnits,
  meetingPatternLabel,
  ordinalYear,
  roomTypeLabel,
  subjectCategoryLabel,
} from "@/lib/display-labels";
import { ImportWorkbookDialog } from "@/features/data/import-workbook-dialog";
import { useShell } from "@/features/shell/providers";
import { cn } from "@/lib/utils";

export type CurriculumTab = "subjects" | "sections" | "offerings";

export interface SubjectItem {
  id: string;
  code: string;
  name: string;
  description: string;
  programCode: string | null;
  yearLevel: number;
  category:
    | "MAJOR"
    | "GENERAL_ENGINEERING"
    | "MATHEMATICS"
    | "SCIENCE"
    | "GENERAL_EDUCATION"
    | "PATHFIT";
  units: number;
  contactHours: number;
  lectureHours: number;
  labHours: number;
  curriculumVersion: string;
  isCurrentCurriculum: boolean;
}

export interface SectionItem {
  id: string;
  code: string;
  programCode: string;
  yearLevel: number;
  studentCount: number;
}

export interface OfferingItem {
  id: string;
  code: string;
  termCode: string;
  sectionCode: string;
  subjectCode: string;
  component: "LECTURE" | "LAB";
  meetingsPerWeek: number;
  minutesPerMeeting: number;
  meetingPattern: "MWF" | "TTH" | "SINGLE" | "ANY";
  requiredRoomType: "LECTURE" | "LAB";
  preassignedFacultyCode: string | null;
  combinedClassGroup: string | null;
}

export function CurriculumWorkspace() {
  const { selectedTerm } = useShell();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<CurriculumTab>("subjects");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedProgram, setSelectedProgram] = React.useState<string>("ALL");
  const [selectedYear, setSelectedYear] = React.useState<string>("ALL");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [itemToDelete, setItemToDelete] = React.useState<{
    kind: CurriculumTab;
    code: string;
    label: string;
  } | null>(null);
  const subjectEditor = useRecordEditor<SubjectItem>();
  const sectionEditor = useRecordEditor<SectionItem>();
  const offeringEditor = useRecordEditor<OfferingItem>();
  const programOptions = useCodeOptions("programs");
  const facultyOptions = useCodeOptions("faculty");

  // Queries for the 3 curriculum datasets
  const subjectsQuery = useQuery<{ items: SubjectItem[] }>({
    queryKey: ["subjects-data", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/subjects?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: SubjectItem[] };
    },
  });

  const sectionsQuery = useQuery<{ items: SectionItem[] }>({
    queryKey: ["sections-data", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/sections?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: SectionItem[] };
    },
  });

  const offeringsQuery = useQuery<{ items: OfferingItem[] }>({
    queryKey: ["offerings-data", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/offerings?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: OfferingItem[] };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ kind, code }: { kind: CurriculumTab; code: string }) => {
      const res = await fetch(
        `/api/v1/${kind}?code=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `Failed to delete ${code}`);
      }
      return res.json();
    },
    onSuccess: async (_, variables) => {
      setStatusMessage(`Deleted ${variables.kind.slice(0, -1)} record "${variables.code}".`);
      await queryClient.invalidateQueries({ queryKey: [`${variables.kind}-data`] });
      await queryClient.invalidateQueries({ queryKey: ["readiness"] });
      setItemToDelete(null);
    },
    onError: (err) => {
      setStatusMessage(err instanceof Error ? err.message : "Failed to delete record");
      setItemToDelete(null);
    },
  });

  const subjects = subjectsQuery.data?.items ?? [];
  const sections = sectionsQuery.data?.items ?? [];
  const offerings = offeringsQuery.data?.items ?? [];

  const refresh = async (kind: CurriculumTab) => {
    await queryClient.invalidateQueries({ queryKey: [`${kind}-data`] });
    await queryClient.invalidateQueries({ queryKey: ["options", kind] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };

  const duplicate = (label: string) =>
    new ApiRequestError("DUPLICATE", `That ${label} code is already in use.`, [
      { path: ["code"], message: `Already in use by another ${label}.` },
    ]);

  const saveSubject = async (values: FormValues) => {
    const creating = subjectEditor.state?.mode === "create";
    if (creating && subjects.some((s) => s.code === values.code)) throw duplicate("subject");
    const saved = await saveRecord<SubjectItem>("subjects", values);
    setStatusMessage(`${creating ? "Added" : "Updated"} subject "${saved.code}".`);
    subjectEditor.close();
    await refresh("subjects");
  };

  const saveSection = async (values: FormValues) => {
    const creating = sectionEditor.state?.mode === "create";
    if (creating && sections.some((s) => s.code === values.code)) throw duplicate("section");
    const saved = await saveRecord<SectionItem>("sections", values);
    setStatusMessage(`${creating ? "Added" : "Updated"} section "${saved.code}".`);
    sectionEditor.close();
    await refresh("sections");
  };

  const saveOffering = async (values: FormValues) => {
    const creating = offeringEditor.state?.mode === "create";
    const base = `OFF-${selectedTerm.id}-${String(values.sectionCode)}-${String(values.subjectCode)}`;
    const code =
      typeof values.code === "string" && values.code
        ? values.code
        : values.component === "LAB" && offerings.some((o) => o.code === base)
          ? `${base}-LAB`
          : base;
    if (creating && offerings.some((o) => o.code === code)) {
      throw new ApiRequestError("DUPLICATE", "This section already has that subject offering.", [
        { path: ["code"], message: `${code} already exists.` },
      ]);
    }
    const saved = await saveRecord<OfferingItem>("offerings", {
      ...values,
      code,
      termCode: offeringEditor.state?.original?.termCode ?? selectedTerm.id,
    });
    setStatusMessage(`${creating ? "Added" : "Updated"} offering "${saved.code}".`);
    offeringEditor.close();
    await refresh("offerings");
  };

  const openCreate = () => {
    if (activeTab === "subjects") {
      subjectEditor.openCreate({
        programCode: null,
        category: "MAJOR",
        yearLevel: 1,
        units: 3,
        lectureHours: 3,
        labHours: 0,
        contactHours: 3,
        curriculumVersion: "2024",
        isCurrentCurriculum: true,
        description: "",
      });
    } else if (activeTab === "sections") {
      sectionEditor.openCreate({ yearLevel: 1, studentCount: 40 });
    } else {
      offeringEditor.openCreate({
        component: "LECTURE",
        requiredRoomType: "LECTURE",
        meetingsPerWeek: 2,
        minutesPerMeeting: 90,
        meetingPattern: "ANY",
        preassignedFacultyCode: null,
        combinedClassGroup: null,
      });
    }
  };

  // Compute Curriculum KPIs
  const totalSubjects = subjects.length;
  const totalSections = sections.length;
  const totalStudents = sections.reduce((acc, s) => acc + (s.studentCount || 0), 0);
  const totalOfferings = offerings.length;

  // Filtered Items based on active tab
  const filteredSubjects = subjects.filter((subj) => {
    if (selectedProgram !== "ALL" && subj.programCode !== selectedProgram) return false;
    if (selectedYear !== "ALL" && String(subj.yearLevel) !== selectedYear) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      subj.code.toLowerCase().includes(q) ||
      subj.name.toLowerCase().includes(q) ||
      subjectCategoryLabel(subj.category).toLowerCase().includes(q) ||
      (subj.programCode ?? "").toLowerCase().includes(q)
    );
  });

  const filteredSections = sections.filter((sec) => {
    if (selectedProgram !== "ALL" && sec.programCode !== selectedProgram) return false;
    if (selectedYear !== "ALL" && String(sec.yearLevel) !== selectedYear) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      sec.code.toLowerCase().includes(q) ||
      sec.programCode.toLowerCase().includes(q)
    );
  });

  const filteredOfferings = offerings.filter((off) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      off.code.toLowerCase().includes(q) ||
      off.subjectCode.toLowerCase().includes(q) ||
      off.sectionCode.toLowerCase().includes(q) ||
      componentLabel(off.component).toLowerCase().includes(q)
    );
  });

  const subjectsPagination = usePagination(filteredSubjects, 15);
  const sectionsPagination = usePagination(filteredSections, 15);
  const offeringsPagination = usePagination(filteredOfferings, 15);

  const handleExportExcel = () => {
    const data = activeTab === "subjects" ? {
      headers: ["Code", "Name", "Program", "Year", "Category", "Units", "Lecture Hours", "Laboratory Hours", "Curriculum"],
      rows: subjects.map((s) => [s.code, s.name, s.programCode ?? "All programs", s.yearLevel,
        subjectCategoryLabel(s.category), s.units, s.lectureHours, s.labHours, s.curriculumVersion]),
    } : activeTab === "sections" ? {
      headers: ["Code", "Program", "Year", "Students"],
      rows: sections.map((s) => [s.code, s.programCode, s.yearLevel, s.studentCount]),
    } : {
      headers: ["Code", "Term", "Section", "Subject", "Component", "Meetings per Week", "Minutes per Meeting", "Days", "Room Type", "Pre-assigned Faculty"],
      rows: offerings.map((o) => [o.code, o.termCode, o.sectionCode, o.subjectCode,
        componentLabel(o.component), o.meetingsPerWeek, o.minutesPerMeeting,
        meetingPatternLabel(o.meetingPattern), roomTypeLabel(o.requiredRoomType),
        o.preassignedFacultyCode ?? "Solver chooses"]),
    };
    return downloadExcelExport({ fileName: `mseuf-${activeTab}-${selectedTerm.id}.xlsx`,
      sheetName: activeTab, ...data });
  };

  const programs = Array.from(
    new Set([
      ...subjects.map((s) => s.programCode),
      ...sections.map((s) => s.programCode),
    ].filter(Boolean)),
  ).sort() as string[];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
          Curriculum, Sections & Course Offerings
        </h1>
        <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
          Manage engineering degree subjects, student section cohorts, and semester course offerings for schedule allocation.
        </p>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* Curriculum KPIs (Dedicated to Academic Curriculum) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Curriculum Subjects
              </span>
              <BookOpen className="h-4 w-4 text-[var(--ordiq-maroon)]" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalSubjects}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              2024 Engineering syllabus
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Active Sections
              </span>
              <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalSections}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Across 7 degree programs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Total Enrolled Students
              </span>
              <Users2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalStudents}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Aggregate section counts only
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Term Course Offerings
              </span>
              <CalendarCheck2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalOfferings}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Lecture & lab class targets
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Curriculum Sub-Views Table */}
      <Card className="overflow-hidden">
        {/* Top Tab Strip (Full Width Responsive Tab Design) */}
        <div className="p-2 sm:p-2.5 bg-[var(--ordiq-surface-muted)]/70">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 sm:gap-2 w-full">
            {(
              [
                { id: "subjects", label: "Subjects Catalog", icon: BookOpen, count: totalSubjects },
                { id: "sections", label: "Student Sections", icon: GraduationCap, count: totalSections },
                { id: "offerings", label: "Course Offerings", icon: CalendarCheck2, count: totalOfferings },
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
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar: Add, Import, Export, Search, Filters */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between p-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openCreate}
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
              onClick={handleExportExcel}
              className="border-[var(--ordiq-border)] text-xs font-semibold hover:border-[var(--ordiq-maroon)]"
            >
              <Download className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <span>Export</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeTab}...`}
                className="w-44 sm:w-56 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
              />
            </div>

            {/* Department Filter (for subjects and sections) */}
            {activeTab !== "offerings" && (
              <select
                value={selectedProgram}
                onChange={(e) => setSelectedProgram(e.target.value)}
                className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
                aria-label="Filter by Program"
              >
                <option value="ALL">All Departments</option>
                {programs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}

            {/* Year Level Filter */}
            {activeTab !== "offerings" && (
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
                aria-label="Filter by Year Level"
              >
                <option value="ALL">All Year Levels</option>
                <option value="1">1st Year</option>
                <option value="2">2nd Year</option>
                <option value="3">3rd Year</option>
                <option value="4">4th Year</option>
              </select>
            )}
          </div>
        </div>

        {/* Tab 1: Subjects View */}
        {activeTab === "subjects" && (
          <div>
            <TableRefreshBar active={subjectsQuery.isFetching && !subjectsQuery.isLoading} />
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[860px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Course Code & Title</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Program</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Year</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Category</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Units</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Weekly Hours</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Curriculum</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectsQuery.isLoading ? (
                    <TableSkeletonRows
                      columns={8}
                      rows={skeletonRowCount(subjectsPagination.pageSize)}
                      actionColumns={[7]}
                      label="Loading subjects"
                    />
                  ) : filteredSubjects.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]"
                      >
                        {subjectsQuery.isError
                          ? "Sign in with the Dean account (/login) to view subjects."
                          : totalSubjects === 0
                            ? 'No subjects yet. Use "Add" or "Import" above.'
                            : "No subjects match your filter criteria."}
                      </td>
                    </tr>
                  ) : (
                    subjectsPagination.paginatedItems.map((subject) => (
                    <tr
                      key={subject.code}
                      className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-left">
                        <div className="font-semibold text-[var(--ordiq-ink)]">
                          {subject.code}
                        </div>
                        <div className="text-[11px] text-[var(--ordiq-muted)]">
                          {subject.name}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant="neutral" className="font-semibold">
                          {subject.programCode ?? "All programs"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {ordinalYear(subject.yearLevel)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge
                          variant={
                            subject.category === "MAJOR"
                              ? "default"
                              : "neutral"
                          }
                        >
                          {subjectCategoryLabel(subject.category)}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center font-semibold whitespace-nowrap">
                        {formatUnits(subject.units)}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <div className="text-[var(--ordiq-ink)]">
                          {formatHoursSplit(subject.lectureHours, subject.labHours)}
                        </div>
                        {subject.contactHours !== subject.lectureHours + subject.labHours ||
                        (subject.lectureHours > 0 && subject.labHours > 0) ? (
                          <div className="text-[10px] text-[var(--ordiq-muted)]">
                            {formatHours(subject.contactHours)} of class per week
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <span className="text-[11px] text-[var(--ordiq-muted)]">
                          {subject.curriculumVersion} curriculum
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <RowEditButton label={subject.code} onClick={() => subjectEditor.openEdit(subject)} />
                        <button
                          type="button"
                          onClick={() =>
                            setItemToDelete({
                              kind: "subjects",
                              code: subject.code,
                              label: `${subject.code} - ${subject.name}`,
                            })
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                          title={`Delete ${subject.code}`}
                          aria-label={`Delete ${subject.code}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={subjectsPagination.currentPage}
            pageSize={subjectsPagination.pageSize}
            totalItems={subjectsPagination.totalItems}
            onPageChange={subjectsPagination.setCurrentPage}
            onPageSizeChange={subjectsPagination.setPageSize}
            pageSizeOptions={[5, 10, 15, 20, 50]}
            itemLabel="subjects"
          />
        </div>
        )}

        {/* Tab 2: Sections View */}
        {activeTab === "sections" && (
          <div>
            <TableRefreshBar active={sectionsQuery.isFetching && !sectionsQuery.isLoading} />
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[700px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Section Code</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Program</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Year Level</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Enrolled Students</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Capacity Standard</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionsQuery.isLoading ? (
                    <TableSkeletonRows
                      columns={6}
                      rows={skeletonRowCount(sectionsPagination.pageSize)}
                      actionColumns={[5]}
                      label="Loading sections"
                    />
                  ) : filteredSections.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]"
                      >
                        {sectionsQuery.isError
                          ? "Sign in with the Dean account (/login) to view sections."
                          : totalSections === 0
                            ? 'No student sections yet. Use "Add" or "Import" above.'
                            : "No sections match your filter criteria."}
                      </td>
                    </tr>
                  ) : (
                    sectionsPagination.paginatedItems.map((section) => (
                    <tr
                      key={section.code}
                      className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-left font-bold text-[var(--ordiq-ink)]">
                        {section.code}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge variant="neutral" className="font-semibold">
                          {section.programCode}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {ordinalYear(section.yearLevel)}
                      </td>
                      <td className="px-4 py-2.5 text-center font-bold text-[var(--ordiq-ink)]">
                        <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                          {section.studentCount} students
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-[var(--ordiq-muted)]">
                        {section.studentCount <= 40
                          ? "Within the 40-student limit"
                          : "Over 40 students (consider splitting)"}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <RowEditButton label={section.code} onClick={() => sectionEditor.openEdit(section)} />
                        <button
                          type="button"
                          onClick={() =>
                            setItemToDelete({
                              kind: "sections",
                              code: section.code,
                              label: `Section ${section.code}`,
                            })
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                          title={`Delete ${section.code}`}
                          aria-label={`Delete ${section.code}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={sectionsPagination.currentPage}
            pageSize={sectionsPagination.pageSize}
            totalItems={sectionsPagination.totalItems}
            onPageChange={sectionsPagination.setCurrentPage}
            onPageSizeChange={sectionsPagination.setPageSize}
            pageSizeOptions={[5, 10, 15, 20, 50]}
            itemLabel="sections"
          />
        </div>
        )}

        {/* Tab 3: Offerings View */}
        {activeTab === "offerings" && (
          <div>
            <TableRefreshBar active={offeringsQuery.isFetching && !offeringsQuery.isLoading} />
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full min-w-[920px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                    <th className="px-4 py-2.5 text-left whitespace-nowrap">Offering Identifier</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Target Section</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Subject</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Component</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Meeting Pattern</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Room Requirement</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Preassigned Faculty</th>
                    <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {offeringsQuery.isLoading ? (
                    <TableSkeletonRows
                      columns={8}
                      rows={skeletonRowCount(offeringsPagination.pageSize)}
                      actionColumns={[7]}
                      label="Loading course offerings"
                    />
                  ) : filteredOfferings.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]"
                      >
                        {offeringsQuery.isError
                          ? "Sign in with the Dean account (/login) to view course offerings."
                          : totalOfferings === 0
                            ? 'No course offerings yet. Use "Add" or "Import" above.'
                            : "No offerings match your search query."}
                      </td>
                    </tr>
                  ) : (
                    offeringsPagination.paginatedItems.map((offering) => (
                      <tr
                        key={offering.code}
                        className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors"
                      >
                        <td className="px-4 py-2.5 text-left font-mono text-[11px] font-semibold text-[var(--ordiq-ink)]">
                          {offering.code}
                        </td>
                        <td className="px-4 py-2.5 text-center font-bold">
                          {offering.sectionCode}
                        </td>
                        <td className="px-4 py-2.5 text-center font-semibold">
                          {offering.subjectCode}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge
                            variant={
                              offering.component === "LAB"
                                ? "warning"
                                : "neutral"
                            }
                          >
                            {componentLabel(offering.component)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {formatMeetingPlan(offering.meetingPattern, offering.meetingsPerWeek, offering.minutesPerMeeting)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge variant="neutral">
                            {roomTypeLabel(offering.requiredRoomType)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-[11px]">
                          {offering.preassignedFacultyCode ?? "Solver chooses"}
                        </td>
                        <td className="px-4 py-2.5 text-center whitespace-nowrap">
                          <RowEditButton label={offering.code} onClick={() => offeringEditor.openEdit(offering)} />
                          <button
                            type="button"
                            onClick={() =>
                              setItemToDelete({
                                kind: "offerings",
                                code: offering.code,
                                label: `Offering ${offering.code}`,
                              })
                            }
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                            title={`Delete ${offering.code}`}
                            aria-label={`Delete ${offering.code}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination
              currentPage={offeringsPagination.currentPage}
              pageSize={offeringsPagination.pageSize}
              totalItems={offeringsPagination.totalItems}
              onPageChange={offeringsPagination.setCurrentPage}
              onPageSizeChange={offeringsPagination.setPageSize}
              pageSizeOptions={[5, 10, 15, 20, 50]}
              itemLabel="offerings"
            />
          </div>
        )}
      </Card>

      <ImportWorkbookDialog
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        termCode={selectedTerm.id}
        title={activeTab === "subjects" ? "Import Subjects" : activeTab === "sections" ? "Import Sections" : "Import Offerings"}
        templateScope={activeTab}
        onImported={async (summary) => {
          await queryClient.invalidateQueries({ queryKey: ["subjects-data"] });
          await queryClient.invalidateQueries({ queryKey: ["sections-data"] });
          await queryClient.invalidateQueries({ queryKey: ["offerings-data"] });
          await queryClient.invalidateQueries({ queryKey: ["fixed-blocks-data"] });
          await queryClient.invalidateQueries({ queryKey: ["programs-data"] });
          await queryClient.invalidateQueries({ queryKey: ["options"] });
          await queryClient.invalidateQueries({ queryKey: ["readiness"] });
          setStatusMessage(
            summary.alreadyCommitted
              ? "This workbook was already imported; no changes were made."
              : `Imported ${summary.rowCount} rows from the workbook.`,
          );
        }}
      />

      <RecordFormDialog
        open={subjectEditor.state !== null}
        mode={subjectEditor.state?.mode ?? "create"}
        entityLabel="Subject"
        fields={subjectFields(programOptions)}
        initialValues={subjectEditor.state?.values}
        onClose={subjectEditor.close}
        onSubmit={saveSubject}
      />
      <RecordFormDialog
        open={sectionEditor.state !== null}
        mode={sectionEditor.state?.mode ?? "create"}
        entityLabel="Section"
        fields={sectionFields(programOptions)}
        initialValues={sectionEditor.state?.values}
        onClose={sectionEditor.close}
        onSubmit={saveSection}
      />
      <RecordFormDialog
        open={offeringEditor.state !== null}
        mode={offeringEditor.state?.mode ?? "create"}
        entityLabel="Offering"
        description={`Class offered in ${selectedTerm.label}. The solver assigns the day, time, room and (unless pre-assigned) the faculty member.`}
        fields={offeringFields({
          sections: toOptions(sections),
          subjects: toOptions(subjects),
          faculty: facultyOptions,
        })}
        initialValues={offeringEditor.state?.values}
        onClose={offeringEditor.close}
        onSubmit={saveOffering}
      />

      {/* Confirmation Modal: Delete Record */}
      <ConfirmationModal
        isOpen={itemToDelete !== null}
        onClose={() => setItemToDelete(null)}
        onConfirm={async () => {
          if (!itemToDelete) return;
          await deleteMutation.mutateAsync({
            kind: itemToDelete.kind,
            code: itemToDelete.code,
          });
        }}
        title={`Delete ${itemToDelete?.kind.slice(0, -1)}?`}
        description={`Are you sure you want to delete "${itemToDelete?.label}"? This will trigger an automatic schedule re-check.`}
        confirmText="Delete Record"
        variant="danger"
        isLoading={deleteMutation.isPending}
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </div>
  );
}
