"use client";

import { Pencil } from "lucide-react";

/** Pencil button for a table row; pairs with the row's delete button. */
export function RowEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ordiq-muted)] transition-colors hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-maroon)]"
      title={`Edit ${label}`}
      aria-label={`Edit ${label}`}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}
