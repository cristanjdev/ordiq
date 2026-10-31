"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CalendarDays,
  ChevronDown,
  FileBarChart2,
  Home,
  Landmark,
  MessageSquareText,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  SendHorizontal,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";
import { cn } from "@/lib/utils";
import { useShell } from "./providers";

export interface HealthApiPayload {
  status: "ok" | "degraded";
  web: {
    status: "ok";
    version: string;
    llmProvider: "openai" | "anthropic" | "ollama";
  };
  engine: {
    connected: boolean;
    version: string | null;
    solverTimeLimitSeconds: number | null;
    solverWorkers: number | null;
    hardConstraintCount: number;
    softConstraintCount: number;
    directiveCount: number;
    errorCode: string | null;
  };
}

export async function fetchSystemHealth(): Promise<HealthApiPayload> {
  const response = await fetch("/api/v1/health", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
  return (await response.json()) as HealthApiPayload;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SIDEBAR_NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Faculty", href: "/faculty", icon: Users },
  {
    label: "Courses & Sections",
    href: "/courses-sections",
    icon: BookOpen,
  },
  {
    label: "Rooms & Laboratories",
    href: "/rooms",
    icon: Building2,
  },
  { label: "Schedules", href: "/schedules", icon: CalendarDays },
  { label: "Rules & Preferences", href: "/rules", icon: Settings },
  { label: "Reports", href: "/reports", icon: FileBarChart2 },
  { label: "AI Assistant", href: "/assistant", icon: MessageSquareText },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    selectedTerm,
    setSelectedTermId,
    terms,
    aiPanelOpen,
    setAiPanelOpen,
  } = useShell();
  const [darkMode, setDarkMode] = React.useState(false);

  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: fetchSystemHealth,
    refetchInterval: 30_000,
  });

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const engineConnected = healthQuery.data?.engine.connected ?? false;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--ordiq-bg)] text-[var(--ordiq-ink)]">
      {/* Top Header Bar (Fig. 4) */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/10 bg-gradient-to-r from-[#5a0b12] via-[#48090e] to-[#2e0508] px-4 text-white shadow-md lg:px-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <OrdiqLogo size={42} />
            <div>
              <div className="text-xl font-bold tracking-wider leading-tight">
                ORDIQ
              </div>
              <div className="hidden text-[11px] text-white/80 sm:block">
                Intelligent Class Scheduling and Resource Allocation
              </div>
            </div>
          </Link>

          <div className="hidden h-8 w-px bg-white/20 md:block" />
          <p className="hidden font-serif text-sm italic text-white/90 md:block">
            Order Meets Intelligence.
          </p>
        </div>

        {/* Right Header Controls: Term Selector, Engine Status, Theme, Notifications, Dean Profile */}
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          {/* Term Selector (Fig. 4) */}
          <div className="relative flex items-center">
            <Calendar className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--ordiq-maroon)]" />
            <select
              aria-label="Academic Term Selector"
              value={selectedTerm.id}
              onChange={(e) => setSelectedTermId(e.target.value)}
              className="h-9 appearance-none rounded-lg bg-white pl-9 pr-8 text-xs font-semibold text-[#2d0508] shadow-xs focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-orange)] sm:text-sm"
            >
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-[#685659]" />
          </div>

          {/* Engine Live Health Pill */}
          <div
            title={
              engineConnected
                ? `Engine v${healthQuery.data?.engine.version} (${healthQuery.data?.engine.solverTimeLimitSeconds}s limit, ${healthQuery.data?.engine.solverWorkers} workers)`
                : "Python engine not yet reachable"
            }
            className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium xl:flex"
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                engineConnected ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
            <span>
              {engineConnected ? "Engine Online" : "Engine Standby"}
            </span>
          </div>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle color theme"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/90 transition hover:bg-white/20"
          >
            {darkMode ? (
              <Sun className="h-4 w-4 text-amber-300" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Notification Bell */}
          <button
            type="button"
            aria-label="System notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/90 transition hover:bg-white/20"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ordiq-orange)] px-1 text-[10px] font-bold text-white">
              0
            </span>
          </button>

          {/* Toggle AI Assistant Panel */}
          <button
            type="button"
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            aria-label="Toggle AI Assistant panel"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/90 transition hover:bg-white/20"
          >
            {aiPanelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>

          <div className="hidden h-7 w-px bg-white/20 sm:block" />

          {/* Dean-only Identity Badge (Section 1: Dean-only access) */}
          <div className="hidden items-center gap-2.5 sm:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[var(--ordiq-maroon)] shadow-xs">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-xs font-semibold text-white">
                Office of the Dean
              </div>
              <div className="text-[11px] text-white/75">
                Dean-Only Access · MFA
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main 3-Column Body: Left Sidebar + Center Workspace + Persistent Right AI Panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Navigation Sidebar (Fig. 4) */}
        <aside className="relative hidden w-60 shrink-0 flex-col justify-between overflow-hidden border-r border-white/10 bg-gradient-to-b from-[#4a0a0f] via-[#38070b] to-[#230306] text-white lg:flex">
          <nav
            aria-label="Primary Sidebar Navigation"
            className="relative z-10 flex flex-col gap-1 p-3"
          >
            {SIDEBAR_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-gradient-to-r from-[#ea580c] to-[#88131d] text-white shadow-sm"
                      : "text-white/80 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Subtle Decorative Watermark from Fig. 4 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 opacity-[0.06]"
          >
            <OrdiqLogo size={180} />
          </div>

          {/* Institutional Footer (Fig. 4) */}
          <div className="relative z-10 border-t border-white/10 p-4 text-xs text-white/80">
            <div className="flex items-center gap-2.5 font-medium text-white">
              <Landmark className="h-4 w-4 text-[#f97316]" />
              <span>College of Engineering</span>
            </div>
            <div className="mt-1 text-[11px] text-white/60">
              MSEUF Lucena · 7 Programs
            </div>
            <div className="mt-3 border-t border-white/10 pt-2.5 text-[11px] text-white/55">
              Version 0.1.0 · Candidate Mode
            </div>
          </div>
        </aside>

        {/* Center Main Workspace */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>

        {/* Persistent Right AI Assistant Panel (Fig. 4 & Decision D-22) */}
        {aiPanelOpen && (
          <aside
            aria-label="Persistent AI Assistant Panel"
            className="hidden w-88 shrink-0 flex-col border-l border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] xl:flex"
          >
            {/* Panel Header */}
            <div className="flex items-center justify-between border-b border-[var(--ordiq-border)] px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <OrdiqLogo size={30} />
                <span className="text-sm font-bold text-[var(--ordiq-ink)]">
                  AI Assistant
                </span>
                <Badge variant="orange">Beta</Badge>
              </div>
              <Badge variant="neutral" className="text-[10px]">
                Privacy Gateway Active
              </Badge>
            </div>

            {/* Assistant Messages Area */}
            <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4 text-xs leading-relaxed">
              <div className="flex items-start gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ordiq-maroon)] text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3.5 text-[var(--ordiq-ink)]">
                  <p className="font-semibold">
                    Hello! I&apos;m your ORDIQ assistant.
                  </p>
                  <p className="mt-1 text-[var(--ordiq-muted)]">
                    You can ask me in English, Filipino, or Taglish to:
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[var(--ordiq-ink)]">
                    <li>Check for hard constraint conflicts</li>
                    <li>Generate or compare candidate schedules</li>
                    <li>Analyze faculty loads and room usage</li>
                    <li>Add directives and propose validated moves</li>
                  </ul>
                  <p className="mt-2.5 text-[11px] text-[var(--ordiq-muted)]">
                    All faculty names are replaced with{" "}
                    <code className="rounded bg-black/5 px-1 py-0.5 font-mono dark:bg-white/10">
                      Faculty.alias
                    </code>{" "}
                    before leaving the system.
                  </p>
                </div>
              </div>

              {/* Quick Actions from Fig. 4 */}
              <div className="pl-9">
                <p className="mb-2 text-[11px] font-medium text-[var(--ordiq-muted)]">
                  Suggested actions (Phase 4):
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="justify-start"
                    disabled
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate alternatives
                  </Button>
                  <Button
                    variant="maroonOutline"
                    size="sm"
                    className="justify-start"
                    disabled
                  >
                    Show in spreadsheet
                  </Button>
                  <Button
                    variant="maroonOutline"
                    size="sm"
                    className="justify-start"
                    disabled
                  >
                    Check room conflicts
                  </Button>
                </div>
              </div>
            </div>

            {/* Chat Input & Mandatory Verification Notice (Fig. 4 & Phase 4D) */}
            <div className="border-t border-[var(--ordiq-border)] p-3.5">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 py-2">
                <input
                  type="text"
                  disabled
                  placeholder="Type your message... (enabled in Phase 4)"
                  aria-label="Chat message input"
                  className="w-full bg-transparent text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:outline-none disabled:cursor-not-allowed"
                />
                <SendHorizontal className="h-4 w-4 text-[var(--ordiq-maroon)] opacity-60" />
              </div>
              <p className="mt-2 text-center text-[11px] text-[var(--ordiq-muted)]">
                AI can make mistakes. Please verify important information.
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

