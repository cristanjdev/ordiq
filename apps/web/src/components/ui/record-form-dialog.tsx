"use client";

import { Loader2, Pencil, Plus, X } from "lucide-react";
import * as React from "react";
import { Button } from "./button";

/**
 * One dialog for adding and editing any master-data record. Each page passes
 * its field list; the dialog renders the inputs, converts values to the API
 * types, and shows server validation issues next to the matching field.
 */

export interface FieldOption {
  value: string;
  label: string;
}

interface BaseField {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** Full row width in the two-column layout. */
  wide?: boolean;
  /** Identifying fields (codes) cannot change once the record exists. */
  lockedOnEdit?: boolean;
}

export type FormField =
  | (BaseField & { kind: "text"; maxLength?: number; nullable?: boolean })
  | (BaseField & { kind: "textarea"; maxLength?: number })
  | (BaseField & { kind: "number"; min?: number; max?: number; step?: number })
  | (BaseField & { kind: "select"; options: FieldOption[]; nullable?: boolean; nullLabel?: string })
  | (BaseField & { kind: "checkbox" })
  /** Minutes after midnight, edited as HH:MM. */
  | (BaseField & { kind: "time" })
  /** A list of strings, edited as comma-separated text. */
  | (BaseField & { kind: "tags" })
  | (BaseField & { kind: "multiselect"; options: FieldOption[] });

export type FormValues = Record<string, unknown>;
type DraftValues = Record<string, string | boolean | string[]>;

interface IssueLike {
  path?: Array<string | number>;
  message?: string;
}

export interface RecordFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  /** Record name, e.g. "Room" → "Add Room" / "Edit Room". */
  entityLabel: string;
  description?: React.ReactNode;
  fields: FormField[];
  /** Existing record (edit) or defaults (create). */
  initialValues?: FormValues;
  onClose: () => void;
  /** Throw to keep the dialog open; errors with `issues` are shown per field. */
  onSubmit: (values: FormValues) => Promise<void>;
}

const inputClass =
  "w-full rounded-md border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] px-2.5 py-1.5 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--ordiq-maroon)] disabled:cursor-not-allowed disabled:bg-[var(--ordiq-surface-muted)] disabled:text-[var(--ordiq-muted)]";

function minutesToTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function toDraft(fields: FormField[], values: FormValues | undefined): DraftValues {
  const draft: DraftValues = {};
  for (const field of fields) {
    const value = values?.[field.name];
    switch (field.kind) {
      case "checkbox":
        draft[field.name] = Boolean(value);
        break;
      case "time":
        draft[field.name] = minutesToTime(value);
        break;
      case "tags":
        draft[field.name] = Array.isArray(value) ? value.join(", ") : "";
        break;
      case "multiselect":
        draft[field.name] = Array.isArray(value) ? value.map(String) : [];
        break;
      default:
        draft[field.name] = value === null || value === undefined ? "" : String(value);
    }
  }
  return draft;
}

/** Convert the draft to API values; returns field errors found on the client. */
function fromDraft(
  fields: FormField[],
  draft: DraftValues,
): { values: FormValues; errors: Record<string, string> } {
  const values: FormValues = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = draft[field.name];
    switch (field.kind) {
      case "checkbox":
        values[field.name] = Boolean(raw);
        break;
      case "multiselect": {
        const list = Array.isArray(raw) ? raw : [];
        if (field.required && list.length === 0) errors[field.name] = "Choose at least one.";
        values[field.name] = list;
        break;
      }
      case "tags":
        values[field.name] = String(raw ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "time": {
        const text = String(raw ?? "");
        if (!text) {
          if (field.required) errors[field.name] = "Required.";
          values[field.name] = null;
          break;
        }
        const minutes = timeToMinutes(text);
        if (minutes === null) errors[field.name] = "Use HH:MM.";
        values[field.name] = minutes;
        break;
      }
      case "number": {
        const text = String(raw ?? "").trim();
        if (!text) {
          if (field.required) errors[field.name] = "Required.";
          values[field.name] = undefined;
          break;
        }
        const n = Number(text);
        if (!Number.isFinite(n)) errors[field.name] = "Enter a number.";
        else if (field.min !== undefined && n < field.min) errors[field.name] = `At least ${field.min}.`;
        else if (field.max !== undefined && n > field.max) errors[field.name] = `At most ${field.max}.`;
        values[field.name] = n;
        break;
      }
      case "select": {
        const text = String(raw ?? "");
        if (!text) {
          if (field.required) errors[field.name] = "Required.";
          values[field.name] = field.nullable ? null : undefined;
          break;
        }
        values[field.name] = text;
        break;
      }
      case "text": {
        const text = String(raw ?? "").trim();
        if (!text && field.required) errors[field.name] = "Required.";
        values[field.name] = !text && field.nullable ? null : text;
        break;
      }
      case "textarea": {
        const text = String(raw ?? "").trim();
        if (!text && field.required) errors[field.name] = "Required.";
        values[field.name] = text;
        break;
      }
    }
  }
  return { values, errors };
}

export function RecordFormDialog({
  open,
  mode,
  entityLabel,
  description,
  fields,
  initialValues,
  onClose,
  onSubmit,
}: RecordFormDialogProps) {
  const [draft, setDraft] = React.useState<DraftValues>(() => toDraft(fields, initialValues));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  // Reset whenever the dialog opens for a (possibly different) record.
  React.useEffect(() => {
    if (!open) return;
    setDraft(toDraft(fields, initialValues));
    setFieldErrors({});
    setFormError(null);
    setSaving(false);
    // Callers recreate `fields` on every render; the record being edited decides.
  }, [open, initialValues]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, saving, onClose]);

  if (!open) return null;

  const set = (name: string, value: string | boolean | string[]) => {
    setDraft((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) =>
      prev[name] ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== name)) : prev,
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const { values, errors } = fromDraft(fields, draft);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Check the highlighted fields.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const issues = (error as { issues?: IssueLike[] }).issues ?? [];
      const known = new Set(fields.map((f) => f.name));
      const mapped: Record<string, string> = {};
      const other: string[] = [];
      for (const issue of issues) {
        const key = String(issue.path?.[0] ?? "");
        if (known.has(key) && !mapped[key]) mapped[key] = issue.message ?? "Invalid value.";
        else if (issue.message) other.push(issue.message);
      }
      setFieldErrors(mapped);
      setFormError(
        other[0] ??
          (Object.keys(mapped).length > 0
            ? "Check the highlighted fields."
            : error instanceof Error
              ? error.message
              : "The record could not be saved."),
      );
      setSaving(false);
    }
  };

  const title = `${mode === "create" ? "Add" : "Edit"} ${entityLabel}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs"
        onClick={() => {
          if (!saving) onClose();
        }}
        aria-hidden="true"
      />
      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-xs text-[var(--ordiq-ink)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 bg-[#7a121b] dark:bg-[#2b080e] px-5 py-3.5 text-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {mode === "create" ? (
                <Plus className="h-4 w-4 shrink-0 text-white" />
              ) : (
                <Pencil className="h-4 w-4 shrink-0 text-white" />
              )}
              <h3 id="record-form-title" className="truncate text-sm font-bold text-white tracking-wide">
                {title}
              </h3>
            </div>
            {description && (
              <p className="mt-1 text-[11px] leading-relaxed text-rose-100/85 dark:text-zinc-300">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-white/70 hover:bg-white/15 hover:text-white transition disabled:opacity-50 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
          {fields.map((field) => {
            const id = `record-field-${field.name}`;
            const error = fieldErrors[field.name];
            const disabled = saving || (mode === "edit" && field.lockedOnEdit === true);
            const value = draft[field.name];
            const wide =
              field.wide || field.kind === "textarea" || field.kind === "multiselect";
            const describedBy = error ? `${id}-error` : field.help ? `${id}-help` : undefined;
            const errorRing = error ? " border-red-500 focus:ring-red-500" : "";

            let control: React.ReactNode;
            switch (field.kind) {
              case "checkbox":
                control = (
                  <label htmlFor={id} className="flex items-center gap-2 py-1.5">
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(value)}
                      disabled={disabled}
                      onChange={(e) => set(field.name, e.target.checked)}
                      className="h-3.5 w-3.5 accent-[var(--ordiq-maroon)]"
                    />
                    <span>{field.label}</span>
                  </label>
                );
                break;
              case "multiselect": {
                const selected = Array.isArray(value) ? value : [];
                control = (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-label`}>
                    {field.options.map((option) => {
                      const on = selected.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={disabled}
                          aria-pressed={on}
                          onClick={() =>
                            set(
                              field.name,
                              on
                                ? selected.filter((v) => v !== option.value)
                                : [...selected, option.value],
                            )
                          }
                          className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                            on
                              ? "border-[var(--ordiq-maroon)] bg-[var(--ordiq-maroon)] text-white"
                              : "border-[var(--ordiq-border)] text-[var(--ordiq-muted)] hover:border-[var(--ordiq-maroon)]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                );
                break;
              }
              case "select":
                control = (
                  <select
                    id={id}
                    value={String(value ?? "")}
                    disabled={disabled}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    onChange={(e) => set(field.name, e.target.value)}
                    className={inputClass + errorRing}
                  >
                    {(field.nullable || !field.required || !value) && (
                      <option value="">
                        {field.nullable ? (field.nullLabel ?? "None") : "Select…"}
                      </option>
                    )}
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                );
                break;
              case "textarea":
                control = (
                  <textarea
                    id={id}
                    rows={3}
                    value={String(value ?? "")}
                    maxLength={field.maxLength}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    onChange={(e) => set(field.name, e.target.value)}
                    className={inputClass + errorRing}
                  />
                );
                break;
              default:
                control = (
                  <input
                    id={id}
                    type={field.kind === "number" ? "number" : field.kind === "time" ? "time" : "text"}
                    inputMode={field.kind === "number" ? "numeric" : undefined}
                    value={String(value ?? "")}
                    min={field.kind === "number" ? field.min : undefined}
                    max={field.kind === "number" ? field.max : undefined}
                    step={field.kind === "number" ? (field.step ?? 1) : field.kind === "time" ? 300 : undefined}
                    maxLength={field.kind === "text" ? field.maxLength : undefined}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    aria-invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    onChange={(e) => set(field.name, e.target.value)}
                    className={inputClass + errorRing}
                  />
                );
            }

            return (
              <div key={field.name} className={wide ? "sm:col-span-2" : undefined}>
                {field.kind !== "checkbox" && (
                  <label
                    id={`${id}-label`}
                    htmlFor={field.kind === "multiselect" ? undefined : id}
                    className="mb-1 block text-[11px] font-medium text-[var(--ordiq-muted)]"
                  >
                    {field.label}
                    {field.required && <span className="text-[var(--ordiq-maroon)]"> *</span>}
                  </label>
                )}
                {control}
                {error ? (
                  <p id={`${id}-error`} className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                    {error}
                  </p>
                ) : mode === "edit" && field.lockedOnEdit ? (
                  <p className="mt-1 text-[10px] text-[var(--ordiq-muted)]">
                    Identifies the record; it cannot be changed.
                  </p>
                ) : field.help ? (
                  <p id={`${id}-help`} className="mt-1 text-[10px] text-[var(--ordiq-muted)]">
                    {field.help}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col-reverse gap-2 px-5 pb-4 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="min-h-[1rem] text-[11px] text-red-600 dark:text-red-400">
            {formError}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={saving} className="text-xs">
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving} className="text-xs font-semibold">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {mode === "create" ? `Add ${entityLabel}` : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
