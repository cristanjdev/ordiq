"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Download,
  FlaskConical,
  GraduationCap,
  Plus,
  Search,
  Trash2,
  Upload,
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
import { roomTypeLabel, titleCase } from "@/lib/display-labels";
import { roomFields } from "@/features/data/record-fields";
import { useRecordEditor } from "@/features/data/use-record-editor";
import { ImportWorkbookDialog } from "@/features/data/import-workbook-dialog";
import { useShell } from "@/features/shell/providers";

export interface RoomItem {
  id: string;
  code: string;
  name: string;
  type: "LECTURE" | "LAB";
  capacity: number;
  equipment: string[];
  restrictions: string;
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
}

export function RoomsWorkspace() {
  const { selectedTerm } = useShell();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedType, setSelectedType] = React.useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = React.useState<string>("ALL");
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [roomToDelete, setRoomToDelete] = React.useState<RoomItem | null>(null);
  const editor = useRecordEditor<RoomItem>();

  // Fetch rooms
  const roomsQuery = useQuery<{ items: RoomItem[] }>({
    queryKey: ["rooms-data", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/rooms?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Requires active Dean session");
      return (await res.json()) as { items: RoomItem[] };
    },
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(
        `/api/v1/rooms?code=${encodeURIComponent(code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? `Failed to delete ${code}`);
      }
      return res.json();
    },
    onSuccess: async (_, code) => {
      setStatusMessage(`Deleted space "${code}".`);
      await queryClient.invalidateQueries({ queryKey: ["rooms-data"] });
      await queryClient.invalidateQueries({ queryKey: ["readiness"] });
      setRoomToDelete(null);
    },
    onError: (err) => {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to delete room",
      );
      setRoomToDelete(null);
    },
  });

  const rooms = roomsQuery.data?.items ?? [];

  const saveRoom = async (values: FormValues) => {
    const creating = editor.state?.mode === "create";
    if (creating && rooms.some((r) => r.code === values.code)) {
      throw new ApiRequestError("DUPLICATE", "That room code is already in use.", [
        { path: ["code"], message: "Already in use by another room." },
      ]);
    }
    const saved = await saveRecord<RoomItem>("rooms", values);
    setStatusMessage(`${creating ? "Added" : "Updated"} space "${saved.code}".`);
    editor.close();
    await queryClient.invalidateQueries({ queryKey: ["rooms-data"] });
    await queryClient.invalidateQueries({ queryKey: ["options", "rooms"] });
    await queryClient.invalidateQueries({ queryKey: ["readiness"] });
  };

  // Compute Room & Lab KPIs
  const totalRooms = rooms.length;
  const lectureRooms = rooms.filter((r) => r.type === "LECTURE");
  const labRooms = rooms.filter((r) => r.type === "LAB");
  const totalCapacity = rooms.reduce((acc, r) => acc + (r.capacity || 0), 0);

  // Export to CSV
  const handleExportCsv = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Code,Name,Type,Capacity,Equipment,Restrictions,Status\n";
    rooms.forEach((r) => {
      csvContent += `"${r.code}","${r.name}","${roomTypeLabel(r.type)}",${r.capacity},"${r.equipment.join("; ")}","${r.restrictions}","${titleCase(r.status)}"\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mseuf-rooms-${selectedTerm.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered Rooms
  const filteredRooms = rooms.filter((room) => {
    if (selectedType !== "ALL" && room.type !== selectedType) return false;
    if (selectedStatus !== "ALL" && room.status !== selectedStatus) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      room.code.toLowerCase().includes(q) ||
      room.name.toLowerCase().includes(q) ||
      room.restrictions.toLowerCase().includes(q) ||
      room.equipment.some((eq) => eq.toLowerCase().includes(q))
    );
  });

  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    paginatedItems: paginatedRooms,
    totalItems: totalFilteredRooms,
  } = usePagination(filteredRooms, 15);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
          Rooms & Engineering Laboratories
        </h1>
        <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
          Inventory and seating capacity management for MSEUF College of Engineering lecture halls, specialized laboratories, and workstation facilities.
        </p>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {statusMessage}
        </div>
      )}

      {/* Domain KPI Cards (Dedicated to Spaces & Facilities) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Total Campus Spaces
              </span>
              <Building2 className="h-4 w-4 text-[var(--ordiq-maroon)]" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalRooms}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Engineering complex facilities
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Lecture Halls / Rooms
              </span>
              <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {lectureRooms.length}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              All &ge; 40 seats capacity
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Specialized Laboratories
              </span>
              <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {labRooms.length}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              All &ge; 30 workstation seats
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--ordiq-muted)]">
                Total College Seating
              </span>
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="mt-2 text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              {totalCapacity}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
              Total simultaneous seat capacity
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Rooms Directory Table */}
      <Card>
        {/* Toolbar: + Add, Import, Export, Search, Filters */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                editor.openCreate({ type: "LECTURE", capacity: 40, status: "ACTIVE", equipment: [], restrictions: "" })
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

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search room code, name, equipment..."
                className="w-44 sm:w-56 bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
              />
            </div>

            {/* Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
              aria-label="Filter by Space Type"
            >
              <option value="ALL">All Spaces ({totalRooms})</option>
              <option value="LECTURE">Lecture Rooms ({lectureRooms.length})</option>
              <option value="LAB">Laboratories ({labRooms.length})</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)]"
              aria-label="Filter by Status"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        <TableRefreshBar active={roomsQuery.isFetching && !roomsQuery.isLoading} />
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full min-w-[880px] border-collapse text-xs">
            <thead>
              <tr className="bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                <th className="px-4 py-2.5 text-left whitespace-nowrap">Room Code</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Facility Name</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Type</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Seating Capacity</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Installed Equipment</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Department Allocation / Restrictions</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Status</th>
                <th className="px-4 py-2.5 text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roomsQuery.isLoading ? (
                <TableSkeletonRows
                  columns={8}
                  rows={skeletonRowCount(pageSize)}
                  actionColumns={[7]}
                  label="Loading rooms"
                />
              ) : filteredRooms.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-xs text-[var(--ordiq-muted)]"
                  >
                    {roomsQuery.isError
                      ? "Sign in with the Dean account (/login) to view room inventory."
                      : totalRooms === 0
                        ? 'No room records found. Click "Load Room Inventory" above.'
                        : "No spaces match your search criteria."}
                  </td>
                </tr>
              ) : (
                paginatedRooms.map((room) => {
                  const minRequired = room.type === "LECTURE" ? 40 : 30;
                  const isCompliant = room.capacity >= minRequired;
                  return (
                    <tr
                      key={room.code}
                      className="hover:bg-[var(--ordiq-surface-muted)]/60 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-left font-mono text-[11px] font-bold text-[var(--ordiq-ink)] whitespace-nowrap">
                        {room.code}
                      </td>
                      <td className="px-4 py-2.5 text-center font-medium text-[var(--ordiq-ink)] whitespace-nowrap">
                        {room.name}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge
                          variant={room.type === "LAB" ? "warning" : "neutral"}
                        >
                          {room.type === "LAB" ? "Laboratory" : "Lecture Hall"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <div className="font-bold text-[var(--ordiq-ink)]">
                          {room.capacity} seats
                        </div>
                        <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                          {isCompliant && <CheckCircle2 className="h-3 w-3" />}
                          <span>&ge; {minRequired} std</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center min-w-[180px]">
                        <div className="flex flex-wrap justify-center gap-1">
                          {room.equipment.map((eq) => (
                            <span
                              key={eq}
                              className="rounded bg-[var(--ordiq-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ordiq-ink)] whitespace-nowrap"
                            >
                              {eq}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center text-[11px] text-[var(--ordiq-muted)] min-w-[200px]">
                        {room.restrictions || "General College Use"}
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <Badge
                          variant={
                            room.status === "ACTIVE"
                              ? "success"
                              : room.status === "MAINTENANCE"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {room.status === "ACTIVE"
                            ? "Active"
                            : room.status === "MAINTENANCE"
                              ? "Maintenance"
                              : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <RowEditButton label={room.code} onClick={() => editor.openEdit(room)} />
                        <button
                          type="button"
                          onClick={() => setRoomToDelete(room)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                          title={`Delete ${room.code}`}
                          aria-label={`Delete ${room.code}`}
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
          totalItems={totalFilteredRooms}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[5, 10, 15, 20, 50]}
          itemLabel="rooms"
        />
      </Card>

      <ImportWorkbookDialog
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        termCode={selectedTerm.id}
        title="Import Rooms Workbook (.xlsx)"
        sheetsHint={["Rooms"]}
        onImported={async (summary) => {
          await queryClient.invalidateQueries({ queryKey: ["rooms-data"] });
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
        open={editor.state !== null}
        mode={editor.state?.mode ?? "create"}
        entityLabel="Room"
        description="Rooms in Maintenance or Inactive status are not used for new schedules."
        fields={roomFields()}
        initialValues={editor.state?.values}
        onClose={editor.close}
        onSubmit={saveRoom}
      />

      {/* Confirmation Modal: Delete Record */}
      <ConfirmationModal
        isOpen={roomToDelete !== null}
        onClose={() => setRoomToDelete(null)}
        onConfirm={async () => {
          if (!roomToDelete) return;
          await deleteRoomMutation.mutateAsync(roomToDelete.code);
        }}
        title="Delete Space Record?"
        description={`Are you sure you want to delete "${roomToDelete?.name}" (${roomToDelete?.code})? This will trigger an automatic schedule re-check.`}
        confirmText="Delete Space"
        variant="danger"
        isLoading={deleteRoomMutation.isPending}
        icon={<Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />}
      />
    </div>
  );
}
