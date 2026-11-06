import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder rows shown inside a table's <tbody> while its data loads. The
 * rows take the table's own columns, so the skeleton has the same layout and
 * scrolls the same way as the real table on every screen size.
 */
export interface TableSkeletonRowsProps {
  /** Number of columns in the table (one placeholder cell per column). */
  columns: number;
  /** Number of placeholder rows; defaults to 6. */
  rows?: number;
  /** Text read by screen readers, e.g. "Loading subjects". */
  label?: string;
  /** Column indexes whose cells hold buttons (drawn as small squares). */
  actionColumns?: number[];
  /** Align placeholder bars like the real cells; defaults to centred except the first column. */
  align?: "left" | "center";
  rowClassName?: string;
}

// Varied widths so the placeholder looks like real text, not a grid of bars.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-2/5", "w-3/5", "w-1/3"];

export function TableSkeletonRows({
  columns,
  rows = 6,
  label = "Loading",
  actionColumns = [],
  align = "center",
  rowClassName,
}: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr
          key={r}
          aria-hidden={r > 0 ? true : undefined}
          className={cn("border-b border-[var(--ordiq-border)]/40", rowClassName)}
        >
          {Array.from({ length: columns }, (_, c) => {
            const first = c === 0;
            const action = actionColumns.includes(c);
            return (
              <td key={c} className="px-4 py-3">
                {r === 0 && c === 0 && (
                  <span role="status" className="sr-only">
                    {label}…
                  </span>
                )}
                {action ? (
                  <div className="flex justify-center gap-1.5">
                    <SkeletonBlock className="h-6 w-6 rounded-md" />
                    <SkeletonBlock className="h-6 w-6 rounded-md" />
                  </div>
                ) : (
                  <div
                    className={cn(
                      "flex flex-col gap-1.5",
                      !first && align === "center" ? "items-center" : "items-start",
                    )}
                  >
                    <SkeletonBlock
                      className={cn("h-3", first ? "w-4/5 max-w-[11rem]" : WIDTHS[(r + c) % WIDTHS.length])}
                    />
                    {first && <SkeletonBlock className="h-2.5 w-1/2 max-w-[7rem] opacity-70" />}
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[var(--ordiq-border)]/70 motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/**
 * Thin moving bar for a table that is refreshing data it already shows
 * (after a save, a term switch or a background refetch).
 */
export function TableRefreshBar({ active, className }: { active: boolean; className?: string }) {
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Refreshing"
      className={cn("relative h-0.5 w-full overflow-hidden bg-[var(--ordiq-maroon)]/10", className)}
    >
      <div className="absolute inset-y-0 left-0 w-full animate-indeterminate-progress bg-[var(--ordiq-maroon)] motion-reduce:animate-none dark:bg-[var(--ordiq-orange)]" />
    </div>
  );
}

/** Rows to draw while loading: the page size, kept between 3 and 10. */
export function skeletonRowCount(pageSize?: number): number {
  return Math.min(10, Math.max(3, pageSize ?? 6));
}
