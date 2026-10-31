"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";

export interface TermOption {
  id: string;
  label: string;
  academicYear: string;
  semester: 1 | 2;
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
}

const ShellContext = React.createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = React.useContext(ShellContext);
  if (!ctx) {
    throw new Error("useShell must be used inside AppProviders");
  }
  return ctx;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [selectedTermId, setSelectedTermId] = React.useState<string>(
    DEFAULT_TERM.id,
  );
  const [aiPanelOpen, setAiPanelOpen] = React.useState<boolean>(true);

  const selectedTerm: TermOption =
    INITIAL_TERMS.find((t) => t.id === selectedTermId) ?? DEFAULT_TERM;

  return (
    <QueryClientProvider client={queryClient}>
      <ShellContext.Provider
        value={{
          selectedTerm,
          setSelectedTermId,
          terms: INITIAL_TERMS,
          aiPanelOpen,
          setAiPanelOpen,
        }}
      >
        {children}
      </ShellContext.Provider>
    </QueryClientProvider>
  );
}
