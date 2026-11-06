"use client";

import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  sheetsHint,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  termCode: string;
  title: string;
  /** Sheets most relevant to the page, e.g. ["Faculty", "FacultyAvailability"]. */
  sheetsHint: string[];
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
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 bg-[#7a121b] dark:bg-[#2b080e] p-4 text-white">
          <div className="flex items-start gap-2.5">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-white mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">{title}</h2>
              <p className="mt-0.5 text-[11px] text-rose-100/85 dark:text-zinc-300">
                Term {termCode}. Relevant sheets: {sheetsHint.join(", ")}. Rows are added or updated by code; nothing is deleted.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white transition disabled:opacity-50 cursor-pointer"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" size="sm" className="text-xs" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
              <Upload className="h-3.5 w-3.5" />
              {file ? "Choose Another File" : "Choose .xlsx File"}
            </Button>
            <a
              href={`/api/v1/imports?template=1&termCode=${encodeURIComponent(termCode)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[var(--ordiq-maroon)] hover:underline dark:text-[var(--ordiq-orange)]"
            >
              <Download className="h-3.5 w-3.5" />
              Blank template
            </a>
            {file && (
              <span className="truncate text-[11px] text-[var(--ordiq-muted)]">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              {preview.errors.length > 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {preview.errors.length} problem{preview.errors.length === 1 ? "" : "s"} found. Nothing was imported; fix the rows below and check again.
                </div>
              ) : preview.rowCount === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  The workbook has no data rows. Sheet names and column headers must match the template.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {preview.rowCount} rows passed the check and are ready to import.
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

        <div className="flex items-center justify-end gap-2 px-4 pb-4 pt-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          {canImport ? (
            <Button size="sm" className="text-xs font-semibold" onClick={() => void commit()} disabled={busy !== null}>
              {busy === "import" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import {preview.rowCount} Rows
            </Button>
          ) : (
            <Button size="sm" className="text-xs font-semibold" onClick={() => void check()} disabled={!file || busy !== null}>
              {busy === "check" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Check File
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export type { ImportSummary };
