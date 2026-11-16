"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Info,
  Loader2,
  PanelLeft,
  Plus,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { useSystemSettings } from "@/features/settings/settings-api";
import { useAuthSession } from "@/features/auth/auth-session-provider";
import { useShell } from "@/features/shell/providers";
import { titleCase } from "@/lib/display-labels";
import { overlayBackdrop, usePresence } from "@/lib/use-presence";
import { cn } from "@/lib/utils";
import {
  AssistantRail,
  type AssistantView,
  type ChatConversationDto,
  ChatPane,
  conversationTitle,
} from "./assistant-chat";

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
  conversations: ChatConversationDto[];
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

const VIEW_TITLES: Record<AssistantView, { title: string; description: string }> = {
  briefing: { title: "Briefing", description: "What needs attention this term." },
  proposals: { title: "Proposals", description: "Changes the assistant suggested, waiting for the Dean's review." },
  usage: { title: "Usage & learning", description: "Assistant availability, usage and the faculty matching model." },
};

function readView(params: URLSearchParams): AssistantView | null {
  // `tab` is the older parameter; links to ?tab=proposals keep working.
  const v = params.get("view") ?? params.get("tab");
  return v === "briefing" || v === "proposals" || v === "usage" ? v : null;
}

export function AiAssistantView() {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;
  const { settings } = useSystemSettings();
  const { user } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = readView(searchParams);
  const conversationId = view ? null : searchParams.get("c");
  const [railOpen, setRailOpen] = React.useState(false); // below lg: the rail is a drawer
  const [railHidden, setRailHidden] = React.useState(false); // lg and up: the rail can be collapsed
  const railDrawer = usePresence(railOpen);

  const displayName = React.useMemo(() => {
    const raw = user?.username?.trim();
    if (!raw) return "Dean";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user?.username]);

  const navigate = React.useCallback(
    (next: { c?: string | null; view?: AssistantView | null }) => {
      const params = new URLSearchParams();
      if (next.view) params.set("view", next.view);
      else if (next.c) params.set("c", next.c);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      setRailOpen(false);
    },
    [pathname, router],
  );

  const aiQuery = useQuery<AiStateDto>({
    queryKey: ["ai-state", termCode],
    queryFn: async () =>
      readJson<AiStateDto>(
        await fetch(`/api/v1/ai?termCode=${encodeURIComponent(termCode)}`),
        "The assistant data could not load.",
      ),
  });
  const conversations = aiQuery.data?.conversations ?? [];
  const pendingCount = (aiQuery.data?.proposals ?? []).filter((p) => p.status === "PENDING").length;
  const conversation = conversationId ? conversations.find((c) => c.id === conversationId) : undefined;

  // A different term has its own conversations: start fresh when the term changes.
  const lastTermRef = React.useRef(termCode);
  React.useEffect(() => {
    if (lastTermRef.current === termCode) return;
    lastTermRef.current = termCode;
    if (conversationId) navigate({});
  }, [termCode, conversationId, navigate]);

  // Escape closes the rail drawer.
  React.useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [railOpen]);

  if (!settings.ai.assistantEnabled) {
    return (
      <div className="p-3 sm:p-5 lg:p-6">
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
      </div>
    );
  }

  const rail = (onClose?: () => void) => (
    <AssistantRail
      termLabel={selectedTerm.label}
      conversations={conversations}
      loading={aiQuery.isLoading}
      activeConversationId={conversationId}
      activeView={view}
      pendingProposals={pendingCount}
      onNewConversation={() => navigate({})}
      onOpenConversation={(id) => navigate({ c: id })}
      onOpenView={(v) => navigate({ view: v })}
      onDeleted={(id) => {
        if (id === conversationId) navigate({});
      }}
      onClose={onClose}
    />
  );

  const headerTitle = view
    ? VIEW_TITLES[view].title
    : conversation
      ? conversationTitle(conversation)
      : conversationId
        ? ""
        : "New conversation";

  return (
    <div className="relative flex h-full min-h-0">
      {/* Rail: a column from lg up, a drawer below */}
      {/* The column slides closed (width to 0); its content keeps its width so nothing reflows mid-slide. */}
      <aside
        aria-label="Conversations"
        inert={railHidden}
        className={cn(
          "hidden shrink-0 overflow-hidden border-[var(--ordiq-border)] lg:flex",
          "transition-[width,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          railHidden ? "w-0 border-r-0" : "w-64 border-r xl:w-72",
        )}
      >
        <div
          className={cn(
            "flex h-full w-64 shrink-0 xl:w-72",
            "transition-opacity duration-200 motion-reduce:transition-none",
            railHidden ? "opacity-0" : "opacity-100",
          )}
        >
          {rail()}
        </div>
      </aside>
      {railDrawer.mounted && (
        <div
          inert={!railOpen}
          className={cn("fixed inset-0 top-16 z-40 flex lg:hidden", !railDrawer.shown && "pointer-events-none")}
        >
          <div
            className={cn("absolute inset-0 bg-black/45", overlayBackdrop(railDrawer.shown))}
            aria-hidden="true"
            onClick={() => setRailOpen(false)}
          />
          <aside
            aria-label="Conversations"
            className={cn(
              "relative flex w-72 max-w-[85vw] border-r border-[var(--ordiq-border)] shadow-2xl",
              "transform-gpu transition-[translate,opacity] duration-200 ease-out motion-reduce:transition-none",
              railDrawer.shown ? "translate-x-0 opacity-100" : "-translate-x-full opacity-60",
            )}
          >
            {rail(() => setRailOpen(false))}
          </aside>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ordiq-border)] px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            aria-label="Show conversations"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] lg:hidden"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setRailHidden((h) => !h)}
            aria-label={railHidden ? "Show conversations" : "Hide conversations"}
            title={railHidden ? "Show conversations" : "Hide conversations"}
            className="hidden h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] lg:flex"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ordiq-ink)]">{headerTitle}</h1>
          {(view || conversationId) && (
            <button
              type="button"
              onClick={() => navigate({})}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[var(--ordiq-maroon)] transition hover:bg-[var(--ordiq-maroon)]/5 dark:text-[var(--ordiq-orange)]"
            >
              <Plus className="h-3.5 w-3.5" /> New conversation
            </button>
          )}
        </header>

        {aiQuery.isError && (
          <p className="m-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            {aiQuery.error instanceof Error ? aiQuery.error.message : "The assistant data could not load."}
          </p>
        )}

        {view ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-5 lg:p-6">
              <p className="text-xs text-[var(--ordiq-muted)]">{VIEW_TITLES[view].description}</p>
              {view === "briefing" && <BriefingTab termCode={termCode} />}
              {view === "proposals" && <ProposalsTab termCode={termCode} query={aiQuery} />}
              {view === "usage" && <UsageTab termCode={termCode} query={aiQuery} />}
            </div>
          </div>
        ) : (
          <ChatPane
            termCode={termCode}
            termLabel={selectedTerm.label}
            displayName={displayName}
            conversation={conversation}
            conversationId={conversationId}
            loading={aiQuery.isLoading}
            onConversationStarted={(id) => navigate({ c: id })}
            onOpenProposals={() => navigate({ view: "proposals" })}
          />
        )}
      </section>
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
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ordiq-ink)]">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                All clear
              </p>
              <p className="mt-1 text-xs text-[var(--ordiq-muted)]">Nothing needs attention.</p>
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
                    <div className="min-w-0">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ordiq-ink)]">
                          <Icon aria-label={sev.label} className={cn("h-4 w-4 shrink-0", sev.tone)} />
                          <span className="min-w-0">{item.title}</span>
                        </p>
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
              <div className="rounded-xl bg-[var(--ordiq-surface-muted)]/60 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ordiq-ink)]">
                  {provider.live ? (
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  {provider.live ? "Ready to help" : "Limited assistance"}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--ordiq-muted)]">
                  {provider.live
                    ? "Ask questions about schedules, faculty assignments, and room availability."
                    : "Basic assistance is available. Some answers may be limited until the full service returns."}
                </p>
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
