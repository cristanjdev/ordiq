"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  Cpu,
  Download,
  Filter,
  Plus,
  Search,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchSystemHealth } from "@/features/shell/app-shell";
import { useShell } from "@/features/shell/providers";
import { cn } from "@/lib/utils";

type WorkspaceTab = "faculty" | "courses" | "rooms" | "schedule";

export function DashboardView() {
  const { selectedTerm } = useShell();
  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>("faculty");

  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: fetchSystemHealth,
  });

  const analyticsQuery = useQuery<{
    candidateLabel: string;
    metrics: {
      classesScheduled: number;
      totalMeetings: number;
      scheduledPct: number;
      conflictsDetected: number;
      facultyLoadBalanceScore: number;
      roomUtilizationPct: number;
      unmetPreferencesCount: number;
    };
    studentChangeRequestRisk: {
      totalRiskIndicators: number;
      riskLevel: string;
    };
    manualComparison: {
      manualHardViolations: number;
      currentHardViolations: number;
      hardViolationsEliminated: number;
    } | null;
  }>({
    queryKey: ["dashboard-analytics", selectedTerm.id],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/analytics?termCode=${encodeURIComponent(selectedTerm.id)}`,
      );
      if (!res.ok) throw new Error("Unauthenticated");
      return res.json();
    },
    retry: false,
  });

  const engine = healthQuery.data?.engine;
  const analytics = analyticsQuery.data;

  return (
    <div className="space-y-5">
      {/* Top Heading & Generate Schedule Action (Fig. 4) */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">
              Dashboard
            </h1>
            <Badge variant="default">Candidate Mode · Non-Official</Badge>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            Overview of your scheduling system for{" "}
            <span className="font-semibold text-[var(--ordiq-ink)]">
              {selectedTerm.label}
            </span>
          </p>
        </div>

        <Button variant="default" disabled>
          <Sparkles className="h-4 w-4" />
          Generate Schedule
        </Button>
      </div>

      {/* 4 KPI Summary Cards from Fig. 4 (No fake mockup numbers shown as real data) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ea580c] to-[#7a121b] text-white shadow-xs">
              <CalendarCheck2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--ordiq-muted)]">
                Total Classes Scheduled
              </p>
              <p className="mt-1 text-2xl font-bold text-[var(--ordiq-ink)]">
                {analytics?.metrics.classesScheduled ?? 0}{" "}
                <span className="text-xs font-normal text-[var(--ordiq-muted)]">
                  / {analytics?.metrics.totalMeetings ?? 0} offerings
                </span>
              </p>
              <p className="mt-1 text-[11px] text-[var(--ordiq-muted)]">
                {analytics
                  ? `${analytics.candidateLabel} (${analytics.metrics.scheduledPct}%)`
                  : "Awaiting term workbook import"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#b91c1c] to-[#4a0a0f] text-white shadow-xs">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--ordiq-muted)]">
                Hard Conflicts Detected
              </p>
              <p className="mt-1 text-2xl font-bold text-[var(--ordiq-ink)]">
                {analytics?.metrics.conflictsDetected ?? 0}
              </p>
              <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                {analytics?.manualComparison
                  ? `Eliminated ${analytics.manualComparison.hardViolationsEliminated} baseline conflict(s)`
                  : "Validated by independent Python oracle"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ea580c] to-[#7a121b] text-white shadow-xs">
              <Users className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--ordiq-muted)]">
                Faculty Load Balance
              </p>
              <p className="mt-1 text-2xl font-bold text-[var(--ordiq-ink)]">
                {analytics
                  ? `${analytics.metrics.facultyLoadBalanceScore}%`
                  : "—"}
              </p>
              <p className="mt-1 text-[11px] text-[var(--ordiq-muted)]">
                {analytics
                  ? `${analytics.metrics.unmetPreferencesCount} unmet preference(s)`
                  : "Computed when candidate is loaded"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ea580c] to-[#7a121b] text-white shadow-xs">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-[var(--ordiq-muted)]">
                Room &amp; Lab Utilization
              </p>
              <p className="mt-1 text-2xl font-bold text-[var(--ordiq-ink)]">
                {analytics ? `${analytics.metrics.roomUtilizationPct}%` : "—"}
              </p>
              <p className="mt-1 text-[11px] text-[var(--ordiq-muted)]">
                Lecture (≥40 cap) &amp; Lab (≥30 cap)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Spreadsheet-Based Data Workspace (Fig. 4) */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ordiq-border)] px-4 pt-3">
          {(
            [
              { id: "faculty", label: "Faculty Data", icon: Users },
              {
                id: "courses",
                label: "Courses & Sections",
                icon: BookOpen,
              },
              { id: "rooms", label: "Rooms & Labs", icon: Building2 },
              { id: "schedule", label: "Schedule", icon: CalendarDays },
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
                  "flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition-colors",
                  active
                    ? "border-[var(--ordiq-maroon)] text-[var(--ordiq-maroon)] dark:border-[var(--ordiq-orange)] dark:text-[var(--ordiq-orange)]"
                    : "border-transparent text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)]",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Workspace Toolbar (Add, Import, Export, Search, Filter) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ordiq-border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled>
              <Plus className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Add
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Upload className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Import
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Download className="h-3.5 w-3.5 text-[var(--ordiq-maroon)]" />
              Export
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex h-8 items-center gap-2 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2.5 text-xs">
              <Search className="h-3.5 w-3.5 text-[var(--ordiq-muted)]" />
              <input
                type="search"
                disabled
                placeholder={`Search ${activeTab}...`}
                className="w-44 bg-transparent text-xs focus:outline-none disabled:cursor-not-allowed"
              />
            </div>
            <Button variant="outline" size="sm" disabled aria-label="Filter records">
              <Filter className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Spreadsheet Table Structure (Fig. 4 columns) */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[11px] font-semibold uppercase tracking-wider text-[var(--ordiq-muted)]">
                <th className="px-4 py-2.5">Code</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Employment Type</th>
                <th className="px-4 py-2.5">Max Load (hrs)</th>
                <th className="px-4 py-2.5">Specialization</th>
                <th className="px-4 py-2.5">Availability</th>
                <th className="px-4 py-2.5">Preference</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-xs text-[var(--ordiq-muted)]"
                >
                  No {activeTab} records imported yet for{" "}
                  <span className="font-semibold text-[var(--ordiq-ink)]">
                    {selectedTerm.label}
                  </span>
                  . Editable AG Grid and workbook import pipeline unlock in{" "}
                  <span className="font-semibold">Phase 1 (Secure Data Layer)</span>.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bottom Split: Weekly Schedule Preview + System Analytics & Live Engine Status (Fig. 4) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4 text-[var(--ordiq-maroon)]" />
                Weekly Schedule Preview
              </CardTitle>
              <CardDescription>
                30-minute time slot grid (Monday–Saturday) · Section-level counts only
              </CardDescription>
            </div>
            <Badge variant="neutral">All Sections</Badge>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-dashed border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/60 p-8 text-center text-xs text-[var(--ordiq-muted)]">
              No candidate schedule selected. Generate or import a schedule to
              inspect the weekly timetable by section, faculty, or room.
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-[var(--ordiq-maroon)]" />
              Engine &amp; System Readiness
            </CardTitle>
            <CardDescription>
              Live status from typed client{" "}
              <code className="font-mono text-[11px]">GET /api/v1/health</code>{" "}
              → Python{" "}
              <code className="font-mono text-[11px]">GET /healthz</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3.5 py-2.5">
              <span className="font-medium">Python Optimization Engine</span>
              {engine?.connected ? (
                <Badge variant="success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected (v{engine.version})
                </Badge>
              ) : (
                <Badge variant="warning">
                  Standby ({engine?.errorCode ?? "checking..."})
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Hard Constraints
                </div>
                <div className="mt-1 text-base font-bold">
                  {engine?.hardConstraintCount ?? 15} rules (HC-01–HC-15)
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Soft Objectives
                </div>
                <div className="mt-1 text-base font-bold">
                  {engine?.softConstraintCount ?? 16} rules (SC-01–SC-16)
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Solver Time Limit
                </div>
                <div className="mt-1 text-base font-bold">
                  {engine?.solverTimeLimitSeconds ?? 120}s / candidate
                </div>
              </div>
              <div className="rounded-lg border border-[var(--ordiq-border)] p-3">
                <div className="text-[11px] text-[var(--ordiq-muted)]">
                  Parallel Workers
                </div>
                <div className="mt-1 text-base font-bold">
                  {engine?.solverWorkers ?? 4} CP-SAT threads
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

