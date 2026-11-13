import { createHash } from "node:crypto";
import { generateText, wrapLanguageModel } from "ai";
import { unscheduledReasonLabel } from "@/lib/display-labels";
import { logger } from "../../platform/logger";
import { computeScheduleAnalytics } from "../analytics/analytics.service";
import {
  getMasterDataState,
  type ScheduleEntryRecord,
} from "../master-data/master-data.store";
import { createLanguageModel, providerOptionsFor, resolveLlmConfig } from "./llm-provider";
import {
  assertWithinTokenBudget,
  createPrivacyMiddleware,
  recordLlmUsage,
  restoreAliasedReply,
} from "./privacy-gateway";

/**
 * Term briefing for the AI Assistant page.
 *
 * The "needs attention" items are computed from the analytics and readiness
 * services only; the LLM never produces a figure here. The optional summary
 * paragraph is written by the LLM from those same items, through the privacy
 * gateway, and falls back to a plain template when no provider is usable.
 */

export type BriefingSeverity = "critical" | "warning" | "info" | "ok";

export interface BriefingItem {
  id: string;
  severity: BriefingSeverity;
  title: string;
  detail: string;
  /** Up to five concrete examples (classes, faculty, rules). */
  examples: string[];
  href: string;
  actionLabel: string;
}

export interface TermBriefing {
  termCode: string;
  schedule: { id: string; label: string; status: string; qualityScore: number } | null;
  stats: {
    scheduledPct: number;
    classesScheduled: number;
    totalMeetings: number;
    conflicts: number;
    unscheduled: number;
    pendingProposals: number;
  } | null;
  items: BriefingItem[];
  /** Changes whenever any item changes; keys the cached AI summary. */
  fingerprint: string;
  generatedAt: string;
}

export interface BriefingSummary {
  text: string;
  mode: "live" | "offline" | "offline-fallback";
  provider: string;
  model: string;
  generatedAt: string;
  fingerprint: string;
}

/** "TUESDAY" -> "Tuesday" */
function dayName(weekday: string): string {
  return weekday.charAt(0) + weekday.slice(1).toLowerCase();
}

function clock(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Tuesday, 10:00 AM – 11:30 AM · EN-LEC-09 · Engr. Reyes" */
export function describeEntry(entry: ScheduleEntryRecord): string {
  const state = getMasterDataState();
  const faculty =
    entry.facultyCode === "EXTERNAL"
      ? "External department"
      : (state.faculty.get(entry.facultyCode)?.name ?? entry.facultyCode);
  const day = dayName(entry.weekday);
  return `${day}, ${clock(entry.startMin)} – ${clock(entry.endMin)} · ${entry.roomCode} · ${faculty}`;
}

/** "CPE 101 lecture, section CPE-1A" */
export function describeOffering(offeringCode: string): string {
  const off = getMasterDataState().offerings.get(offeringCode);
  if (!off) return offeringCode;
  return `${off.subjectCode} ${off.component === "LAB" ? "lab" : "lecture"}, section ${off.sectionCode}`;
}

export function buildTermBriefing(termCode: string): TermBriefing {
  const state = getMasterDataState();
  const report = computeScheduleAnalytics(termCode, null);
  const sched = report.scheduleId ? state.schedules.get(report.scheduleId) : undefined;
  const items: BriefingItem[] = [];

  const pending = [...state.proposals.values()].filter(
    (p) => p.termCode === termCode && p.status === "PENDING",
  );
  const termSchedules = [...state.schedules.values()].filter((s) => s.termCode === termCode);
  const accepted = termSchedules.find((s) => s.status === "ACCEPTED");

  // Data readiness: problems that block generating a schedule.
  if (!report.dataReadiness.canGenerate || report.dataReadiness.criticalCount > 0) {
    items.push({
      id: "readiness",
      severity: "critical",
      title: `${plural(report.dataReadiness.criticalCount, "data problem")} block schedule generation`,
      detail: "The solver cannot run until the critical readiness checks pass.",
      examples: [],
      href: "/rules",
      actionLabel: "Review data readiness",
    });
  }

  if (!sched) {
    items.push({
      id: "no-schedule",
      severity: "warning",
      title: "No schedule for this term yet",
      detail: "Generate candidate schedules to compare, then accept one.",
      examples: [],
      href: "/schedules",
      actionLabel: "Open Schedules",
    });
  } else {
    const unwaived = (sched.validationReport?.violations ?? []).filter((v) => !v.waived);
    if (unwaived.length > 0) {
      items.push({
        id: "conflicts",
        severity: "critical",
        title: `${plural(unwaived.length, "unresolved conflict")} in ${sched.candidateLabel}`,
        detail: "Hard rules are broken; the schedule should not be released until these are fixed or documented.",
        examples: report.topConflicts.filter((c) => !c.waived).slice(0, 5).map((c) => c.description),
        href: "/schedules",
        actionLabel: "Fix in Schedules",
      });
    }

    const unscheduled = sched.unscheduled ?? [];
    if (unscheduled.length > 0) {
      items.push({
        id: "unscheduled",
        severity: "critical",
        title: `${plural(unscheduled.length, "class meeting")} not scheduled`,
        detail: "These meetings have no time slot or room yet.",
        examples: unscheduled
          .slice(0, 5)
          .map((u) => `${describeOffering(u.offeringCode)}: ${unscheduledReasonLabel(u.reasonCode)}`),
        href: "/schedules",
        actionLabel: "Review unscheduled classes",
      });
    }

    const over = report.facultyLoads.filter(
      (f) => f.statusLabel === "OVERLOAD" || f.statusLabel === "EXCEEDS_MAX",
    );
    if (over.length > 0) {
      const exceeds = over.filter((f) => f.statusLabel === "EXCEEDS_MAX").length;
      items.push({
        id: "overload",
        severity: exceeds > 0 ? "critical" : "warning",
        title: `${plural(over.length, "faculty member")} above the regular teaching load`,
        detail:
          exceeds > 0
            ? `${plural(exceeds, "faculty member")} exceed${exceeds === 1 ? "s" : ""} the maximum allowed overload.`
            : "Overloads are allowed but should be intentional.",
        examples: over
          .slice(0, 5)
          .map((f) => `${f.facultyName}: ${f.assignedUnits} of ${f.regularMaxUnits} regular units`),
        href: "/faculty",
        actionLabel: "Review faculty loads",
      });
    }

    const under = report.facultyLoads.filter((f) => f.statusLabel === "UNDERLOAD" && f.assignedUnits > 0);
    if (under.length > 0) {
      items.push({
        id: "underload",
        severity: "info",
        title: `${plural(under.length, "faculty member")} below the regular teaching load`,
        detail: "There may be room to rebalance classes toward these faculty.",
        examples: under.slice(0, 5).map((f) => `${f.facultyName}: ${f.assignedUnits} of ${f.regularMaxUnits} units`),
        href: "/faculty",
        actionLabel: "Review faculty loads",
      });
    }

    if (report.metrics.unmetPreferencesCount > 0) {
      items.push({
        id: "preferences",
        severity: "info",
        title: `${plural(report.metrics.unmetPreferencesCount, "faculty preference")} not met`,
        detail: "Soft preferences the solver could not satisfy in this schedule.",
        examples: [],
        href: "/rules",
        actionLabel: "Review preferences",
      });
    }
  }

  if (pending.length > 0) {
    items.push({
      id: "proposals",
      severity: "warning",
      title: `${plural(pending.length, "AI-proposed change")} awaiting review`,
      detail: "The assistant cannot apply changes; each one needs the Dean's decision.",
      examples: pending.slice(0, 5).map((p) => describeOffering(p.offeringCode)),
      href: "/assistant?tab=proposals",
      actionLabel: "Review proposals",
    });
  }

  if (sched && !accepted) {
    const candidates = termSchedules.filter((s) => s.status === "CANDIDATE").length;
    items.push({
      id: "not-accepted",
      severity: "info",
      title: "No accepted schedule yet",
      detail: `${plural(candidates, "candidate schedule")} ready to compare and accept.`,
      examples: [],
      href: "/schedules",
      actionLabel: "Compare candidates",
    });
  }

  const order: Record<BriefingSeverity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);

  const stats = sched
    ? {
        scheduledPct: report.metrics.scheduledPct,
        classesScheduled: report.metrics.classesScheduled,
        totalMeetings: report.metrics.totalMeetings,
        conflicts: report.metrics.conflictsDetected,
        unscheduled: sched.unscheduled?.length ?? 0,
        pendingProposals: pending.length,
      }
    : null;

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ termCode, s: sched?.id, v: sched?.version, items, stats }))
    .digest("hex")
    .slice(0, 16);

  return {
    termCode,
    schedule: sched
      ? { id: sched.id, label: sched.candidateLabel, status: sched.status, qualityScore: sched.qualityScore ?? 0 }
      : null,
    stats,
    items,
    fingerprint,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// AI summary (optional, on request)
// ---------------------------------------------------------------------------

const globalForBriefing = globalThis as unknown as {
  __ordiqBriefingSummaries?: Map<string, BriefingSummary>;
};
const summaryCache = (globalForBriefing.__ordiqBriefingSummaries ??= new Map());

export function getCachedBriefingSummary(briefing: TermBriefing): BriefingSummary | null {
  return summaryCache.get(`${briefing.termCode}:${briefing.fingerprint}`) ?? null;
}

/** Plain summary used when no AI provider is usable. */
export function templateSummary(b: TermBriefing): string {
  if (!b.schedule) return "There is no schedule for this term yet. Generate candidate schedules to begin.";
  const urgent = b.items.filter((i) => i.severity === "critical");
  const head = b.stats
    ? `${b.schedule.label} places ${b.stats.scheduledPct}% of class meetings (${b.stats.classesScheduled} of ${b.stats.totalMeetings}).`
    : "";
  if (b.items.length === 0) return `${head} Nothing needs attention right now.`;
  const first = urgent[0] ?? b.items[0];
  return `${head} ${plural(urgent.length, "urgent item")} and ${plural(b.items.length - urgent.length, "other item")} need attention; start with: ${first?.title.toLowerCase() ?? "the list below"}.`;
}

const SUMMARY_INSTRUCTIONS = `You write a short briefing for the Dean of the College of Engineering about the class schedule of one term.
Use ONLY the facts given. Do not add numbers, names or causes that are not in the facts.
Write 2 to 4 plain sentences in English, no lists, no headings, no markdown.
Start with the overall state, then the most urgent item, then the next step.
Faculty appear as ALIAS-XXX codes; keep them exactly as written.`;

export async function generateBriefingSummary(briefing: TermBriefing): Promise<BriefingSummary> {
  const key = `${briefing.termCode}:${briefing.fingerprint}`;
  const cached = summaryCache.get(key);
  if (cached) return cached;

  const config = resolveLlmConfig();
  const base = {
    provider: config.provider,
    model: config.model,
    generatedAt: new Date().toISOString(),
    fingerprint: briefing.fingerprint,
  };
  const facts = {
    term: briefing.termCode,
    schedule: briefing.schedule,
    stats: briefing.stats,
    attention: briefing.items.map((i) => ({
      severity: i.severity,
      title: i.title,
      detail: i.detail,
      examples: i.examples,
    })),
  };

  let summary: BriefingSummary;
  if (!config.live) {
    summary = { ...base, text: templateSummary(briefing), mode: "offline" };
  } else {
    try {
      assertWithinTokenBudget();
      const model = wrapLanguageModel({
        model: createLanguageModel(config),
        middleware: createPrivacyMiddleware({ provider: config.provider, model: config.model }),
      });
      const providerOptions = providerOptionsFor(config);
      const result = await generateText({
        model,
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: `Facts (JSON):\n${JSON.stringify(facts)}`,
        maxOutputTokens: 400,
        timeout: { totalMs: 45_000 },
        ...(providerOptions ? { providerOptions } : {}),
      });
      recordLlmUsage(
        config.provider,
        config.model,
        result.totalUsage.inputTokens ?? 0,
        result.totalUsage.outputTokens ?? 0,
      );
      const text = restoreAliasedReply(result.text.trim()).join("").trim();
      summary = { ...base, text: text || templateSummary(briefing), mode: text ? "live" : "offline-fallback" };
    } catch (err) {
      logger.warn("briefing_summary_failed", { message: err instanceof Error ? err.message : String(err) });
      summary = { ...base, text: templateSummary(briefing), mode: "offline-fallback" };
    }
  }

  // Only successful AI summaries are kept; a fallback is retried next time.
  if (summary.mode === "live") summaryCache.set(key, summary);
  return summary;
}
