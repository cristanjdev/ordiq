"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  CalendarDays,
  ChevronDown,
  FileBarChart2,
  Home,
  Landmark,
  LogOut,
  Menu,
  Moon,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Sun,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSystemSettings } from "@/features/settings/settings-api";
import * as React from "react";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { MseufLogo } from "@/components/ui/mseuf-logo";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";
import { useAuthSession } from "@/features/auth/auth-session-provider";
import { cn } from "@/lib/utils";
import { PageLoadingSkeleton } from "./page-loading-skeleton";
import { AiAssistantPanel } from "./ai-panel";
import { NotificationsMenu } from "./notifications-menu";
import { useShell } from "./providers";

export interface HealthApiPayload {
  status: "ok" | "degraded";
  web: {
    status: "ok";
    version: string;
    llmProvider: "openai" | "anthropic" | "gemini" | "ollama";
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
  { label: "Faculty", href: "/faculty", icon: User },
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
  { label: "AI Assistant", href: "/assistant", icon: Sparkles },
  { label: "Settings", href: "/settings", icon: SlidersHorizontal },
] as const;

/** Keep in sync with the duration-300 classes on the AI panel. */
const AI_PANEL_TRANSITION_MS = 300;

const DOCKED_QUERY = "(min-width: 1536px)";

/** True at the 2xl breakpoint, where the AI panel docks beside the page. */
function useIsDockedViewport(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(DOCKED_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DOCKED_QUERY).matches,
    () => false,
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const {
    selectedTerm,
    setSelectedTermId,
    terms,
    aiPanelOpen,
    setAiPanelOpen,
    mobileNavOpen,
    setMobileNavOpen,
  } = useShell();
  const [darkMode, setDarkMode] = React.useState(false);
  const [navigatingHref, setNavigatingHref] = React.useState<string | null>(null);

  // Clear navigating state when pathname updates
  React.useEffect(() => {
    setNavigatingHref(null);
  }, [pathname]);

  // Any in-app link (sidebar, notifications, page links) shows the page
  // loading state in the body until the new route has rendered.
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      if (url.pathname.startsWith("/api/")) return;
      setNavigatingHref(url.pathname);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Safety net: never leave the loading state up if a navigation is abandoned.
  React.useEffect(() => {
    if (!navigatingHref) return;
    const timer = window.setTimeout(() => setNavigatingHref(null), 20_000);
    const onPop = () => setNavigatingHref(null);
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
    };
  }, [navigatingHref]);

  // Sync darkMode with document class on mount
  React.useEffect(() => {
    if (typeof document !== "undefined") {
      setDarkMode(document.documentElement.classList.contains("dark"));
    }
  }, []);

  // Close mobile nav and any <2xl overlay AI drawer automatically on route change
  React.useEffect(() => {
    setMobileNavOpen(false);
    if (typeof window !== "undefined" && window.innerWidth < 1536) {
      setAiPanelOpen(false);
    }
  }, [pathname, setMobileNavOpen, setAiPanelOpen]);

  // Dynamically close the AI drawer if the viewport shrinks below the 2xl docked breakpoint
  // so a docked panel never turns into a blocking modal overlay unexpectedly.
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQuery = window.matchMedia("(min-width: 1536px)");
    const handleViewportChange = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        setAiPanelOpen(false);
      }
    };
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, [setAiPanelOpen]);

  // AI panel animation. The panel is mounted on first open and then kept
  // mounted, so opening again only flips classes (no rebuild mid-animation).
  // Only transform and opacity animate, which the GPU handles without
  // re-laying out the page on every frame.
  const isDocked = useIsDockedViewport();
  const [aiPanelMounted, setAiPanelMounted] = React.useState(aiPanelOpen);
  const [aiPanelShown, setAiPanelShown] = React.useState(aiPanelOpen);
  // True once the closing slide has finished; the panel is then hidden from
  // focus and screen readers, and the docked space is given back to the page.
  const [aiPanelClosed, setAiPanelClosed] = React.useState(!aiPanelOpen);
  React.useEffect(() => {
    if (aiPanelOpen) {
      setAiPanelMounted(true);
      setAiPanelClosed(false);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setAiPanelShown(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setAiPanelShown(false);
    const timer = window.setTimeout(() => setAiPanelClosed(true), AI_PANEL_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [aiPanelOpen]);

  // Handle Escape key to dismiss drawers
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mobileNavOpen) setMobileNavOpen(false);
        if (aiPanelOpen) setAiPanelOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen, aiPanelOpen, setMobileNavOpen, setAiPanelOpen]);

  // The AI Assistant can be turned off in Settings: hide its menu item,
  // launcher button and panel.
  const { settings: systemSettings } = useSystemSettings();
  const aiEnabled = systemSettings.ai.assistantEnabled;
  const navItems = React.useMemo(
    () => SIDEBAR_NAV_ITEMS.filter((item) => aiEnabled || item.href !== "/assistant"),
    [aiEnabled],
  );
  React.useEffect(() => {
    if (!aiEnabled) setAiPanelOpen(false);
  }, [aiEnabled, setAiPanelOpen]);

  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: fetchSystemHealth,
    refetchInterval: 30_000,
  });

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (typeof document !== "undefined") {
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);
  const [logoutError, setLogoutError] = React.useState<string | null>(null);
  const { user, signOut } = useAuthSession();

  const displayName = React.useMemo(() => {
    const raw = user?.username?.trim();
    if (!raw) return "Dean";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user?.username]);

  const userInitial = displayName.charAt(0).toUpperCase();
  const roleLabel =
    user?.role === "DEAN" ? "Office of the Dean" : (user?.role ?? "Office of the Dean");

  const confirmLogout = async () => {
    setIsLoggingOut(true);
    setLogoutError(null);
    try {
      // Ends the server session, notifies other tabs, and navigates to /login.
      await signOut();
    } catch {
      // Never pretend to be signed out while the server session is still live.
      setLogoutError(
        "Could not reach the server to end your session. Please try again.",
      );
      setIsLoggingOut(false);
    }
  };

  const engineConnected = healthQuery.data?.engine.connected ?? false;

  return (
    <div className="flex h-screen h-[100dvh] max-h-screen flex-col overflow-hidden bg-[var(--ordiq-bg)] text-[var(--ordiq-ink)]">
      {/* Top Header Bar matching MSEUF Reference */}
      <header className="sticky top-0 z-50 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-gradient-to-r from-[#5a0e19] via-[#480a13] to-[#2d0508] px-3 sm:px-4 lg:px-6 text-white shadow-md relative">
        <div className="flex items-center gap-2.5 sm:gap-4">
          {/* Mobile Navigation Drawer Toggle */}
          <button
            type="button"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-label="Toggle navigation menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white transition hover:bg-white/20 lg:hidden"
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {/* MSEUF Branding Link (The ONLY top logo header, matching reference) */}
          <Link href="/" className="flex items-center gap-3">
            <MseufLogo size={36} variant="white" className="drop-shadow-xs" />
            <div className="flex flex-col justify-center leading-tight">
              <div className="flex items-center gap-2.5">
                <span className="text-lg sm:text-xl font-bold tracking-wider text-white">
                  MSEUF
                </span>
                <div className="hidden h-4 w-px bg-white/25 sm:block" />
                <span className="hidden text-xs font-semibold text-white/90 sm:inline-block">
                  Class Scheduling &amp; Resource Allocation System
                </span>
              </div>
              <p className="hidden text-[10px] text-white/75 sm:block mt-0.5">
                Smarter Schedules. Better Decisions.
              </p>
            </div>
          </Link>
        </div>

        {/* Right Header Controls matching MSEUF Reference */}
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          {/* Term Selector (Matching reference: Landmark icon, full title, white rounded pill) */}
          <div className="relative flex items-center">
            <Landmark className="pointer-events-none absolute left-2.5 sm:left-3 h-3.5 sm:h-4 w-3.5 sm:w-4 text-[#5a0e19]" />
            <select
              aria-label="Academic Term Selector"
              value={selectedTerm.id}
              onChange={(e) => setSelectedTermId(e.target.value)}
              className="h-8 sm:h-9 appearance-none rounded-lg bg-white pl-8 sm:pl-9 pr-7 sm:pr-8 text-xs font-semibold text-[#2d0508] shadow-xs focus:outline-none focus:ring-2 focus:ring-[#ea580c] sm:min-w-[235px] cursor-pointer"
            >
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 sm:right-2.5 h-3.5 sm:h-4 w-3.5 sm:w-4 text-[#685659]" />
          </div>

          {/* Theme Toggle Button (Light / Dark) */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={darkMode ? "Switch to light theme" : "Switch to dark theme"}
            title={darkMode ? "Switch to light theme" : "Switch to dark theme"}
            className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            {darkMode ? (
              <Sun className="h-4.5 w-4.5 text-amber-300" />
            ) : (
              <Moon className="h-4.5 w-4.5 text-white/90" />
            )}
          </button>

          {/* Notifications: live "needs attention" items for the selected term */}
          <NotificationsMenu
            termCode={selectedTerm.id}
            termLabel={selectedTerm.label}
            aiEnabled={aiEnabled}
          />

          {/* Authenticated User Avatar & Profile */}
          <div
            className="flex items-center gap-2 pl-0.5 sm:pl-1"
            title={user?.email ? `${displayName} (${user.email})` : displayName}
          >
            <div className="flex h-8 sm:h-9 w-8 sm:w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#5a0e19] shadow-xs font-bold text-sm">
              {userInitial}
            </div>
            <div className="hidden text-left leading-tight sm:block">
              <div className="text-xs font-bold text-white">
                Hi, {displayName}
              </div>
              <div className="text-[10px] text-white/75">
                {roleLabel}
              </div>
            </div>
          </div>

          {/* Logout Button Icon */}
          <button
            type="button"
            onClick={() => setShowLogoutModal(true)}
            aria-label="Sign out"
            title="Sign out / Logout"
            className="flex h-8 sm:h-9 w-8 sm:w-9 items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <LogOut className="h-4 sm:h-4.5 w-4 sm:w-4.5" />
          </button>
        </div>

        {/* Navigation Progress Bar (Active when moving between pages) */}
        {navigatingHref && (
          <div
            className="absolute bottom-0 left-0 right-0 h-0.75 overflow-hidden bg-black/20 pointer-events-none"
            role="progressbar"
            aria-label="Loading page"
          >
            <div className="h-full w-full bg-gradient-to-r from-amber-400 via-orange-500 to-amber-300 animate-indeterminate-progress" />
          </div>
        )}
      </header>

      {/* Main 3-Column Body: Left Sidebar + Center Workspace + Persistent/Responsive Right AI Panel */}
      <div className="flex flex-1 min-h-0 h-[calc(100dvh-4rem)] overflow-hidden relative">
        {/* Left Desktop Navigation Sidebar */}
        <aside className="relative hidden w-64 shrink-0 h-full min-h-0 flex-col justify-between overflow-hidden border-r border-white/10 bg-gradient-to-b from-[#4a0a0f] via-[#38070b] to-[#230306] text-white lg:flex">
          <nav
            aria-label="Primary Sidebar Navigation"
            className="relative z-10 flex flex-1 min-h-0 flex-col gap-1 p-3 pt-4 overflow-y-auto"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              const isPending =
                navigatingHref !== null &&
                (item.href === "/" ? navigatingHref === "/" : navigatingHref.startsWith(item.href));
              const isItemActive = navigatingHref ? isPending : isActive;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-xs font-medium transition-all relative group",
                    isItemActive
                      ? "bg-white/15 text-white shadow-xs font-semibold ring-1 ring-white/15"
                      : isPending
                        ? "bg-white/10 text-white font-semibold ring-1 ring-white/10"
                        : "text-white/75 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isItemActive || isPending
                        ? "text-amber-400"
                        : "text-white/70 group-hover:text-white",
                    )}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Institutional Footer */}
          <div className="relative z-10 shrink-0 bg-gradient-to-b from-transparent via-black/15 to-black/35 px-4 pt-6 pb-4 text-xs text-white/80">
            <div className="flex items-center gap-2 font-medium text-white">
              <Landmark className="h-4 w-4 text-[#ea580c] shrink-0" />
              <span className="font-semibold text-xs">College of Engineering</span>
            </div>
            <div className="mt-1 text-[11px] text-white/70">
              Manuel S. Enverga University Foundation
            </div>
            <div className="text-[10px] text-white/50">Lucena City</div>
            <div className="mt-2.5 text-[10px] text-white/50 flex justify-between items-center">
              <span>Version 1.0.0</span>
              <span className={cn("font-mono text-[10px] flex items-center gap-1", engineConnected ? "text-emerald-400" : "text-amber-400")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", engineConnected ? "bg-emerald-400" : "bg-amber-400")} />
                {engineConnected ? "Ready" : "Standby"}
              </span>
            </div>
          </div>
        </aside>

        {/* Mobile Slide-Over Navigation Drawer (< lg) */}
        {mobileNavOpen && (
          <div className="fixed inset-0 top-16 z-50 flex lg:hidden">
            {/* Backdrop */}
            <div
              className="fixed inset-0 top-16 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />

            {/* Slide-in menu container */}
            <div className="relative z-50 flex h-full w-72 max-w-[85vw] min-h-0 flex-col justify-between bg-gradient-to-b from-[#4a0a0f] via-[#38070b] to-[#230306] text-white shadow-2xl animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5 shrink-0">
                <span className="text-xs font-bold uppercase tracking-wider text-white/80">
                  Navigation
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-lg p-1 text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="flex-1 min-h-0 space-y-1 p-3 overflow-y-auto">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href);
                  const isPending =
                    navigatingHref !== null &&
                    (item.href === "/" ? navigatingHref === "/" : navigatingHref.startsWith(item.href));
                  const isItemActive = navigatingHref ? isPending : isActive;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-xs font-medium transition-all relative group",
                        isItemActive
                          ? "bg-white/15 text-white shadow-xs font-semibold ring-1 ring-white/15"
                          : isPending
                            ? "bg-white/10 text-white font-semibold ring-1 ring-white/10"
                            : "text-white/75 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0 transition-colors",
                          isItemActive || isPending
                            ? "text-amber-400"
                            : "text-white/70 group-hover:text-white",
                        )}
                      />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="shrink-0 bg-gradient-to-b from-transparent via-black/15 to-black/35 px-4 pt-6 pb-4 text-xs text-white/70">
                <div className="font-semibold text-white">College of Engineering</div>
                <div className="text-[11px] text-white/60">
                  Manuel S. Enverga University Foundation
                </div>
                <div className="mt-2 text-[10px] text-white/40">Version 1.0.0</div>
              </div>
            </div>
          </div>
        )}

        {/* Center Main Workspace */}
        <main
          className={cn(
            "flex-1 min-h-0 h-full overflow-y-auto p-3 sm:p-5 lg:p-6",
            // Docked: the page makes room as the panel starts opening and
            // takes the space back once it has slid away.
            isDocked && !aiPanelClosed && "mr-92",
          )}
        >
          <div className="mx-auto max-w-7xl">
            {navigatingHref && <PageLoadingSkeleton />}
            {/* Kept mounted so an abandoned navigation returns to the same state */}
            <div className={navigatingHref ? "hidden" : undefined}>{children}</div>
          </div>
        </main>

        {/* AI Assistant: docked beside the page at 2xl, a drawer over it below */}
        {aiEnabled && aiPanelMounted && (
          <div
            inert={aiPanelClosed}
            className={cn(
              isDocked
                ? "absolute inset-y-0 right-0 z-30 w-92"
                : "fixed inset-0 top-16 z-40 flex justify-end",
              (!aiPanelShown || aiPanelClosed) && "pointer-events-none",
              aiPanelClosed && "invisible",
            )}
          >
            {!isDocked && (
              <div
                className={cn(
                  "absolute inset-0 bg-black/45 transition-opacity duration-300 ease-out motion-reduce:transition-none",
                  aiPanelShown ? "opacity-100" : "opacity-0",
                )}
                onClick={() => setAiPanelOpen(false)}
                aria-hidden="true"
              />
            )}
            <aside
              aria-label="AI Assistant"
              className={cn(
                "relative flex h-full min-h-0 flex-col border-l border-[var(--ordiq-border)] bg-[var(--ordiq-surface)]",
                isDocked ? "w-full shadow-xs" : "w-full max-w-sm sm:max-w-md shadow-2xl",
                "transform-gpu transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none",
                aiPanelShown ? "translate-x-0 opacity-100" : "translate-x-full opacity-60",
              )}
            >
              <AiAssistantPanel
                isMobileDrawer={!isDocked}
                onClose={() => setAiPanelOpen(false)}
              />
            </aside>
          </div>
        )}

        {/* Floating AI launcher icon button when closed */}
        {aiEnabled && !aiPanelOpen && aiPanelClosed && (
          <button
            type="button"
            onClick={() => setAiPanelOpen(true)}
            aria-label="Open AI Assistant"
            title="Open AI Assistant"
            className={cn(
              "fixed bottom-4 right-4 sm:bottom-5 sm:right-5 z-40 flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg sm:rounded-xl shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer animate-ai-launcher-in",
              darkMode
                ? "bg-white hover:bg-neutral-100 border border-neutral-200 text-[#5a0e19] shadow-black/20 hover:shadow-[0_6px_20px_-3px_rgba(255,255,255,0.2)]"
                : "bg-[#5a0e19] hover:bg-[#480a13] border border-white/20 text-white shadow-black/20 hover:shadow-[0_6px_20px_-3px_rgba(90,14,25,0.4)]",
            )}
          >
            <OrdiqLogo
              size={24}
              className="h-5 w-5 sm:h-6 sm:w-6"
              variant={darkMode ? "maroon" : "white"}
              alt="AI Assistant"
            />
          </button>
        )}
        {/* Confirmation Modal for Sign Out */}
        <ConfirmationModal
          isOpen={showLogoutModal}
          onClose={() => {
            setShowLogoutModal(false);
            setLogoutError(null);
          }}
          onConfirm={confirmLogout}
          title="Sign Out of ORDIQ"
          description={
            <>
              <p>
                Are you sure you want to sign out of the Dean scheduling portal?
                Your active session token will be invalidated and you will be
                returned to the sign-in screen.
              </p>
              {logoutError && (
                <p
                  role="alert"
                  className="mt-2 font-medium text-red-600 dark:text-red-400"
                >
                  {logoutError}
                </p>
              )}
            </>
          }
          confirmText="Sign Out"
          variant="danger"
          icon={<LogOut className="h-5 w-5 text-red-600 dark:text-red-400" />}
          isLoading={isLoggingOut}
        />
      </div>
    </div>
  );
}
