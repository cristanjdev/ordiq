"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  History,
  Info,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { useSystemSettings } from "@/features/settings/settings-api";
import { requestOpenConversation } from "@/features/shell/ai-panel";
import { useShell } from "@/features/shell/providers";
import { titleCase } from "@/lib/display-labels";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

type Severity = "critical" | "warning" | "info" | "ok";

interface BriefingItemDto {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  examples: string[];
  href: string;
  actionLabel: string;
}

interface BriefingDto {
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
  items: BriefingItemDto[];
  fingerprint: string;
}

interface BriefingSummaryDto {
  text: string;
  mode: "live" | "offline" | "offline-fallback";
  provider: string;
  model: string;
  generatedAt: string;
  fingerprint: string;
}

interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

interface ConversationDto {
  id: string;
  title: string;
  messages: MessageDto[];
  createdAt: string;
  updatedAt: string;
}

interface ProposalDto {
  id: string;
  scheduleId: string;
  scheduleLabel: string;
  summary: string;
  offeringCode: string;
  offeringLabel: string;
  beforeText: string;
  afterText: string;
  status: "PENDING" | "APPLIED" | "REJECTED";
  qualityDelta: number;
  resultingQualityScore: number;
  valid: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

interface AiStateDto {
  conversations: ConversationDto[];
  proposals: ProposalDto[];
  usage: {
    requestCount: number;
    totalTokensUsed: number;
    totalEstimatedCostPhp: number;
    monthTokensUsed: number;
    monthTokenBudget: number;
  };
  provider: { provider: string; model: string; live: boolean; offlineReason: string | null };
}

interface MlEvalDto {
  evaluation: {
    activeVersion: { versionNumber: number; kind: string; trainedAt: string } | null;
    learnedPreferenceCount: number;
    learningEventCount: number;
    comparisons: {
      modelTop1Accuracy: number;
      modelTop3Accuracy: number;
      textSimilarityBaselineTop1: number;
      randomBaselineTop1: number;
    };
  };
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? fallback);
  return body;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS = [
  { id: "briefing", label: "Briefing", icon: Sparkles },
  { id: "proposals", label: "Proposals", icon: ShieldCheck },
  { id: "history", label: "History", icon: History },
  { id: "usage", label: "Usage & learning", icon: BarChart3 },
] as const;
type TabId = (typeof TABS)[number]["id"];

const SEVERITY_STYLE: Record<Severity, { icon: React.ComponentType<{ className?: string }>; tone: string; label: string }> = {
  critical: { icon: AlertOctagon, tone: "text-red-600 dark:text-red-400", label: "Urgent" },
  warning: { icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", label: "Review" },
  info: { icon: Info, tone: "text-sky-600 dark:text-sky-400", label: "Note" },
  ok: { icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400", label: "OK" },
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function StatTile({
  label,
  value,
  hint,
  tone,
  onPage,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  /** On the page background: a white card like the Dashboard KPIs. */
  onPage?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3",
        onPage
          ? "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs"
          : "bg-[var(--ordiq-surface-muted)]/60",
      )}
    >
      <p className="text-[11px] text-[var(--ordiq-muted)]">{label}</p>
      <p className={cn("mt-0.5 text-xl font-bold text-[var(--ordiq-ink)]", tone)}>{value}</p>
      {hint && <p className="text-[11px] text-[var(--ordiq-muted)]">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AiAssistantView() {
  const { selectedTerm, setAiPanelOpen } = useShell();
  const termCode = selectedTerm.id;
  const { settings } = useSystemSettings();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "briefing";

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "briefing") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const aiQuery = useQuery<AiStateDto>({
    queryKey: ["ai-state", termCode],
    queryFn: async () =>
      readJson<AiStateDto>(
        await fetch(`/api/v1/ai?termCode=${encodeURIComponent(termCode)}`),
        "The assistant data could not load.",
      ),
  });
  const pendingCount = (aiQuery.data?.proposals ?? []).filter((p) => p.status === "PENDING").length;

  if (!settings.ai.assistantEnabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>The AI Assistant is turned off</CardTitle>
          <CardDescription>It can be turned back on in Settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings" className="text-sm font-semibold text-[var(--ordiq-maroon)] hover:underline dark:text-[var(--ordiq-orange)]">
            Open Settings →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">AI Assistant</h1>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">{selectedTerm.label}</p>
        </div>
        <Button size="sm" onClick={() => setAiPanelOpen(true)}>
          <MessageSquareText className="mr-1.5 h-3.5 w-3.5" /> Ask the assistant
        </Button>
      </div>

      {/* Tabs (same style as the Dashboard and Rules tabs) */}
      <Card className="overflow-hidden">
        <div className="bg-[var(--ordiq-surface-muted)]/70 p-2 sm:p-2.5">
        <div role="tablist" aria-label="AI Assistant sections" className="grid w-full grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            const count =
              t.id === "proposals" ? pendingCount : t.id === "history" ? (aiQuery.data?.conversations.length ?? 0) : null;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-all",
                  active
                    ? "bg-[var(--ordiq-surface)] font-bold text-[var(--ordiq-maroon)] shadow-xs ring-1 ring-[var(--ordiq-border)] dark:text-[var(--ordiq-orange)]"
                    : "font-medium text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface)]/60 hover:text-[var(--ordiq-ink)]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t.label}</span>
                {count !== null && (
                  <span
                    className={cn(
                      "ml-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors",
                      active
                        ? "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]"
                        : "border border-[var(--ordiq-border)]/40 bg-[var(--ordiq-surface)] text-[var(--ordiq-muted)]",
                    )}
                  >
                    {aiQuery.isLoading ? "…" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        </div>
      </Card>

      {aiQuery.isError && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          {aiQuery.error instanceof Error ? aiQuery.error.message : "The assistant data could not load."}
        </p>
      )}

      {tab === "briefing" && <BriefingTab termCode={termCode} />}
      {tab === "proposals" && <ProposalsTab termCode={termCode} query={aiQuery} />}
      {tab === "history" && <HistoryTab query={aiQuery} onOpen={() => setAiPanelOpen(true)} />}
      {tab === "usage" && <UsageTab termCode={termCode} query={aiQuery} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Briefing
// ---------------------------------------------------------------------------

function BriefingTab({ termCode }: { termCode: string }) {
  const queryClient = useQueryClient();
  const key = ["ai-briefing", termCode];
  const briefingQuery = useQuery({
    queryKey: key,
    queryFn: async () =>
      readJson<{ briefing: BriefingDto; summary: BriefingSummaryDto | null }>(
        await fetch(`/api/v1/ai/briefing?termCode=${encodeURIComponent(termCode)}`),
        "The briefing could not load.",
      ),
  });
  const summarize = useMutation({
    mutationFn: async () =>
      readJson<{ briefing: BriefingDto; summary: BriefingSummaryDto }>(
        await fetch("/api/v1/ai/briefing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ termCode }),
        }),
        "The summary could not be written.",
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      void queryClient.invalidateQueries({ queryKey: ["ai-state"] });
    },
  });

  if (briefingQuery.isLoading) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading briefing">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-20 rounded-xl" />)}
        </div>
        <SkeletonBlock className="h-24 rounded-xl" />
        {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }
  if (briefingQuery.isError || !briefingQuery.data) {
    return (
      <p className="text-xs text-red-700 dark:text-red-300">
        {briefingQuery.error instanceof Error ? briefingQuery.error.message : "The briefing could not load."}
      </p>
    );
  }

  const { briefing, summary } = briefingQuery.data;
  const s = briefing.stats;
  const current = summary && summary.fingerprint === briefing.fingerprint ? summary : null;

  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile onPage label="Scheduled" value={`${s.scheduledPct}%`} />
          <StatTile
            onPage
            label="Conflicts"
            value={String(s.conflicts)}
            tone={s.conflicts > 0 ? "text-red-600 dark:text-red-400" : undefined}
          />
          <StatTile
            onPage
            label="Unscheduled"
            value={String(s.unscheduled)}
            tone={s.unscheduled > 0 ? "text-red-600 dark:text-red-400" : undefined}
          />
          <StatTile
            onPage
            label="Pending proposals"
            value={String(s.pendingProposals)}
            tone={s.pendingProposals > 0 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        </div>
      )}

      {/* AI summary */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ordiq-ink)]">
              <Sparkles className="h-4 w-4 text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]" />
              AI summary
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => summarize.mutate()}
              disabled={summarize.isPending}
            >
              {summarize.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : current ? (
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {summarize.isPending ? "Writing…" : current ? "Refresh" : "Summarize"}
            </Button>
          </div>
          {summarize.isPending ? (
            <div className="space-y-2">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-11/12" />
              <SkeletonBlock className="h-3 w-2/3" />
            </div>
          ) : current ? (
            <>
              <p className="text-sm leading-relaxed text-[var(--ordiq-ink)]">{current.text}</p>
              <p className="text-[11px] text-[var(--ordiq-muted)]">
                Updated {formatWhen(current.generatedAt)}
              </p>
            </>
          ) : null}
          {summarize.isError && (
            <p className="text-xs text-red-700 dark:text-red-300">
              {summarize.error instanceof Error ? summarize.error.message : "The summary could not be written."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Needs attention */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-[var(--ordiq-ink)]">
          Needs attention{" "}
          <span className="font-normal text-[var(--ordiq-muted)]">({briefing.items.length})</span>
        </h2>
        {briefing.items.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 p-5">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-[var(--ordiq-ink)]">All clear</p>
                <p className="text-xs text-[var(--ordiq-muted)]">Nothing needs attention.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {briefing.items.map((item) => {
              const sev = SEVERITY_STYLE[item.severity];
              const Icon = sev.icon;
              return (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", sev.tone)} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--ordiq-ink)]">{item.title}</p>
                        {item.examples.length > 0 && (
                          <ul className="mt-1.5 space-y-1 text-xs text-[var(--ordiq-muted)]">
                            {item.examples.slice(0, 3).map((ex, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--ordiq-muted)]" />
                                <span>{ex}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <Link
                      href={item.href}
                      className="inline-flex shrink-0 items-center gap-1 self-start rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-maroon)]/5 dark:text-[var(--ordiq-orange)] sm:ml-4"
                    >
                      {item.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

type ProposalFilter = "PENDING" | "APPLIED" | "REJECTED" | "ALL";

function ProposalsTab({
  query,
}: {
  termCode: string;
  query: ReturnType<typeof useQuery<AiStateDto>>;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<ProposalFilter>("PENDING");
  const [message, setMessage] = React.useState<string | null>(null);
  const review = useMutation({
    mutationFn: async (input: { proposalId: string; decision: "APPLY" | "REJECT" }) =>
      readJson(
        await fetch("/api/v1/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "review_proposal", ...input }),
        }),
        "The proposal could not be updated.",
      ),
    onSuccess: async (_, vars) => {
      setMessage(vars.decision === "APPLY" ? "Change applied and re-validated." : "Proposal rejected.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-state"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-briefing"] }),
        queryClient.invalidateQueries({ queryKey: ["schedules"] }),
      ]);
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "The proposal could not be updated."),
  });

  const all = query.data?.proposals ?? [];
  const counts = {
    PENDING: all.filter((p) => p.status === "PENDING").length,
    APPLIED: all.filter((p) => p.status === "APPLIED").length,
    REJECTED: all.filter((p) => p.status === "REJECTED").length,
    ALL: all.length,
  };
  const shown = filter === "ALL" ? all : all.filter((p) => p.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["PENDING", "APPLIED", "REJECTED", "ALL"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              filter === f
                ? "bg-[var(--ordiq-maroon)] text-white dark:bg-[var(--ordiq-orange)]"
                : "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-muted)] hover:text-[var(--ordiq-ink)]",
            )}
          >
            {f === "ALL" ? "All" : titleCase(f)} ({counts[f]})
          </button>
        ))}
      </div>

      {message && (
        <p role="status" className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-4 py-2.5 text-xs font-medium text-[var(--ordiq-ink)]">
          {message}
        </p>
      )}

      {query.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading proposals">
          {[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-xs text-[var(--ordiq-muted)]">
            {filter === "PENDING" ? "No pending proposals." : "No proposals."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((p) => {
            const busy = review.isPending && review.variables?.proposalId === p.id;
            return (
              <Card key={p.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--ordiq-ink)]">{p.offeringLabel}</p>
                      <p className="text-[11px] text-[var(--ordiq-muted)]">
                        {p.scheduleLabel} · {formatWhen(p.resolvedAt ?? p.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!p.valid && <Badge variant="danger">Conflict</Badge>}
                      <Badge variant={p.status === "PENDING" ? "warning" : p.status === "APPLIED" ? "success" : "neutral"}>
                        {titleCase(p.status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                    <div className="rounded-lg bg-[var(--ordiq-surface-muted)]/60 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ordiq-muted)]">Now</p>
                      <p className="mt-0.5 text-[var(--ordiq-ink)]">{p.beforeText}</p>
                    </div>
                    <ArrowRight className="mx-auto hidden h-4 w-4 text-[var(--ordiq-muted)] sm:block" />
                    <div className="rounded-lg bg-[var(--ordiq-maroon)]/5 px-3 py-2 dark:bg-[var(--ordiq-orange)]/10">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ordiq-muted)]">Proposed</p>
                      <p className="mt-0.5 text-[var(--ordiq-ink)]">{p.afterText}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-[var(--ordiq-muted)]">
                      Quality{" "}
                      <span className="font-semibold text-[var(--ordiq-ink)]">{p.resultingQualityScore.toFixed(1)}</span>{" "}
                      <span className={cn(p.qualityDelta < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                        ({p.qualityDelta >= 0 ? "+" : ""}
                        {p.qualityDelta.toFixed(1)})
                      </span>
                    </p>
                    {p.status === "PENDING" && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ proposalId: p.id, decision: "REJECT" })}
                        >
                          <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={review.isPending || !p.valid}
                          title={p.valid ? undefined : "This move would break a hard rule"}
                          onClick={() => review.mutate({ proposalId: p.id, decision: "APPLY" })}
                        >
                          {busy && review.variables?.decision === "APPLY" ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Apply
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryTab({
  query,
  onOpen,
}: {
  query: ReturnType<typeof useQuery<AiStateDto>>;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [toDelete, setToDelete] = React.useState<ConversationDto | null>(null);
  const remove = useMutation({
    mutationFn: async (conversationId: string) =>
      readJson(
        await fetch("/api/v1/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete_conversation", conversationId }),
        }),
        "The conversation could not be deleted.",
      ),
    onSuccess: async () => {
      setToDelete(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
    },
  });

  const q = search.trim().toLowerCase();
  const conversations = (query.data?.conversations ?? []).filter(
    (c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ordiq-muted)]" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="h-9 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] pl-8 pr-3 text-xs focus:border-[var(--ordiq-maroon)] focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-maroon)]/15"
        />
      </div>

      {query.isLoading ? (
        <div className="space-y-2" role="status" aria-label="Loading conversations">
          {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="p-5 text-xs text-[var(--ordiq-muted)]">
            {q ? "No matches." : "No conversations yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((c) => {
            const firstUser = c.messages.find((m) => m.role === "user");
            const title = c.title && c.title !== "New Conversation" ? c.title : (firstUser?.content ?? "Conversation");
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ordiq-ink)]">{title}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--ordiq-muted)]">
                      {c.messages.length} messages · {formatWhen(c.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        requestOpenConversation(c.id);
                        onOpen();
                      }}
                    >
                      <MessageSquareText className="mr-1.5 h-3.5 w-3.5" /> Continue
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Delete conversation"
                      className="text-[var(--ordiq-muted)] hover:text-red-600"
                      onClick={() => setToDelete(c)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {remove.isError && (
        <p className="text-xs text-red-700 dark:text-red-300">
          {remove.error instanceof Error ? remove.error.message : "The conversation could not be deleted."}
        </p>
      )}

      <ConfirmationModal
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
        title="Delete this conversation?"
        description="This permanently removes the conversation."
        confirmText="Delete"
        variant="danger"
        isLoading={remove.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usage & model
// ---------------------------------------------------------------------------

function UsageTab({
  termCode,
  query,
}: {
  termCode: string;
  query: ReturnType<typeof useQuery<AiStateDto>>;
}) {
  const queryClient = useQueryClient();
  const mlQuery = useQuery<MlEvalDto>({
    queryKey: ["ml-eval", termCode],
    queryFn: async () => readJson<MlEvalDto>(await fetch("/api/v1/ml"), "The model status could not load."),
  });
  const train = useMutation({
    mutationFn: async () =>
      readJson(
        await fetch("/api/v1/ml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "train", termCode }),
        }),
        "The model could not be trained.",
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ml-eval"] }),
  });

  const data = query.data;
  const usage = data?.usage;
  const provider = data?.provider;
  const pct = usage && usage.monthTokenBudget > 0
    ? Math.max(0, Math.min(100, (usage.monthTokensUsed / usage.monthTokenBudget) * 100))
    : null;
  const usageLabel = pct === null ? "No monthly limit set" : pct >= 100 ? "Monthly allowance used" : pct >= 90 ? "Approaching the monthly limit" : "Within the monthly allowance";
  const ml = mlQuery.data?.evaluation;
  const percent = (v: number) => `${(v * 100).toFixed(1)}%`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]" />
            Your AI assistant
          </CardTitle>
          <CardDescription>Availability and activity at a glance.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isError ? (
            <div role="status" className="space-y-3 rounded-xl bg-[var(--ordiq-surface-muted)] p-4">
              <p className="text-sm text-[var(--ordiq-muted)]">Assistant activity is temporarily unavailable.</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
                Try again
              </Button>
            </div>
          ) : query.isLoading || !usage || !provider ? (
            <SkeletonBlock className="h-32 w-full rounded-xl" />
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-xl bg-[var(--ordiq-surface-muted)]/60 p-4">
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    provider.live
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                  )}
                >
                  {provider.live ? <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> : <Info aria-hidden="true" className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ordiq-ink)]">{provider.live ? "Ready to help" : "Limited assistance"}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--ordiq-muted)]">
                    {provider.live
                      ? "Ask questions about schedules, faculty assignments, and room availability."
                      : "Basic assistance is available. Some answers may be limited until the full service returns."}
                  </p>
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-[var(--ordiq-ink)]">Monthly usage</span>
                  {pct !== null && <span className="text-[var(--ordiq-muted)]">{pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}% used</span>}
                </div>
                {pct !== null && <div
                  role="progressbar"
                  aria-label="Monthly assistant allowance used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ordiq-surface-muted)]"
                >
                  <div
                    className={cn("h-full rounded-full", pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]")}
                    style={{ width: `${pct}%` }}
                  />
                </div>}
                <p className="mt-2 text-xs text-[var(--ordiq-muted)]">{usageLabel}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <StatTile label="Times used" value={usage.requestCount.toLocaleString()} hint="Includes chats and summaries" />
                <StatTile label="Saved conversations" value={(data?.conversations.length ?? 0).toLocaleString()} hint="For the selected academic term" />
              </div>
              <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--ordiq-maroon)] hover:underline dark:text-[var(--ordiq-orange)]">
                Assistant settings <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <CardTitle className="text-sm">Faculty matching model</CardTitle>
          <Button variant="outline" size="sm" onClick={() => train.mutate()} disabled={train.isPending}>
            {train.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />}
            {train.isPending ? "Training…" : "Retrain"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {mlQuery.isLoading ? (
            <SkeletonBlock className="h-32 w-full rounded-xl" />
          ) : !ml?.activeVersion ? (
            <p className="text-xs text-[var(--ordiq-muted)]">Not trained yet.</p>
          ) : (
            <>
              <p className="text-xs text-[var(--ordiq-muted)]">
                Version {ml.activeVersion.versionNumber} · {formatWhen(ml.activeVersion.trainedAt)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <StatTile label="Top-1 accuracy" value={percent(ml.comparisons.modelTop1Accuracy)} />
                <StatTile label="Top-3 accuracy" value={percent(ml.comparisons.modelTop3Accuracy)} />
                <StatTile label="Text-match baseline" value={percent(ml.comparisons.textSimilarityBaselineTop1)} />
                <StatTile label="Random baseline" value={percent(ml.comparisons.randomBaselineTop1)} />
              </div>
            </>
          )}
          {train.isError && (
            <p className="text-xs text-red-700 dark:text-red-300">
              {train.error instanceof Error ? train.error.message : "The model could not be trained."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
