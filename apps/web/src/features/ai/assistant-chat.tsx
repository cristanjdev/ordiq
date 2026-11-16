"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  BarChart3,
  Check,
  Copy,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import * as React from "react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { titleCase } from "@/lib/display-labels";
import { overlayMenu, useLastDefined, usePresence } from "@/lib/use-presence";
import motion from "./assistant-motion.module.css";
import { cn } from "@/lib/utils";

/**
 * Full-page chat for the AI Assistant: a conversation rail on the left and the
 * thread on the right. Every message goes to POST /api/v1/ai (action "chat"),
 * which runs through the privacy gateway and the read-only tools; the
 * assistant can only propose changes, and the Dean applies them under
 * Proposals.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ChatPartDto {
  kind: string;
  title: string;
}

export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: ChatPartDto[];
  createdAt: string;
}

export interface ChatConversationDto {
  id: string;
  title: string;
  messages: ChatMessageDto[];
  createdAt: string;
  updatedAt: string;
}

export type AssistantView = "briefing" | "proposals" | "usage";

interface BriefingStatsDto {
  briefing: { stats: { conflicts: number; unscheduled: number } | null };
}

async function postAi<T>(body: unknown, fallback: string): Promise<T> {
  const res = await fetch("/api/v1/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json.error?.message ?? fallback);
  return json;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A conversation is named by its saved title, or else by its first question. */
export function conversationTitle(c: ChatConversationDto): string {
  const saved = c.title?.trim();
  if (saved && saved !== "New Conversation") return saved.replace(/\s+/g, " ");
  const first = c.messages.find((m) => m.role === "user")?.content.trim();
  return first ? first.replace(/\s+/g, " ") : "New conversation";
}

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// Describe the requested topic, without claiming that a backend tool is running.
function pendingReplyLabel(prompt: string): string {
  if (/\b(faculty|teacher|instructor|professor|teaching load)\b/i.test(prompt)) {
    return "Preparing a response about faculty";
  }
  if (/\b(room|rooms|laboratory|laboratories)\b/i.test(prompt)) {
    return "Preparing a response about rooms";
  }
  if (/\b(schedule|schedules|scheduling|conflict|conflicts|unscheduled|timetable|time slots?)\b/i.test(prompt)) {
    return "Preparing a response about the schedule";
  }
  return "Preparing a reply";
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type RecentGroup = "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older";

function recentGroup(iso: string, now = new Date()): RecentGroup {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  const day = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  if (t >= startOfToday - 7 * day) return "Previous 7 days";
  if (t >= startOfToday - 30 * day) return "Previous 30 days";
  return "Older";
}

const GROUP_ORDER: RecentGroup[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Formatted reply: paragraphs, headings, bullet and numbered lists, **bold**, `code`
// ---------------------------------------------------------------------------

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // The block that the next line can extend (a paragraph or a list).
  let open: Block | null = null;
  const start = (block: Block) => {
    blocks.push(block);
    open = block;
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      open = null;
      continue;
    }
    const current = open as Block | null;
    const heading = /^#{1,4}\s+(.*)$/.exec(line)?.[1];
    if (heading !== undefined) {
      blocks.push({ kind: "h", text: heading });
      open = null;
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)?.[1];
    if (bullet !== undefined) {
      if (current?.kind === "ul") current.items.push(bullet);
      else start({ kind: "ul", items: [bullet] });
      continue;
    }
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)?.[1];
    if (numbered !== undefined) {
      if (current?.kind === "ol") current.items.push(numbered);
      else start({ kind: "ol", items: [numbered] });
      continue;
    }
    if (current?.kind === "p") current.lines.push(line);
    else start({ kind: "p", lines: [line] });
  }
  return blocks;
}

function Inline({ text }: { text: string }) {
  const pieces = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {pieces.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) {
          return (
            <strong key={i} className="font-semibold">
              {p.slice(2, -2)}
            </strong>
          );
        }
        if (/^`[^`]+`$/.test(p)) {
          return (
            <code key={i} className="rounded bg-[var(--ordiq-surface-muted)] px-1 py-0.5 font-mono text-[0.85em]">
              {p.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

export function FormattedReply({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-3 break-words">
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          return (
            <p key={i} className="font-semibold text-[var(--ordiq-ink)]">
              <Inline text={b.text} />
            </p>
          );
        }
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind === "ul" ? "ul" : "ol";
          return (
            <List
              key={i}
              className={cn("space-y-1 pl-5", b.kind === "ul" ? "list-disc" : "list-decimal", "marker:text-[var(--ordiq-muted)]")}
            >
              {b.items.map((item, j) => (
                <li key={j} className="pl-1">
                  <Inline text={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            {b.lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

const VIEW_LINKS: { id: AssistantView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "briefing", label: "Briefing", icon: Sparkles },
  { id: "proposals", label: "Proposals", icon: ShieldCheck },
  { id: "usage", label: "Usage & learning", icon: BarChart3 },
];

interface RailProps {
  termLabel: string;
  conversations: ChatConversationDto[];
  loading: boolean;
  activeConversationId: string | null;
  activeView: AssistantView | null;
  pendingProposals: number;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onOpenView: (view: AssistantView) => void;
  onDeleted: (id: string) => void;
  onClose?: () => void;
}

export function AssistantRail({
  termLabel,
  conversations,
  loading,
  activeConversationId,
  activeView,
  pendingProposals,
  onNewConversation,
  onOpenConversation,
  onOpenView,
  onDeleted,
  onClose,
}: RailProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [toDelete, setToDelete] = React.useState<ChatConversationDto | null>(null);
  // Keeps the dialog text while it fades out after closing.
  const deleteShown = useLastDefined(toDelete);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rename = useMutation({
    mutationFn: (input: { conversationId: string; title: string }) =>
      postAi({ action: "rename_conversation", ...input }, "The conversation could not be renamed."),
    onSuccess: async () => {
      setRenaming(null);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "The conversation could not be renamed."),
  });

  const remove = useMutation({
    mutationFn: (conversationId: string) =>
      postAi({ action: "delete_conversation", conversationId }, "The conversation could not be deleted."),
    onSuccess: async (_, conversationId) => {
      setToDelete(null);
      setActionError(null);
      onDeleted(conversationId);
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
    },
    onError: (err) => {
      setToDelete(null);
      setActionError(err instanceof Error ? err.message : "The conversation could not be deleted.");
    },
  });

  const q = search.trim().toLowerCase();
  const groups = React.useMemo(() => {
    const now = new Date();
    const shown = conversations
      .filter((c) => c.messages.length > 0)
      .filter(
        (c) =>
          !q ||
          conversationTitle(c).toLowerCase().includes(q) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const byGroup = new Map<RecentGroup, ChatConversationDto[]>();
    for (const c of shown) {
      const g = recentGroup(c.updatedAt, now);
      byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ label: g, items: byGroup.get(g) ?? [] }));
  }, [conversations, q]);

  // Close the item menu on Escape or an outside click.
  React.useEffect(() => {
    if (!menuFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuFor(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuFor]);

  const saveRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    const current = conversations.find((c) => c.id === renaming.id);
    if (!title || (current && title === conversationTitle(current))) {
      setRenaming(null);
      return;
    }
    rename.mutate({ conversationId: renaming.id, title });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--ordiq-surface)]">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0 px-1">
          <p className="truncate text-sm font-bold text-[var(--ordiq-ink)]">AI Assistant</p>
          <p className="truncate text-[11px] text-[var(--ordiq-muted)]">{termLabel}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close conversation list"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="shrink-0 space-y-1 px-2">
        <button
          type="button"
          onClick={onNewConversation}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold transition",
            activeConversationId === null && activeView === null
              ? "bg-[var(--ordiq-maroon)]/8 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/15 dark:text-[var(--ordiq-orange)]"
              : "text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface-muted)]",
          )}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ordiq-maroon)] text-white dark:bg-[var(--ordiq-orange)]">
            <Plus className="h-3.5 w-3.5" />
          </span>
          New conversation
        </button>
        <div className="relative px-0.5 py-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ordiq-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-8 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] pr-2.5 pl-8 text-xs text-[var(--ordiq-ink)] outline-none placeholder:text-[var(--ordiq-muted)] focus:border-[var(--ordiq-maroon)]/40 focus:ring-2 focus:ring-[var(--ordiq-maroon)]/10"
          />
        </div>
        <nav aria-label="Assistant sections" className="space-y-0.5 pb-2">
          {VIEW_LINKS.map((v) => {
            const Icon = v.icon;
            const active = activeView === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onOpenView(v.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition",
                  active
                    ? "bg-[var(--ordiq-maroon)]/8 font-semibold text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/15 dark:text-[var(--ordiq-orange)]"
                    : "text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface-muted)]",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{v.label}</span>
                {v.id === "proposals" && pendingProposals > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    {pendingProposals}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--ordiq-border)] px-2 pt-2 pb-3">
        {actionError && (
          <p role="alert" className="mx-1 mb-2 rounded-lg bg-red-500/10 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-300">
            {actionError}
          </p>
        )}
        {loading ? (
          <div className="space-y-1.5 p-1" role="status" aria-label="Loading conversations">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonBlock key={i} className="h-7 w-full rounded-lg" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-[11px] text-[var(--ordiq-muted)]">
            {q ? "No conversations match the search." : "No conversations yet."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-3">
              <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--ordiq-muted)]">
                {g.label}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((c) => {
                  const active = c.id === activeConversationId;
                  const title = conversationTitle(c);
                  if (renaming?.id === c.id) {
                    return (
                      <li key={c.id}>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveRename();
                          }}
                        >
                          <input
                            autoFocus
                            value={renaming.title}
                            maxLength={120}
                            disabled={rename.isPending}
                            onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                            onBlur={saveRename}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                e.stopPropagation();
                                setRenaming(null);
                              }
                            }}
                            aria-label="Conversation name"
                            className="h-8 w-full rounded-lg border border-[var(--ordiq-maroon)]/50 bg-[var(--ordiq-surface)] px-2.5 text-[13px] text-[var(--ordiq-ink)] outline-none ring-2 ring-[var(--ordiq-maroon)]/10"
                          />
                        </form>
                      </li>
                    );
                  }
                  return (
                    <li key={c.id} className={cn("group relative", motion.itemIn)}>
                      <button
                        type="button"
                        onClick={() => onOpenConversation(c.id)}
                        aria-current={active ? "page" : undefined}
                        title={title}
                        className={cn(
                          "flex w-full cursor-pointer items-center rounded-lg py-1.5 pr-8 pl-2.5 text-left text-[13px] transition",
                          active
                            ? "bg-[var(--ordiq-surface-muted)] font-medium text-[var(--ordiq-ink)]"
                            : "text-[var(--ordiq-ink)]/85 hover:bg-[var(--ordiq-surface-muted)]/70 hover:text-[var(--ordiq-ink)]",
                        )}
                      >
                        <span className="truncate">{title}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Options for ${title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === c.id}
                        onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                        className={cn(
                          "absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-border)]/60 hover:text-[var(--ordiq-ink)] focus-visible:opacity-100",
                          menuFor === c.id || active ? "opacity-100" : "opacity-100 lg:opacity-0 lg:group-hover:opacity-100",
                        )}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      <ItemMenu
                        open={menuFor === c.id}
                        onClose={() => setMenuFor(null)}
                        onRename={() => {
                          setMenuFor(null);
                          setRenaming({ id: c.id, title });
                        }}
                        onDelete={() => {
                          setMenuFor(null);
                          setToDelete(c);
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <ConfirmationModal
        isOpen={toDelete !== null}
        onClose={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
        title="Delete this conversation?"
        description={
          deleteShown
            ? `"${conversationTitle(deleteShown)}" and its ${plural(deleteShown.messages.length, "message")} will be permanently removed.`
            : ""
        }
        confirmText="Delete"
        variant="danger"
        isLoading={remove.isPending}
      />
    </div>
  );
}

function ItemMenu({
  open,
  onClose,
  onRename,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { mounted, shown } = usePresence(open, 150);
  if (!mounted) return null;
  return (
    <>
      {open && <div className="fixed inset-0 z-10" aria-hidden="true" onClick={onClose} />}
      <div
        role="menu"
        inert={!open}
        className={cn(
          "absolute top-8 right-1 z-20 w-40 overflow-hidden rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-1 text-[13px] shadow-xl",
          overlayMenu(shown),
        )}
      >
        <button
          type="button"
          role="menuitem"
          onClick={onRename}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface-muted)]"
        >
          <Pencil className="h-3.5 w-3.5" /> Rename
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={onDelete}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Chat pane
// ---------------------------------------------------------------------------

const FALLBACK_PROMPTS = [
  "Check conflicts in the current schedule",
  "Which faculty are close to their maximum load?",
  "How is room utilization this term?",
  "Kumusta ang faculty load ngayong term?",
];

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Shows a reply that has just arrived word by word, the way a streamed answer
 * reads. The text is the saved reply; only its display is paced.
 */
export function RevealReply({
  text,
  onProgress,
  onDone,
}: {
  text: string;
  onProgress: () => void;
  onDone: () => void;
}) {
  const tokens = React.useMemo(() => text.split(/(\s+)/), [text]);
  const [count, setCount] = React.useState(0);
  const callbacks = React.useRef({ onProgress, onDone });
  React.useEffect(() => {
    callbacks.current = { onProgress, onDone };
  }, [onProgress, onDone]);

  React.useEffect(() => {
    const total = tokens.length;
    if (prefersReducedMotion() || total === 0) {
      setCount(total);
      callbacks.current.onDone();
      return;
    }
    // About 90 words a second, between half a second and 2.5 seconds overall.
    const duration = Math.min(2500, Math.max(500, total * 6));
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setCount(Math.ceil(progress * total));
      callbacks.current.onProgress();
      if (progress < 1) frame = requestAnimationFrame(tick);
      else callbacks.current.onDone();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tokens]);

  return <FormattedReply text={tokens.slice(0, count).join("")} />;
}

export function TypingIndicator({ label }: { label: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-3 text-[var(--ordiq-muted)]", motion.riseIn)}>
      <span aria-hidden="true" className={cn(motion.dots, "text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]")}>
        <span />
        <span />
        <span />
      </span>
      <span className="text-xs">{label}…</span>
    </div>
  );
}

interface ChatPaneProps {
  termCode: string;
  termLabel: string;
  displayName: string;
  conversations: ChatConversationDto[];
  /** The requested conversation id (from the URL); null for a new conversation. */
  conversationId: string | null;
  loading: boolean;
  onConversationStarted: (id: string) => void;
  onOpenProposals: () => void;
}

export function ChatPane({
  termCode,
  termLabel,
  displayName,
  conversations,
  conversationId,
  loading,
  onConversationStarted,
  onOpenProposals,
}: ChatPaneProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = React.useState("");
  // The message being sent; `sentId` is its saved id once the server answers,
  // so the placeholder steps aside the moment the saved copy is on screen.
  const [pending, setPending] = React.useState<{
    prompt: string;
    conversationId: string | null;
    sentId?: string;
  } | null>(null);
  const [error, setError] = React.useState<{ message: string; conversationId: string | null } | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  // The reply that just arrived and is still being revealed.
  const [revealId, setRevealId] = React.useState<string | null>(null);
  // A conversation created from the new-conversation screen, shown at once
  // while the address bar catches up (so the screen never flashes back).
  const [handoffId, setHandoffId] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const followRef = React.useRef(true);
  const lastTopRef = React.useRef(0);
  const startedRef = React.useRef<string | null>(null);
  const selectedRef = React.useRef(conversationId);
  selectedRef.current = conversationId;

  const activeId = conversationId ?? handoffId;
  const conversation = activeId ? conversations.find((c) => c.id === activeId) : undefined;

  const briefingQuery = useQuery({
    queryKey: ["ai-briefing", termCode],
    queryFn: async () => {
      const res = await fetch(`/api/v1/ai/briefing?termCode=${encodeURIComponent(termCode)}`);
      if (!res.ok) throw new Error("The briefing could not load.");
      return (await res.json()) as BriefingStatsDto;
    },
  });

  const suggestions = React.useMemo(() => {
    const stats = briefingQuery.data?.briefing.stats;
    const dynamic: string[] = [];
    if (stats && stats.unscheduled > 0) {
      dynamic.push(`Why are ${plural(stats.unscheduled, "class meeting")} not scheduled?`);
    }
    if (stats && stats.conflicts > 0) {
      dynamic.push(`Explain the ${plural(stats.conflicts, "conflict")} in the current schedule`);
    }
    const rest = FALLBACK_PROMPTS.filter((p) => !(dynamic.length > 0 && p.startsWith("Check conflicts")));
    return [...dynamic, ...rest].slice(0, 4);
  }, [briefingQuery.data]);

  const chat = useMutation({
    mutationFn: (vars: { prompt: string; conversationId: string | null }) =>
      postAi<{ conversationId: string; userMessage?: { id: string }; assistantMessage?: { id: string } }>(
        {
          action: "chat",
          termCode,
          conversationId: vars.conversationId ?? undefined,
          prompt: vars.prompt,
        },
        "The assistant could not answer. Please try again.",
      ),
    onMutate: (vars) => {
      setPending(vars);
      setError(null);
    },
    onSuccess: async (data, vars) => {
      setRevealId(data.assistantMessage?.id ?? null);
      setPending((p) => (p ? { ...p, sentId: data.userMessage?.id } : p));
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
      // Tools like generate_schedule or add_directive change workspace data.
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
      void queryClient.invalidateQueries({ queryKey: ["ai-briefing"] });
      // Open the new conversation only if the Dean is still on the new-conversation screen.
      if (vars.conversationId === null && selectedRef.current === null) {
        startedRef.current = data.conversationId;
        setHandoffId(data.conversationId);
        onConversationStarted(data.conversationId);
      }
    },
    onError: (err, vars) => {
      setError({
        message: err instanceof Error ? err.message : "The assistant could not answer.",
        conversationId: vars.conversationId,
      });
      if (selectedRef.current === vars.conversationId) setInput((current) => current || vars.prompt);
    },
    onSettled: () => setPending(null),
  });

  const messages = conversation?.messages ?? [];
  const pendingHere =
    pending &&
    pending.conversationId === activeId &&
    !(pending.sentId && messages.some((m) => m.id === pending.sentId))
      ? pending
      : null;
  const errorHere = error && error.conversationId === activeId ? error : null;
  const isEmpty = activeId === null && !pendingHere;

  const scrollToEnd = React.useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }, []);

  // Follow new text only while the Dean is at the bottom; scrolling up to
  // read stops the follow, and coming back to the bottom resumes it.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) followRef.current = true;
    else if (el.scrollTop < lastTopRef.current - 4) followRef.current = false;
    lastTopRef.current = el.scrollTop;
  };

  // Opening a different conversation: start at its end and fade it in. The
  // conversation just created from the greeting screen is already on screen.
  React.useLayoutEffect(() => {
    setHandoffId(null);
    if (conversationId && conversationId === startedRef.current) {
      startedRef.current = null;
      return;
    }
    setRevealId(null);
    followRef.current = true;
    scrollToEnd(false);
    if (!prefersReducedMotion()) {
      contentRef.current?.animate(
        [
          { opacity: 0, transform: "translateY(6px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }, [conversationId, scrollToEnd]);

  // A sent message always brings the thread to the bottom.
  React.useEffect(() => {
    if (!pendingHere) return;
    followRef.current = true;
    scrollToEnd(true);
  }, [pendingHere, scrollToEnd]);

  React.useEffect(() => {
    if (followRef.current) scrollToEnd(true);
  }, [messages.length, errorHere, scrollToEnd]);

  const followReveal = React.useCallback(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, []);
  const endReveal = React.useCallback(() => setRevealId(null), []);

  // Focus the composer when switching conversations or leaving the greeting screen.
  React.useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId, isEmpty]);

  // Grow the composer with its content, up to about eight lines.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, isEmpty]);

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || chat.isPending) return;
    setInput("");
    chat.mutate({ prompt, conversationId: activeId });
  };

  const copy = async (m: ChatMessageDto) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      window.setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500);
    } catch {
      // Clipboard access can be blocked; the text stays selectable.
    }
  };

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className="rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-4 pt-3 pb-2.5 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-[var(--ordiq-maroon)]/50 focus-within:ring-2 focus-within:ring-[var(--ordiq-maroon)]/10"
    >
      <textarea
        ref={inputRef}
        rows={isEmpty ? 2 : 1}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(input);
          }
        }}
        placeholder={isEmpty ? "Ask about this term's schedule, faculty or rooms…" : "Reply to the assistant…"}
        aria-label="Message the assistant"
        className="max-h-[200px] w-full resize-none bg-transparent text-sm leading-relaxed text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-[var(--ordiq-muted)]">{termLabel}</span>
        <button
          type="submit"
          aria-label="Send message"
          disabled={!input.trim() || chat.isPending}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[var(--ordiq-maroon)] text-white transition-[background-color,opacity,scale] duration-200 hover:bg-[#480a13] active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 dark:bg-[var(--ordiq-orange)] dark:hover:opacity-90"
        >
          {chat.isPending ? <LoaderCircle className="h-4 w-4 motion-safe:animate-spin" /> : <ArrowUp className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );

  const disclaimer = (
    <p className="mt-2 text-center text-[11px] text-[var(--ordiq-muted)]">
      The assistant can make mistakes. Changes to the schedule take effect only after the Dean reviews them.
    </p>
  );

  if (isEmpty) {
    return (
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", motion.screenIn)}>
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
          <div className={cn("mb-6 flex items-center justify-center gap-3", motion.riseIn)}>
            <OrdiqLogo size={40} variant="maroon" alt="" className="shrink-0 dark:hidden" />
            <OrdiqLogo size={40} variant="white" alt="" className="hidden shrink-0 dark:block" />
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ordiq-ink)] sm:text-3xl">
              {greeting()}, {displayName}
            </h2>
          </div>
          {errorHere && (
            <p
              role="alert"
              className={cn(
                "mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-700 dark:text-red-300",
                motion.riseIn,
              )}
            >
              {errorHere.message}
            </p>
          )}
          <div className={motion.riseIn} style={{ animationDelay: "60ms" }}>
            {composer}
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {suggestions.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                disabled={chat.isPending}
                style={{ animationDelay: `${120 + i * 50}ms` }}
                className={cn(
                  "cursor-pointer rounded-full border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-3.5 py-1.5 text-left text-xs text-[var(--ordiq-ink)] transition-[border-color,color,translate] duration-200 hover:-translate-y-px hover:border-[var(--ordiq-maroon)]/50 hover:text-[var(--ordiq-maroon)] disabled:opacity-50 dark:hover:border-[var(--ordiq-orange)]/60 dark:hover:text-[var(--ordiq-orange)]",
                  motion.riseIn,
                )}
              >
                {p}
              </button>
            ))}
          </div>
          {disclaimer}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", motion.screenIn)}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        aria-busy={revealId !== null}
      >
        <div ref={contentRef} className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 text-sm leading-relaxed sm:px-6">
          {loading && !conversation && (
            <div className="space-y-4" role="status" aria-label="Loading conversation">
              <SkeletonBlock className="ml-auto h-10 w-2/3 rounded-2xl" />
              <SkeletonBlock className="h-24 w-full rounded-2xl" />
            </div>
          )}
          {!loading && !conversation && !pendingHere && (
            <p
              className={cn(
                "rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-4 py-3 text-xs text-[var(--ordiq-muted)]",
                motion.riseIn,
              )}
            >
              This conversation is no longer available. It may have been deleted or belong to another term.
            </p>
          )}

          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-[var(--ordiq-ink)]">
                    {m.content}
                  </div>
                </div>
              );
            }
            const revealing = m.id === revealId;
            const proposal = m.parts?.some((p) => p.kind === "proposal_card");
            const cards = (m.parts ?? []).filter((p) => p.kind !== "proposal_card");
            return (
              <div key={m.id} className={cn("group", revealing && motion.textIn)}>
                <div className="min-w-0 space-y-2 text-[var(--ordiq-ink)]">
                  {revealing ? (
                    <RevealReply text={m.content} onProgress={followReveal} onDone={endReveal} />
                  ) : (
                    <FormattedReply text={m.content} />
                  )}
                  {!revealing && cards.length > 0 && (
                    <div className={cn("flex flex-wrap gap-1.5", motion.riseIn)}>
                      {cards.map((p, i) => (
                        <span
                          key={`${p.kind}-${i}`}
                          title={p.title}
                          className="rounded-full border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 py-0.5 text-[11px] text-[var(--ordiq-muted)]"
                        >
                          {p.title || titleCase(p.kind)}
                        </span>
                      ))}
                    </div>
                  )}
                  {!revealing && proposal && (
                    <button
                      type="button"
                      onClick={onOpenProposals}
                      className={cn(
                        "cursor-pointer rounded-full border border-[var(--ordiq-maroon)] px-3 py-1 text-xs font-medium text-[var(--ordiq-maroon)] transition-colors hover:bg-[var(--ordiq-maroon)]/5 dark:border-[var(--ordiq-orange)] dark:text-[var(--ordiq-orange)]",
                        motion.riseIn,
                      )}
                    >
                      Review the proposed change →
                    </button>
                  )}
                  {!revealing && (
                    <div className={cn("flex items-center gap-2 text-[11px] text-[var(--ordiq-muted)]", motion.textIn)}>
                      <span>{formatTime(m.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => void copy(m)}
                        aria-label="Copy reply"
                        title="Copy reply"
                        className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-[opacity,background-color,color] duration-200 hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        {copiedId === m.id ? (
                          <Check className={cn("h-3.5 w-3.5", motion.textIn)} />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {pendingHere && (
            <>
              <div className={cn("flex justify-end", motion.riseIn)}>
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--ordiq-surface-muted)] px-4 py-2.5 text-[var(--ordiq-ink)]">
                  {pendingHere.prompt}
                </div>
              </div>
              <TypingIndicator label={pendingReplyLabel(pendingHere.prompt)} />
            </>
          )}

          {errorHere && (
            <p
              role="alert"
              className={cn(
                "rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-xs text-red-700 dark:text-red-300",
                motion.riseIn,
              )}
            >
              {errorHere.message}
            </p>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pt-2 pb-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {composer}
          {disclaimer}
        </div>
      </div>
    </div>
  );
}
