"use client";

import {
  AlertTriangle,
  CalendarX2,
  CheckCircle2,
  ClipboardCheck,
  DoorOpen,
  Heart,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { cn } from "@/lib/utils";

/** Shape of GET /api/v1/schedules/evaluation (kept in step with the server service). */
export interface ScheduleEvaluation {
  scheduleId: string;
  candidateLabel: string;
  unsatisfied: {
    conflicts: Array<{ rule: string; description: string }>;
    unscheduled: Array<{
      offeringCode: string;
      subjectCode: string;
      sectionCode: string;
      reason: string;
      detail: string;
    }>;
  };
  risks: {
    facultyLoad: Array<{
      facultyCode: string;
      facultyName: string;
      assignedUnits: number;
      regularMaxUnits: number;
      utilizationPct: number;
      level: "OVER_MAX" | "OVERLOAD";
    }>;
    roomCapacity: Array<{
      roomCode: string;
      seats: number;
      students: number;
      sectionCodes: string[];
      subjectCodes: string[];
    }>;
    waivedExceptions: Array<{ rule: string; reason: string; occurrences: number }>;
    unmetFacultyPreferences: Array<{ facultyCode: string | null; description: string }>;
  };
  counts: { unsatisfied: number; risks: number };
}

interface ScheduleSummary {
  label: string;
  solverResult: string;
  qualityScore: number | null;
  meetingsPlaced: number;
}

const PREVIEW_COUNT = 6;

/** A titled list that shows the first few items and expands on request. */
function FindingGroup<T>({
  icon: Icon,
  title,
  hint,
  items,
  render,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  items: T[];
  render: (item: T) => React.ReactNode;
  tone: "red" | "amber";
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (items.length === 0) return null;
  const shown = expanded ? items : items.slice(0, PREVIEW_COUNT);
  return (
    <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)]">
      <div className="flex items-start gap-2 border-b border-[var(--ordiq-border)] px-3 py-2">
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            tone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-[var(--ordiq-ink)]">{title}</span>
            <span
              className={cn(
                "rounded-full px-1.5 text-[10px] font-bold",
                tone === "red"
                  ? "bg-red-500/15 text-red-700 dark:text-red-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}
            >
              {items.length}
            </span>
          </div>
          <p className="text-[10px] text-[var(--ordiq-muted)]">{hint}</p>
        </div>
      </div>
      <ul className="divide-y divide-[var(--ordiq-border)]">
        {shown.map((item, i) => (
          <li key={i} className="px-3 py-2 text-[11px] leading-relaxed text-[var(--ordiq-ink)]">
            {render(item)}
          </li>
        ))}
      </ul>
      {items.length > PREVIEW_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-[var(--ordiq-border)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-surface-muted)] cursor-pointer"
        >
          {expanded ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-xs font-medium text-emerald-800 dark:text-emerald-300">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {text}
    </div>
  );
}

function ColumnHeading({
  icon: Icon,
  title,
  count,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  description: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--ordiq-maroon)]" />
        <h3 className="text-sm font-bold text-[var(--ordiq-ink)]">{title}</h3>
        <span className="rounded-full bg-[var(--ordiq-surface-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ordiq-muted)]">
          {count}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">{description}</p>
    </div>
  );
}

const LOAD_TEXT = {
  OVER_MAX: "beyond the allowed overload",
  OVERLOAD: "overloaded",
} as const;

/**
 * The evaluation of the optimal schedule: what it does not satisfy, and the
 * possible conflicts of interest (scheduling risks) the Dean should look at.
 */
export function ScheduleEvaluationPanel({
  schedule,
  evaluation,
  loading,
  error,
}: {
  schedule: ScheduleSummary | null;
  evaluation: ScheduleEvaluation | null;
  loading: boolean;
  error: boolean;
}) {
  return (
    <Card className="border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[var(--ordiq-maroon)]" />
          <CardTitle className="text-base font-bold text-[var(--ordiq-ink)]">Schedule Evaluation</CardTitle>
        </div>
        <CardDescription className="text-xs text-[var(--ordiq-muted)]">
          {schedule
            ? `${schedule.label} · ${schedule.solverResult} · ${schedule.meetingsPlaced} class meetings placed`
            : "Generate the optimal schedule to see its evaluation."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!schedule ? (
          <p className="py-8 text-center text-xs text-[var(--ordiq-muted)]">
            No schedule yet. Press &ldquo;Generate Optimal Schedule&rdquo; above.
          </p>
        ) : loading ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonBlock className="h-40" />
            <SkeletonBlock className="h-40" />
          </div>
        ) : error || !evaluation ? (
          <p className="py-8 text-center text-xs text-[var(--ordiq-muted)]">
            The evaluation could not be loaded. Refresh the page to try again.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* 1. Unsatisfied constraints */}
            <section>
              <ColumnHeading
                icon={ShieldAlert}
                title="Unsatisfied Constraints"
                count={evaluation.counts.unsatisfied}
                description="Required rules the schedule does not meet, and classes it could not place."
              />
              <div className="space-y-3">
                {evaluation.counts.unsatisfied === 0 && (
                  <AllClear text="Every required rule is satisfied and every class is scheduled." />
                )}
                <FindingGroup
                  icon={AlertTriangle}
                  tone="red"
                  title="Unresolved conflicts"
                  hint="Fix these in the grid, or record a documented exception where the rule allows it."
                  items={evaluation.unsatisfied.conflicts}
                  render={(c) => (
                    <>
                      <span className="font-semibold">{c.rule}:</span> {c.description}
                    </>
                  )}
                />
                <FindingGroup
                  icon={CalendarX2}
                  tone="red"
                  title="Unscheduled classes"
                  hint="Class meetings that could not be placed without breaking a required rule."
                  items={evaluation.unsatisfied.unscheduled}
                  render={(u) => (
                    <>
                      <span className="font-semibold">
                        {u.subjectCode || u.offeringCode}
                        {u.sectionCode ? ` · ${u.sectionCode}` : ""}
                      </span>{" "}
                      — {u.reason}
                      {u.detail ? <span className="block text-[10px] text-[var(--ordiq-muted)]">{u.detail}</span> : null}
                    </>
                  )}
                />
              </div>
            </section>

            {/* 2. Possible conflicts of interest */}
            <section>
              <ColumnHeading
                icon={ShieldCheck}
                title="Possible Conflicts of Interest"
                count={evaluation.counts.risks}
                description="Not rule breaks, but worth checking before the schedule is accepted."
              />
              <div className="space-y-3">
                {evaluation.counts.risks === 0 && (
                  <AllClear text="No overloaded faculty, overfilled rooms, waived exceptions or unmet faculty preferences." />
                )}
                <FindingGroup
                  icon={UserCog}
                  tone="amber"
                  title="Overloaded faculty"
                  hint="Faculty assigned more units than their regular teaching load."
                  items={evaluation.risks.facultyLoad}
                  render={(f) => (
                    <>
                      <span className="font-semibold">{f.facultyName}</span>{" "}
                      <span className="text-[var(--ordiq-muted)]">({f.facultyCode})</span> — {f.assignedUnits} of{" "}
                      {f.regularMaxUnits} units ({Math.round(f.utilizationPct)}%), {LOAD_TEXT[f.level]}
                    </>
                  )}
                />
                <FindingGroup
                  icon={DoorOpen}
                  tone="amber"
                  title="Rooms over capacity"
                  hint="Classes with more students than the room has seats."
                  items={evaluation.risks.roomCapacity}
                  render={(r) => (
                    <>
                      <span className="font-semibold">{r.roomCode}</span> — {r.students} students for {r.seats} seats
                      <span className="block text-[10px] text-[var(--ordiq-muted)]">
                        {r.subjectCodes.join(", ")} · {r.sectionCodes.join(", ")}
                      </span>
                    </>
                  )}
                />
                <FindingGroup
                  icon={ShieldAlert}
                  tone="amber"
                  title="Waived rule exceptions"
                  hint="Rules the Dean waived with a written reason."
                  items={evaluation.risks.waivedExceptions}
                  render={(w) => (
                    <>
                      <span className="font-semibold">{w.rule}</span>
                      {w.occurrences > 1 ? ` (${w.occurrences} times)` : ""} — {w.reason}
                    </>
                  )}
                />
                <FindingGroup
                  icon={Heart}
                  tone="amber"
                  title="Unmet faculty preferences"
                  hint="Faculty requests the schedule could not follow; department rules come first."
                  items={evaluation.risks.unmetFacultyPreferences}
                  render={(p) => <>{p.description}</>}
                />
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
