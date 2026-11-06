"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import * as React from "react";

export interface TermOption {
  id: string;
  label: string;
  academicYear: string;
  semester: 1 | 2;
  status?: "DRAFT" | "READY" | "ACTIVE" | "ARCHIVED";
  /** Teaching day in minutes after midnight (e.g. 450 = 7:30 AM). */
  dayStartMin?: number;
  dayEndMin?: number;
}

interface TermDto {
  code: string;
  academicYear: string;
  semester: 1 | 2;
  status: "DRAFT" | "READY" | "ACTIVE" | "ARCHIVED";
  dayStartMin?: number;
  dayEndMin?: number;
}

const STATUS_SUFFIX: Record<TermDto["status"], string> = {
  ACTIVE: "",
  READY: " · Ready",
  DRAFT: " · Draft",
  ARCHIVED: " · Archived",
};

function toTermOption(t: TermDto): TermOption {
  const semester = t.semester === 1 ? "1st" : "2nd";
  return {
    id: t.code,
    label: `${semester} Semester, AY ${t.academicYear.replace("-", " – ")}${STATUS_SUFFIX[t.status]}`,
    academicYear: t.academicYear,
    semester: t.semester,
    status: t.status,
    dayStartMin: t.dayStartMin,
    dayEndMin: t.dayEndMin,
  };
}

export const DEFAULT_TERM: TermOption = {
  id: "AY2026-2027-S1",
  label: "1st Semester, AY 2026 – 2027",
  academicYear: "2026-2027",
  semester: 1,
};

export const INITIAL_TERMS: readonly TermOption[] = [
  DEFAULT_TERM,
  {
    id: "AY2026-2027-S2",
    label: "2nd Semester, AY 2026 – 2027",
    academicYear: "2026-2027",
    semester: 2,
  },
] as const;

interface ShellContextValue {
  selectedTerm: TermOption;
  setSelectedTermId: (id: string) => void;
  terms: readonly TermOption[];
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used inside AppProviders");
  }
  return ctx;
}

const MAX_NETWORK_RETRIES = 3;

/**
 * Retry a query only when the request never reached the server (Wi-Fi switch,
 * VPN reconnect, ERR_NETWORK_CHANGED, server restarting): `fetch` rejects with
 * a TypeError then. Real answers from the API (401, 404, validation errors)
 * are never retried; they surface immediately.
 */
function retryNetworkFailures(failureCount: number, error: unknown): boolean {
  return error instanceof TypeError && failureCount < MAX_NETWORK_RETRIES;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: retryNetworkFailures,
            retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 4_000),
            // After the connection comes back, reload anything that failed.
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ShellStateProvider>{children}</ShellStateProvider>
    </QueryClientProvider>
  );
}

/**
 * Term picker state. Terms come from the database (`/api/v1/terms`); the
 * built-in list is only a fallback before sign-in or while loading. Without
 * an explicit choice the ACTIVE term is selected.
 */
function ShellStateProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pickedTermId, setSelectedTermId] = React.useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = React.useState<boolean>(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState<boolean>(false);

  const termsQuery = useQuery({
    queryKey: ["terms"],
    enabled: !pathname.startsWith("/login"),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/v1/terms");
      if (!res.ok) throw new Error("Terms unavailable");
      return ((await res.json()) as { items: TermDto[] }).items;
    },
  });

  const terms: readonly TermOption[] = React.useMemo(() => {
    const items = termsQuery.data;
    if (!items || items.length === 0) return INITIAL_TERMS;
    return [...items].sort((a, b) => b.code.localeCompare(a.code)).map(toTermOption);
  }, [termsQuery.data]);

  const selectedTerm: TermOption =
    terms.find((t) => t.id === pickedTermId) ??
    terms.find((t) => t.status === "ACTIVE") ??
    terms.find((t) => t.id === DEFAULT_TERM.id) ??
    terms[0] ??
    DEFAULT_TERM;

  return (
    <ShellContext.Provider
      value={{
        selectedTerm,
        setSelectedTermId,
        terms,
        aiPanelOpen,
        setAiPanelOpen,
        mobileNavOpen,
        setMobileNavOpen,
      }}
    >
      {children}
    </ShellContext.Provider>
  );
}
