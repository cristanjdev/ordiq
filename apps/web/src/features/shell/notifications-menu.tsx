"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bell, CheckCheck, CheckCircle2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useShell } from "./providers";

/**
 * Header notifications, shown in a right-hand drawer like the AI Assistant.
 * The items are the term's "needs attention" checks (readiness, conflicts,
 * unscheduled classes, loads, proposals) from the briefing endpoint, so the
 * badge always reflects the current data and clears on its own once an issue
 * is resolved. No LLM is involved.
 */

type Severity = "critical" | "warning" | "info" | "ok";

interface NotificationItem {
  id: string;
  severity: Severity;
  title: string;
  examples: string[];
  href: string;
  actionLabel: string;
}

interface BriefingPayload {
  briefing: { termCode: string; items: NotificationItem[]; generatedAt: string };
}

async function fetchBriefing(termCode: string): Promise<BriefingPayload> {
  const res = await fetch(`/api/v1/ai/briefing?termCode=${encodeURIComponent(termCode)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Notifications failed with HTTP ${res.status}`);
  return (await res.json()) as BriefingPayload;
}

const SEVERITY: Record<Severity, { dot: string; label: string; text: string }> = {
  critical: { dot: "bg-red-500", label: "Urgent", text: "text-red-600 dark:text-red-400" },
  warning: { dot: "bg-amber-500", label: "Warning", text: "text-amber-600 dark:text-amber-400" },
  info: { dot: "bg-sky-500", label: "For review", text: "text-sky-600 dark:text-sky-400" },
  ok: { dot: "bg-emerald-500", label: "OK", text: "text-emerald-600 dark:text-emerald-400" },
};

/**
 * Read state is kept per browser and per term. An item is stored by its
 * content, so if it changes (for example, more conflicts appear) it shows as
 * unread again; a resolved issue simply disappears from the list.
 */
const READ_KEY_PREFIX = "ordiq:notifications-read:";

function signature(item: NotificationItem): string {
  return `${item.id}|${item.severity}|${item.title}`;
}

function loadRead(termCode: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(READ_KEY_PREFIX + termCode);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveRead(termCode: string, read: Set<string>): void {
  try {
    window.localStorage.setItem(READ_KEY_PREFIX + termCode, JSON.stringify([...read]));
  } catch {
    // Storage full or blocked: read state just won't survive a reload.
  }
}

/** Keep in sync with the duration-300 classes below (same as the AI panel). */
const TRANSITION_MS = 300;

export function NotificationsMenu({
  termCode,
  termLabel,
  aiEnabled,
}: {
  termCode: string;
  termLabel: string;
  aiEnabled: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const { setAiPanelOpen } = useShell();

  // Below the docked breakpoint the AI panel is also a drawer; never stack two.
  React.useEffect(() => {
    if (open && window.innerWidth < 1536) setAiPanelOpen(false);
  }, [open, setAiPanelOpen]);

  // Same query key as the AI Assistant briefing, so both share one cache.
  const query = useQuery({
    queryKey: ["ai-briefing", termCode],
    queryFn: () => fetchBriefing(termCode),
    refetchInterval: 60_000,
  });

  const items = React.useMemo(
    () =>
      (query.data?.briefing.items ?? []).filter(
        // Proposals live on the AI page; skip them when the assistant is off.
        (item) => aiEnabled || item.id !== "proposals",
      ),
    [query.data, aiEnabled],
  );

  const [read, setRead] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => setRead(loadRead(termCode)), [termCode]);
  const isUnread = (item: NotificationItem) => !read.has(signature(item));
  const unreadCount = items.filter(isUnread).length;

  const markRead = (targets: NotificationItem[]) => {
    // Keep only items that still exist, so storage never grows unbounded.
    const current = new Set(items.map(signature));
    const next = new Set([...read].filter((sig) => current.has(sig)));
    for (const item of targets) next.add(signature(item));
    setRead(next);
    saveRead(termCode, next);
  };

  // Badge and header tag count unread urgent and warning items only.
  const urgent = items.filter(
    (i) => (i.severity === "critical" || i.severity === "warning") && isUnread(i),
  );
  const hasCritical = urgent.some((i) => i.severity === "critical");
  const badge = urgent.length > 9 ? "9+" : String(urgent.length);

  // Drawer animation, same approach as the AI panel: mount on first open,
  // then only flip classes so the slide never rebuilds mid-animation.
  const [mounted, setMounted] = React.useState(false);
  const [shown, setShown] = React.useState(false);
  const [closed, setClosed] = React.useState(true);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setClosed(false);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setClosed(true), TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Close on route change and Escape.
  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Refresh when opened so the list is never stale.
  const { refetch } = query;
  React.useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const label =
    urgent.length > 0 ? `Notifications, ${urgent.length} need attention` : "Notifications";

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-white/90 transition hover:bg-white/10 hover:text-white sm:h-9 sm:w-9",
          open && "bg-white/10 text-white",
        )}
      >
        <Bell className="h-4.5 w-4.5 sm:h-5 sm:w-5" />
        {urgent.length > 0 && (
          <span
            className={cn(
              "absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-xs",
              hasCritical ? "bg-red-600" : "bg-amber-500",
            )}
          >
            {badge}
          </span>
        )}
      </button>

      {mounted && (
        <div
          inert={closed}
          className={cn(
            "fixed inset-0 top-16 z-50 flex justify-end",
            (!shown || closed) && "pointer-events-none",
            closed && "invisible",
          )}
        >
          <div
            className={cn(
              "absolute inset-0 bg-black/45 transition-opacity duration-300 ease-out motion-reduce:transition-none",
              shown ? "opacity-100" : "opacity-0",
            )}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="Notifications"
            className={cn(
              "relative flex h-full min-h-0 w-full max-w-sm flex-col border-l border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] shadow-2xl sm:max-w-md",
              "transform-gpu transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
              shown ? "translate-x-0 opacity-100" : "translate-x-full opacity-60",
            )}
          >
            {/* Header (matches the AI panel) */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/30 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Bell className="h-6 w-6 shrink-0 text-[var(--ordiq-maroon)] dark:text-white" strokeWidth={1.75} />
                <div className="min-w-0">
                  <span className="block text-sm font-bold">Notifications</span>
                  <p className="truncate text-[10px] text-[var(--ordiq-muted)]">{termLabel}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {urgent.length > 0 && (
                  <span
                    className={cn(
                      "mr-1.5 inline-flex h-6 items-center whitespace-nowrap rounded-md px-2 text-[10px] font-semibold leading-none",
                      hasCritical
                        ? "bg-red-600/10 text-red-600 dark:bg-red-500/20 dark:text-red-400"
                        : "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
                    )}
                  >
                    {badge} need attention
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void refetch()}
                  aria-label="Refresh notifications"
                  title="Refresh"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", query.isFetching && "animate-spin")} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {query.isLoading ? (
                <div className="space-y-2" role="status" aria-label="Loading notifications">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-20 animate-pulse rounded-xl bg-[var(--ordiq-surface-muted)]" />
                  ))}
                </div>
              ) : query.isError ? (
                <p className="px-2 py-10 text-center text-xs text-[var(--ordiq-muted)]">
                  Notifications could not load.
                </p>
              ) : items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 py-10 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" strokeWidth={1.75} />
                  <span className="text-sm font-semibold">All clear</span>
                  <span className="text-xs text-[var(--ordiq-muted)]">Nothing needs attention.</span>
                </div>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => {
                    const sev = SEVERITY[item.severity];
                    const unread = isUnread(item);
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => {
                            if (unread) markRead([item]);
                            setOpen(false);
                          }}
                          className={cn(
                            "group block rounded-xl border px-3.5 py-3 transition hover:border-[var(--ordiq-maroon)]/30",
                            unread
                              ? "border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] hover:bg-[var(--ordiq-surface-muted)]/50"
                              : "border-transparent bg-[var(--ordiq-surface-muted)]/50 hover:bg-[var(--ordiq-surface-muted)]",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide", sev.text)}>
                              <span className={cn("h-1.5 w-1.5 rounded-full", sev.dot)} />
                              {sev.label}
                            </span>
                            {unread && (
                              <span
                                className="h-2 w-2 shrink-0 rounded-full bg-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]"
                                aria-label="Unread"
                              />
                            )}
                          </span>
                          <span
                            className={cn(
                              "mt-1 block text-xs leading-snug",
                              unread ? "font-semibold" : "font-medium text-[var(--ordiq-muted)]",
                            )}
                          >
                            {item.title}
                          </span>
                          {item.examples.length > 0 && (
                            <span className="mt-1.5 block space-y-0.5">
                              {item.examples.slice(0, 3).map((ex, i) => (
                                <span key={i} className="block truncate text-[11px] text-[var(--ordiq-muted)]">
                                  {ex}
                                </span>
                              ))}
                            </span>
                          )}
                          <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ordiq-maroon)] group-hover:underline dark:text-[var(--ordiq-orange)]">
                            {item.actionLabel} <ArrowRight className="h-3 w-3" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {items.length > 0 && (
              <div className="shrink-0 p-3 pt-0">
                <button
                  type="button"
                  onClick={() => markRead(items)}
                  disabled={unreadCount === 0}
                  className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--ordiq-surface-muted)]/70 px-4 py-2.5 text-xs font-semibold text-[var(--ordiq-maroon)] transition hover:bg-[var(--ordiq-surface-muted)] disabled:cursor-default disabled:text-[var(--ordiq-muted)] disabled:hover:bg-[var(--ordiq-surface-muted)]/70 dark:text-[var(--ordiq-orange)]"
                >
                  <CheckCheck className="h-4 w-4" />
                  {unreadCount === 0 ? "All caught up" : "Mark all as read"}
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
