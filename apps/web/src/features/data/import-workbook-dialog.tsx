"use client";

import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { workbookTemplateUrl, type WorkbookTemplateScope } from "@/lib/workbook-templates";

/**
 * Import an ORDIQ workbook (.xlsx) through `/api/v1/imports`.
 *
 * The file is always checked first (dry run): nothing is saved until the
 * check passes and the Dean confirms. The workbook may hold any of the sheets;
 * rows are added or updated by their codes, never deleted.
 */

interface ImportSummary {
  batchId: string;
  dryRun: boolean;
  alreadyCommitted: boolean;
  status: "DRY_RUN" | "COMMITTED" | "FAILED";
  rowCount: number;
  countsBySheet: Record<string, number>;
  errors: Array<{ sheet: string; row: number; column: string; message: string }>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 50;

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function postImport(termCode: string, workbookBase64: string, dryRun: boolean): Promise<ImportSummary> {
  const res = await fetch("/api/v1/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ termCode, workbookBase64, dryRun }),
  });
  const body = (await res.json().catch(() => null)) as
    | (ImportSummary & { error?: undefined })
    | { error?: { message?: string } }
    | null;
  if (body && "status" in body) return body;
  throw new Error(body?.error?.message ?? "The workbook could not be read. Check that it is an .xlsx file.");
}

export function ImportWorkbookDialog({
  open,
  onClose,
  termCode,
  title,
  templateScope,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  termCode: string;
  title: string;
  templateScope: WorkbookTemplateScope;
  onImported: (summary: ImportSummary) => void | Promise<void>;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [encoded, setEncoded] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<ImportSummary | null>(null);
  const [busy, setBusy] = React.useState<"check" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setFile(null);
    setEncoded(null);
    setPreview(null);
    setBusy(null);
    setError(null);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const chooseFile = (next: File | null) => {
    setPreview(null);
    setEncoded(null);
    setError(null);
    if (next && !next.name.toLowerCase().endsWith(".xlsx")) {
      setError("Choose an Excel workbook (.xlsx).");
      setFile(null);
      return;
    }
    if (next && next.size > MAX_FILE_BYTES) {
      setError("The workbook is larger than 5 MB.");
      setFile(null);
      return;
    }
    setFile(next);
  };

  const check = async () => {
    if (!file) return;
    setBusy("check");
    setError(null);
    try {
      const data = encoded ?? (await fileToBase64(file));
      setEncoded(data);
      setPreview(await postImport(termCode, data, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The workbook could not be checked.");
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!encoded) return;
    setBusy("import");
    setError(null);
    try {
      const summary = await postImport(termCode, encoded, false);
      if (summary.status === "FAILED") {
        setPreview(summary);
        return;
      }
      await onImported(summary);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The workbook could not be imported.");
    } finally {
      setBusy(null);
    }
  };

  const sheetCounts = Object.entries(preview?.countsBySheet ?? {}).filter(([, n]) => n > 0);
  const canImport = preview !== null && preview.errors.length === 0 && preview.rowCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => busy === null && onClose()} />
      <div className="relative flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ordiq-border)] px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ordiq-maroon)] text-white">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--ordiq-ink)]">{title}</h2>
              <p className="mt-1 text-xs text-[var(--ordiq-muted)]">{termCode}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ordiq-muted)] transition hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)] disabled:opacity-50 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-xs sm:p-6" aria-busy={busy !== null}>
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                chooseFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
              className="group flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/40 px-5 py-7 text-center transition hover:border-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)] disabled:pointer-events-none disabled:opacity-60"
              aria-label={file ? `Change workbook: ${file.name}` : "Choose Excel workbook"}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ordiq-surface)] text-[var(--ordiq-maroon)] shadow-sm dark:text-[var(--ordiq-orange)]">
                {file ? <FileSpreadsheet className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
              </span>
              <span className="block w-full min-w-0 space-y-1">
                <span className="block truncate text-sm font-semibold text-[var(--ordiq-ink)]" title={file?.name}>
                  {file ? file.name : "Choose your workbook"}
                </span>
                <span className="block text-xs text-[var(--ordiq-muted)]">
                  {file ? `${Math.max(1, Math.round(file.size / 1024))} KB · Click to change` : ".xlsx files up to 5 MB"}
                </span>
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs">
            <span className="text-[var(--ordiq-muted)]">Need a starting point?</span>
            <a
              href={workbookTemplateUrl(templateScope, termCode)}
              className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-[var(--ordiq-maroon)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)] dark:text-[var(--ordiq-orange)]"
            >
              <Download className="h-3.5 w-3.5" />
              Download template
            </a>
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {preview && (
            <div className="space-y-3" aria-live="polite">
              {preview.errors.length > 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {preview.errors.length} problem{preview.errors.length === 1 ? "" : "s"} found. Fix the rows below and check again.
                </div>
              ) : preview.rowCount === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  The workbook has no data rows. Sheet names and column headers must match the template.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {preview.rowCount} rows ready to import.
                </div>
              )}

              {sheetCounts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sheetCounts.map(([sheet, n]) => (
                    <Badge key={sheet} variant="neutral">
                      {sheet}: {n}
                    </Badge>
                  ))}
                </div>
              )}

              {preview.errors.length > 0 && (
                <div className="overflow-x-auto rounded-md border border-[var(--ordiq-border)]">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[var(--ordiq-surface-muted)] text-left font-semibold text-[var(--ordiq-muted)]">
                        <th className="px-2.5 py-1.5">Sheet</th>
                        <th className="px-2.5 py-1.5">Row</th>
                        <th className="px-2.5 py-1.5">Column</th>
                        <th className="px-2.5 py-1.5">Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.slice(0, MAX_ERRORS_SHOWN).map((err, idx) => (
                        <tr key={`${err.sheet}-${err.row}-${err.column}-${idx}`} className="border-t border-[var(--ordiq-border)]/60">
                          <td className="px-2.5 py-1.5 font-medium">{err.sheet}</td>
                          <td className="px-2.5 py-1.5 font-mono">{err.row}</td>
                          <td className="px-2.5 py-1.5 font-mono">{err.column}</td>
                          <td className="px-2.5 py-1.5">{err.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.errors.length > MAX_ERRORS_SHOWN && (
                    <p className="border-t border-[var(--ordiq-border)] px-2.5 py-1.5 text-[var(--ordiq-muted)]">
                      Showing the first {MAX_ERRORS_SHOWN} of {preview.errors.length} problems.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)]/40 px-5 py-4 sm:px-6">
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          {canImport ? (
            <Button size="sm" className="text-xs font-semibold" onClick={() => void commit()} disabled={busy !== null}>
              {busy === "import" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy === "import" ? "Importing…" : `Import ${preview.rowCount} Rows`}
            </Button>
          ) : (
            <Button size="sm" className="text-xs font-semibold" onClick={() => void check()} disabled={!file || busy !== null}>
              {busy === "check" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy === "check" ? "Checking…" : "Check File"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { ImportSummary };
