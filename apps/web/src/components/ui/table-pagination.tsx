import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TablePaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
  itemLabel?: string;
}

export function TablePagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 15, 20, 50],
  className,
  itemLabel = "entries",
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const canGoPrevious = validCurrentPage > 1;
  const canGoNext = validCurrentPage < totalPages;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-[var(--ordiq-border)]/60 bg-[var(--ordiq-surface)] px-4 py-3 text-xs text-[var(--ordiq-muted)] select-none",
        className,
      )}
    >
      {/* Left side: Rows per page selector */}
      <div className="flex items-center gap-2">
        <label htmlFor={`rows-per-page-${itemLabel}`} className="whitespace-nowrap">
          Rows per page:
        </label>
        <select
          id={`rows-per-page-${itemLabel}`}
          value={pageSize}
          onChange={(e) => {
            const newSize = Number(e.target.value);
            onPageSizeChange(newSize);
            onPageChange(1);
          }}
          className="h-8 rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-2 py-1 text-xs font-medium text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)] cursor-pointer"
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {/* Right side: Page navigation */}
      <div className="flex items-center justify-between sm:justify-end gap-1.5">
        <span className="text-[11px] sm:text-xs mr-2 font-medium text-[var(--ordiq-ink)]">
          Page {validCurrentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={!canGoPrevious}
          title="First page"
          aria-label="First page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] transition-colors hover:bg-[var(--ordiq-surface-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(validCurrentPage - 1)}
          disabled={!canGoPrevious}
          title="Previous page"
          aria-label="Previous page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] transition-colors hover:bg-[var(--ordiq-surface-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(validCurrentPage + 1)}
          disabled={!canGoNext}
          title="Next page"
          aria-label="Next page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] transition-colors hover:bg-[var(--ordiq-surface-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={!canGoNext}
          title="Last page"
          aria-label="Last page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] transition-colors hover:bg-[var(--ordiq-surface-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function usePagination<T>(items: T[], initialPageSize = 15) {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedItems = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalPages,
    paginatedItems,
    totalItems: items.length,
  };
}
