import { Loader2 } from "lucide-react";

export function PageLoadingSkeleton() {
  return (
    <div
      className="space-y-6 animate-in fade-in duration-150"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Page Header Skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 sm:w-64 rounded-md bg-[var(--ordiq-border)] animate-pulse" />
          <div className="h-4 w-72 sm:w-96 rounded-md bg-[var(--ordiq-border)]/60 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-24 rounded-md bg-[var(--ordiq-border)]/70 animate-pulse" />
          <div className="h-8 w-24 rounded-md bg-[var(--ordiq-border)]/70 animate-pulse" />
        </div>
      </div>

      {/* KPI / Metric Summary Cards Skeleton */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-4 sm:p-5 shadow-xs"
          >
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 shrink-0 rounded-full bg-[var(--ordiq-surface-muted)] animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-20 rounded bg-[var(--ordiq-border)]/60 animate-pulse" />
                <div className="h-6 w-14 rounded bg-[var(--ordiq-border)] animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Table / Workspace Card Skeleton */}
      <div className="rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-xs overflow-hidden">
        {/* Tab or Header Bar Skeleton */}
        <div className="p-2 sm:p-2.5 bg-[var(--ordiq-surface-muted)]/70">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 w-full">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-9 rounded-lg bg-[var(--ordiq-surface)]/80 animate-pulse"
              />
            ))}
          </div>
        </div>

        {/* Toolbar Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 sm:px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-20 rounded-md bg-[var(--ordiq-surface-muted)] animate-pulse" />
            <div className="h-8 w-20 rounded-md bg-[var(--ordiq-surface-muted)] animate-pulse" />
            <div className="h-8 w-20 rounded-md bg-[var(--ordiq-surface-muted)] animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 w-48 rounded-md bg-[var(--ordiq-surface-muted)] animate-pulse" />
            <div className="h-8 w-28 rounded-md bg-[var(--ordiq-surface-muted)] animate-pulse" />
          </div>
        </div>

        {/* Table Rows Skeleton */}
        <div className="p-4 space-y-3">
          <div className="h-8 w-full rounded bg-[var(--ordiq-surface-muted)]/80 animate-pulse" />
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-4 py-2"
            >
              <div className="h-4 w-1/4 rounded bg-[var(--ordiq-surface-muted)] animate-pulse" />
              <div className="h-4 w-1/6 rounded bg-[var(--ordiq-surface-muted)] animate-pulse" />
              <div className="h-4 w-1/5 rounded bg-[var(--ordiq-surface-muted)] animate-pulse" />
              <div className="h-4 w-1/8 rounded bg-[var(--ordiq-surface-muted)] animate-pulse" />
            </div>
          ))}
        </div>

        {/* Subtle Status Notice */}
        <div className="flex items-center justify-center gap-2 py-4 text-xs font-medium text-[var(--ordiq-muted)] bg-[var(--ordiq-surface-muted)]/30">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ordiq-maroon)]" />
          <span>Loading workspace data...</span>
        </div>
      </div>
    </div>
  );
}
