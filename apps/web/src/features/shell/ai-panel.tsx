"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquare, MoreVertical, Plus, Search, SendHorizontal, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { titleCase } from "@/lib/display-labels";
import { cn } from "@/lib/utils";
import { useShell } from "./providers";

/**
 * Docked / drawer AI assistant. It talks to the same /api/v1/ai endpoint as
 * the full AI Assistant page, so every answer comes from the privacy gateway
 * and the approved read tools; nothing here is canned text.
 */

interface PartDto {
  kind: string;
  title: string;
}

interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: PartDto[];
  createdAt: string;
}

interface ConversationDto {
  id: string;
  messages: MessageDto[];
  updatedAt: string;
}

interface AiStateDto {
  conversations: ConversationDto[];
}

interface ChatTurnDto {
  conversationId: string;
  mode?: "live" | "offline" | "offline-fallback";
  provider?: string;
  model?: string;
}

const STARTER_PROMPTS = [
  "Check conflicts in the current schedule",
  "Which classes are unscheduled and why?",
  "Kumusta ang faculty load ngayong term?",
  "How is room utilization this term?",
];

const GREETING = `Ask the assistant about this term's schedule, for example:
• Conflicts and unscheduled classes
• Faculty loads and room usage
• Alternative time slots for a class
• Generating new candidate schedules

Answers use the live schedule data. Changes are applied only by the Dean in the workspace.`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Just now", "12m ago", "3:20 PM", "Yesterday", "Oct 28" */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** A conversation is titled by its first question. */
function conversationTitle(c: ConversationDto): string {
  const first = c.messages.find((m) => m.role === "user")?.content.trim();
  return first ? first.replace(/\s+/g, " ") : "New conversation";
}

/** Light formatting for model replies: **bold** and "- " / "* " bullets. */
function RichText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const bullet = /^\s*[-*]\s+/.test(line);
        const body = bullet ? line.replace(/^\s*[-*]\s+/, "• ") : line;
        const pieces = body.split(/(\*\*[^*]+\*\*)/g);
        return (
          <React.Fragment key={i}>
            {pieces.map((p, j) =>
              /^\*\*[^*]+\*\*$/.test(p) ? <strong key={j}>{p.slice(2, -2)}</strong> : p,
            )}
            {i < lines.length - 1 && "\n"}
          </React.Fragment>
        );
      })}
    </>
  );
}

// "Continue in panel" from the AI Assistant page. The panel may not be mounted
// yet (it mounts on first open), so the request is also kept until it is read.
const OPEN_CONVERSATION_EVENT = "ordiq:open-conversation";
let pendingConversationId: string | null = null;

/** Ask the side panel to show this conversation (the caller opens the panel). */
export function requestOpenConversation(conversationId: string): void {
  pendingConversationId = conversationId;
  window.dispatchEvent(new CustomEvent(OPEN_CONVERSATION_EVENT, { detail: conversationId }));
}

interface AiPanelProps {
  onClose?: () => void;
  isMobileDrawer?: boolean;
}

export function AiAssistantPanel({ onClose, isMobileDrawer = false }: AiPanelProps) {
  const { selectedTerm } = useShell();
  const termCode = selectedTerm.id;
  const queryClient = useQueryClient();
  const [inputText, setInputText] = React.useState("");
  // The panel opens on a fresh conversation (null). Earlier chats, including
  // the seeded demo ones, are reachable from the menu or the full page.
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastMode, setLastMode] = React.useState<ChatTurnDto | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sessionQuery, setSessionQuery] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const take = () => {
      if (!pendingConversationId) return;
      setConversationId(pendingConversationId);
      setError(null);
      pendingConversationId = null;
    };
    take();
    window.addEventListener(OPEN_CONVERSATION_EVENT, take);
    return () => window.removeEventListener(OPEN_CONVERSATION_EVENT, take);
  }, []);

  // A different term has its own conversations (skip the first render, so a
  // conversation handed over from the AI Assistant page is kept).
  const lastTermRef = React.useRef(termCode);
  React.useEffect(() => {
    if (lastTermRef.current === termCode) return;
    lastTermRef.current = termCode;
    setConversationId(null);
    setError(null);
    setLastMode(null);
  }, [termCode]);

  const aiQuery = useQuery<AiStateDto>({
    queryKey: ["ai-state", termCode],
    queryFn: async () => {
      const res = await fetch(`/api/v1/ai?termCode=${encodeURIComponent(termCode)}`);
      if (!res.ok) throw new Error("The assistant could not load the conversation.");
      return (await res.json()) as AiStateDto;
    },
  });

  const conversations = aiQuery.data?.conversations ?? [];
  const conversation = conversationId
    ? conversations.find((c) => c.id === conversationId)
    : undefined;
  const sessions = React.useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    return [...conversations]
      .filter((c) => c.messages.length > 0)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((c) => !q || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [conversations, sessionQuery]);
  const messages = conversation?.messages ?? [];

  const chat = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await fetch("/api/v1/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          termCode,
          conversationId: conversation?.id,
          prompt,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(err.error?.message ?? "The assistant could not answer. Please try again.");
      }
      return (await res.json()) as ChatTurnDto;
    },
    onMutate: (prompt) => {
      setPendingPrompt(prompt);
      setError(null);
    },
    onSuccess: async (data) => {
      setConversationId(data.conversationId);
      setLastMode(data);
      await queryClient.invalidateQueries({ queryKey: ["ai-state"] });
      // Tools like generate_schedule or add_directive change workspace data.
      void queryClient.invalidateQueries({ queryKey: ["schedules"] });
    },
    onError: (err, prompt) => {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
      setInputText((current) => current || prompt);
    },
    onSettled: () => setPendingPrompt(null),
  });

  React.useEffect(() => {
    // Scroll the message list itself; scrollIntoView would also nudge the
    // sliding panel and the page behind it.
    const list = messagesEndRef.current?.parentElement;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages.length, pendingPrompt, error]);

  // Grow the input with its content, up to about five lines.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputText]);

  const send = (text: string) => {
    const prompt = text.trim();
    if (!prompt || chat.isPending) return;
    setInputText("");
    chat.mutate(prompt);
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setSessionQuery("");
  };

  const startNewConversation = () => {
    setConversationId(null);
    setError(null);
    setLastMode(null);
    closeMenu();
    inputRef.current?.focus();
  };

  const openSession = (id: string) => {
    setConversationId(id);
    setError(null);
    setLastMode(null);
    closeMenu();
  };

  // Escape closes the menu first, not the whole panel.
  React.useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menuOpen]);

  const showStarters = messages.length === 0 && !pendingPrompt;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)]">
      {/* Header */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-b border-[var(--ordiq-border)] px-4 py-3.5",
          isMobileDrawer && "bg-[var(--ordiq-surface-muted)]/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <OrdiqLogo size={28} variant="maroon" alt="AI Assistant" className="shrink-0 dark:hidden" />
          <OrdiqLogo size={28} variant="white" alt="AI Assistant" className="hidden shrink-0 dark:block" />
          <div className="min-w-0">
            <span className="block text-sm font-bold text-[var(--ordiq-ink)]">AI Assistant</span>
            <p className="truncate text-[10px] text-[var(--ordiq-muted)]">{selectedTerm.label}</p>
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-1">
          <span className="mr-1.5 inline-flex h-6 items-center rounded-md bg-[var(--ordiq-maroon)]/10 px-2 text-[10px] font-semibold leading-none text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]">
            Beta
          </span>
          <button
            type="button"
            aria-label="Conversations"
            title="Conversations"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            className={cn(
              "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]",
              menuOpen && "bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-ink)]",
            )}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" aria-hidden="true" onClick={closeMenu} />
              <div
                role="menu"
                aria-label="Conversations"
                className="absolute right-0 top-9 z-20 flex max-h-[min(28rem,calc(100dvh-10rem))] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-xs shadow-xl animate-info-pop"
              >
                <div className="shrink-0 p-1.5">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startNewConversation}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-[var(--ordiq-maroon)] transition hover:bg-[var(--ordiq-surface-muted)] dark:text-[var(--ordiq-orange)]"
                  >
                    <Plus className="h-3.5 w-3.5" /> New conversation
                  </button>
                </div>

                <div className="shrink-0 border-t border-[var(--ordiq-border)] px-3 pt-2.5 pb-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ordiq-muted)]">
                      Recent
                    </span>
                    {conversations.length > 0 && (
                      <span className="text-[10px] text-[var(--ordiq-muted)]">{conversations.length}</span>
                    )}
                  </div>
                  {conversations.length > 5 && (
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ordiq-muted)]" />
                      <input
                        type="search"
                        value={sessionQuery}
                        onChange={(e) => setSessionQuery(e.target.value)}
                        placeholder="Search conversations"
                        aria-label="Search conversations"
                        className="h-8 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] pr-2.5 pl-8 text-xs outline-none focus:border-[var(--ordiq-maroon)]/40 focus:ring-2 focus:ring-[var(--ordiq-maroon)]/10"
                      />
                    </div>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
                  {aiQuery.isLoading ? (
                    <div className="space-y-1.5 p-1">
                      {[0, 1, 2].map((i) => (
                        <SkeletonBlock key={i} className="h-10 w-full rounded-lg" />
                      ))}
                    </div>
                  ) : sessions.length === 0 ? (
                    <p className="px-2.5 py-4 text-center text-[11px] text-[var(--ordiq-muted)]">
                      {sessionQuery ? "No matches." : "No conversations yet."}
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {sessions.map((c) => {
                        const active = c.id === conversation?.id;
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => openSession(c.id)}
                              aria-current={active ? "true" : undefined}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition",
                                active
                                  ? "bg-[var(--ordiq-maroon)]/8 dark:bg-[var(--ordiq-orange)]/15"
                                  : "hover:bg-[var(--ordiq-surface-muted)]",
                              )}
                            >
                              <MessageSquare
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0",
                                  active
                                    ? "text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]"
                                    : "text-[var(--ordiq-muted)]",
                                )}
                              />
                              <span className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "block truncate",
                                    active ? "font-semibold text-[var(--ordiq-ink)]" : "text-[var(--ordiq-ink)]",
                                  )}
                                >
                                  {conversationTitle(c)}
                                </span>
                                <span className="block text-[10px] text-[var(--ordiq-muted)]">
                                  {formatWhen(c.updatedAt)} · {c.messages.length} messages
                                </span>
                              </span>
                              {active && (
                                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
          {isMobileDrawer && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close AI panel"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4 text-xs leading-relaxed"
        aria-live="polite"
      >
        <div className="flex flex-col items-start gap-1.5">
          <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3.5 shadow-xs">
            {GREETING}
          </div>
        </div>

        {aiQuery.isLoading && conversationId && (
          <div className="space-y-3" role="status" aria-label="Loading conversation">
            <SkeletonBlock className="ml-auto h-9 w-2/3 rounded-2xl" />
            <SkeletonBlock className="h-16 w-4/5 rounded-2xl" />
          </div>
        )}

        {aiQuery.isError && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
            {aiQuery.error instanceof Error ? aiQuery.error.message : "The conversation could not load."}
          </p>
        )}

        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const proposal = msg.parts?.some((p) => p.kind === "proposal_card");
          const cards = (msg.parts ?? []).filter((p) => p.kind !== "proposal_card");
          return (
            <div key={msg.id} className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl p-3.5 shadow-xs",
                  isUser
                    ? "bg-[var(--ordiq-maroon)] text-white"
                    : "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-ink)]",
                )}
              >
                {isUser ? msg.content : <RichText text={msg.content} />}
              </div>
              {!isUser && cards.length > 0 && (
                <div className="flex max-w-[88%] flex-wrap gap-1.5">
                  {cards.map((p, i) => (
                    <span
                      key={`${p.kind}-${i}`}
                      title={p.title}
                      className="rounded-full border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 py-0.5 text-[10px] text-[var(--ordiq-muted)]"
                    >
                      {p.title || titleCase(p.kind)}
                    </span>
                  ))}
                </div>
              )}
              {!isUser && proposal && (
                <Link
                  href="/assistant?tab=proposals"
                  className="rounded-full border border-[var(--ordiq-maroon)] px-3 py-1 text-[11px] font-medium text-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-maroon)]/5 dark:border-[var(--ordiq-orange)] dark:text-[var(--ordiq-orange)]"
                >
                  Review the proposed change →
                </Link>
              )}
              <span className="px-1 text-[10px] text-[var(--ordiq-muted)]">{formatTime(msg.createdAt)}</span>
            </div>
          );
        })}

        {pendingPrompt && (
          <>
            <div className="flex flex-col items-end gap-1.5">
              <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--ordiq-maroon)] p-3.5 text-white shadow-xs">
                {pendingPrompt}
              </div>
            </div>
            <div
              role="status"
              className="flex w-fit items-center gap-2 rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 py-2 text-[var(--ordiq-muted)]"
            >
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ordiq-maroon)]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ordiq-maroon)] [animation-delay:0.2s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--ordiq-maroon)] [animation-delay:0.4s]" />
              </span>
              <span>The assistant is checking the schedule data…</span>
            </div>
          </>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        {showStarters && (
          <div className="flex flex-wrap gap-1.5">
            {STARTER_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                className="rounded-full border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-3 py-1 text-left text-[11px] font-medium text-[var(--ordiq-ink)] transition hover:border-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-maroon)]/5 hover:text-[var(--ordiq-maroon)] dark:hover:border-[var(--ordiq-orange)] dark:hover:text-[var(--ordiq-orange)]"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 bg-[var(--ordiq-surface)] p-3.5 pt-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(inputText);
          }}
          className="flex items-end gap-2 rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 py-2 focus-within:border-[var(--ordiq-maroon)] focus-within:ring-1 focus-within:ring-[var(--ordiq-maroon)]"
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(inputText);
              }
            }}
            placeholder="Ask about this term's schedule…"
            aria-label="Chat message input"
            className="max-h-[120px] w-full resize-none bg-transparent py-1 text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!inputText.trim() || chat.isPending}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ordiq-maroon)] transition hover:bg-[var(--ordiq-maroon)]/10 disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
        <p className="mt-2 text-center text-[10px] text-[var(--ordiq-muted)]">
          {lastMode?.mode === "live"
            ? `Answered by ${lastMode.provider} · ${lastMode.model}. `
            : lastMode?.mode
              ? "Answered by the built-in assistant (AI provider unavailable). "
              : ""}
          AI can make mistakes. Please verify important information.
        </p>
      </div>
    </div>
  );
}
