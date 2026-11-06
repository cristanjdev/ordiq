"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CircleAlert,
  CheckCircle2,
  Loader2,
  Lock,
  RotateCcw,
  Server,
  ShieldCheck,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/ui/table-skeleton";
import { fetchSystemHealth } from "@/features/shell/app-shell";
import {
  DEFAULT_SYSTEM_SETTINGS,
  SETTINGS_LIMITS,
  securitySettingsChanged,
  type SystemSettings,
} from "@/lib/system-settings";
import { cn } from "@/lib/utils";
import { SYSTEM_SETTINGS_QUERY_KEY, useSystemSettings } from "./settings-api";

// ---------------------------------------------------------------------------
// Small form controls
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-maroon)]/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]" : "bg-[var(--ordiq-border)]",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  unit,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
}) {
  // Text is kept separately so the field can be cleared while typing.
  const [text, setText] = React.useState(String(value));
  React.useEffect(() => setText(String(value)), [value]);
  const invalid = text.trim() === "" || Number(text) < min || Number(text) > max;
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(Number(e.target.value));
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => {
          const n = Math.min(max, Math.max(min, Math.round(Number(text) || min)));
          setText(String(n));
          onChange(n);
        }}
        aria-invalid={invalid}
        className={cn(
          "h-9 w-28 rounded-lg border bg-[var(--ordiq-surface)] px-3 text-sm text-[var(--ordiq-ink)] focus:outline-none focus:ring-2 disabled:opacity-50",
          invalid
            ? "border-red-500 focus:ring-red-500/20"
            : "border-[var(--ordiq-border)] focus:border-[var(--ordiq-maroon)] focus:ring-[var(--ordiq-maroon)]/15",
        )}
      />
      <span className="text-xs text-[var(--ordiq-muted)]">{unit}</span>
    </div>
  );
}

/**
 * Exclamation button that opens the setting's explanation: a floating bubble
 * under the title on larger screens, a card at the bottom on phones.
 * Closes on a second click, an outside click or Escape.
 */
function InfoTip({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${title}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors",
          open
            ? "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]"
            : "text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-maroon)] dark:hover:text-[var(--ordiq-orange)]",
        )}
      >
        <CircleAlert className="h-4 w-4" />
      </button>
      {open && (
        <>
          {/* Phones: dim the page behind the bottom card */}
          <span className="fixed inset-0 z-40 bg-black/30 sm:hidden" aria-hidden="true" />
          <span
            id={id}
            role="dialog"
            aria-label={title}
            className={cn(
              "z-50 block rounded-xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] p-4 text-left shadow-xl animate-info-pop",
              "fixed inset-x-3 bottom-3",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-full sm:mt-2 sm:w-80 sm:-translate-x-1/2",
            )}
          >
            {/* Bubble tail (larger screens) */}
            <span
              aria-hidden="true"
              className="absolute -top-1.5 left-1/2 hidden h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] sm:block"
            />
            <span className="flex items-start justify-between gap-3">
              <span className="text-sm font-semibold text-[var(--ordiq-ink)]">{title}</span>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--ordiq-muted)] hover:bg-[var(--ordiq-surface-muted)] hover:text-[var(--ordiq-ink)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
            <span className="mt-1.5 block text-xs font-normal leading-relaxed text-[var(--ordiq-muted)]">
              {children}
            </span>
          </span>
        </>
      )}
    </span>
  );
}

function SettingRow({
  title,
  description,
  htmlFor,
  children,
  muted,
}: {
  title: string;
  description: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-xl bg-[var(--ordiq-surface-muted)]/60 px-4 py-3 transition-colors hover:bg-[var(--ordiq-surface-muted)] sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        muted && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-[var(--ordiq-ink)]">
          {title}
        </label>
        <InfoTip title={title}>{description}</InfoTip>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-stretch gap-3 space-y-0 pb-4">
        {/* Plain icon, stretched to the height of the title + description
            beside it (square, so it grows when the description wraps). */}
        <Icon
          aria-hidden="true"
          strokeWidth={1.75}
          className="aspect-square h-auto max-h-12 min-h-8 w-auto shrink-0 self-stretch text-[var(--ordiq-maroon)] dark:text-[var(--ordiq-orange)]"
        />
        <div className="min-w-0 space-y-1 self-center">
          <CardTitle>{title}</CardTitle>
          <CardDescription className="text-xs">{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5 pt-0">{children}</CardContent>
    </Card>
  );
}

function rangeText(limits: { min: number; max: number }, unit: string): string {
  return `${limits.min.toLocaleString()}–${limits.max.toLocaleString()} ${unit}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SettingsView() {
  const queryClient = useQueryClient();
  const { settings: saved, isLoading, isError, error, refetch } = useSystemSettings();
  const healthQuery = useQuery({
    queryKey: ["system-health"],
    queryFn: fetchSystemHealth,
    staleTime: 30_000,
  });

  const [draft, setDraft] = React.useState<SystemSettings>(saved);
  const [password, setPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Load the saved values into the form (again after each save).
  React.useEffect(() => {
    if (!isLoading) setDraft(saved);
  }, [saved, isLoading]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  React.useEffect(() => {
    if (message?.kind !== "ok" || dirty) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message, dirty]);
  const needsPassword = securitySettingsChanged(saved, draft);
  const isDefault = JSON.stringify(draft) === JSON.stringify({
    ...DEFAULT_SYSTEM_SETTINGS,
    ai: { ...DEFAULT_SYSTEM_SETTINGS.ai, monthlyTokenBudget: draft.ai.monthlyTokenBudget },
  });

  const setSecurity = <K extends keyof SystemSettings["security"]>(key: K, value: SystemSettings["security"][K]) => {
    setMessage(null);
    setDraft((d) => ({ ...d, security: { ...d.security, [key]: value } }));
  };
  const setAi = <K extends keyof SystemSettings["ai"]>(key: K, value: SystemSettings["ai"][K]) => {
    setMessage(null);
    setDraft((d) => ({ ...d, ai: { ...d.ai, [key]: value } }));
  };

  const save = async () => {
    if (!dirty || saving) return;
    if (needsPassword && !password) {
      setMessage({ kind: "error", text: "Enter the current password to save sign-in and session changes." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft, currentPassword: needsPassword ? password : undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        settings?: SystemSettings;
        error?: { message?: string };
      };
      if (!res.ok || !body.settings) {
        throw new Error(body.error?.message ?? "The settings could not be saved.");
      }
      queryClient.setQueryData(SYSTEM_SETTINGS_QUERY_KEY, body.settings);
      setPassword("");
      setMessage({
        kind: "ok",
        text: "Settings saved. Sign-in changes apply to the next sign-in; session limits apply right away.",
      });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "The settings could not be saved." });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(saved);
    setPassword("");
    setMessage(null);
  };

  const restoreDefaults = () => {
    setMessage(null);
    // The token budget default comes from the server's .env, so it is kept.
    setDraft({
      security: { ...DEFAULT_SYSTEM_SETTINGS.security },
      ai: { ...DEFAULT_SYSTEM_SETTINGS.ai, monthlyTokenBudget: draft.ai.monthlyTokenBudget },
    });
  };

  const s = draft.security;
  const health = healthQuery.data;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ordiq-ink)]">Settings</h1>
          <p className="mt-0.5 text-xs text-[var(--ordiq-muted)]">
            Sign-in security, automatic sign-out and the AI Assistant. Every change is recorded in the audit log.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={restoreDefaults} disabled={isLoading || saving || isDefault}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore recommended values
        </Button>
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
          <span>{error instanceof Error ? error.message : "Settings could not load."}</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-5" role="status" aria-label="Loading settings">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-4 p-5">
                <SkeletonBlock className="h-4 w-48" />
                <SkeletonBlock className="h-3 w-2/3" />
                <SkeletonBlock className="h-10 w-full" />
                <SkeletonBlock className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <SectionCard
            icon={ShieldCheck}
            title="Sign-in security"
            description="How the Dean account signs in to ORDIQ."
          >
            <SettingRow
              title="Two-factor authentication (Google Authenticator)"
              description="After the password, ask for the 6-digit code from the authenticator app. Recommended for an account that can change official schedules."
            >
              <Toggle
                label="Two-factor authentication"
                checked={s.twoFactorRequired}
                onChange={(v) => setSecurity("twoFactorRequired", v)}
              />
            </SettingRow>
            {!s.twoFactorRequired && (
              <div className="flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  With two-factor authentication off, anyone who learns the password can sign in. The
                  authenticator setup is kept, so turning it back on needs no new QR scan. The project quotation
                  lists multi-factor sign-in as a delivered feature.
                </span>
              </div>
            )}
            <SettingRow
              title="Failed attempts before lock"
              htmlFor="max-attempts"
              description={`Wrong passwords or codes in a row before the account is locked (${rangeText(SETTINGS_LIMITS.maxFailedLoginAttempts, "attempts")}).`}
            >
              <NumberField
                id="max-attempts"
                value={s.maxFailedLoginAttempts}
                onChange={(v) => setSecurity("maxFailedLoginAttempts", v)}
                {...SETTINGS_LIMITS.maxFailedLoginAttempts}
                unit="attempts"
              />
            </SettingRow>
            <SettingRow
              title="Lock duration"
              htmlFor="lockout"
              description={`How long sign-in stays blocked after too many failed attempts (${rangeText(SETTINGS_LIMITS.lockoutMinutes, "minutes")}).`}
            >
              <NumberField
                id="lockout"
                value={s.lockoutMinutes}
                onChange={(v) => setSecurity("lockoutMinutes", v)}
                {...SETTINGS_LIMITS.lockoutMinutes}
                unit="minutes"
              />
            </SettingRow>
          </SectionCard>

          <SectionCard
            icon={Timer}
            title="Session & automatic sign-out"
            description="When ORDIQ signs the Dean out on its own."
          >
            <SettingRow
              title="Sign out after inactivity (auto-expire)"
              description="End the session when no one uses ORDIQ for a while, e.g. on a shared or unattended computer."
            >
              <Toggle
                label="Sign out after inactivity"
                checked={s.idleTimeoutEnabled}
                onChange={(v) => setSecurity("idleTimeoutEnabled", v)}
              />
            </SettingRow>
            <SettingRow
              title="Inactivity limit"
              htmlFor="idle-minutes"
              muted={!s.idleTimeoutEnabled}
              description={`Minutes without activity before signing out (${rangeText(SETTINGS_LIMITS.idleTimeoutMinutes, "minutes")}).`}
            >
              <NumberField
                id="idle-minutes"
                value={s.idleTimeoutMinutes}
                onChange={(v) => setSecurity("idleTimeoutMinutes", v)}
                {...SETTINGS_LIMITS.idleTimeoutMinutes}
                unit="minutes"
                disabled={!s.idleTimeoutEnabled}
              />
            </SettingRow>
            <SettingRow
              title="Maximum session length"
              htmlFor="absolute-hours"
              description={`The Dean signs in again after this long, even while active (${rangeText(SETTINGS_LIMITS.absoluteSessionHours, "hours")}).`}
            >
              <NumberField
                id="absolute-hours"
                value={s.absoluteSessionHours}
                onChange={(v) => setSecurity("absoluteSessionHours", v)}
                {...SETTINGS_LIMITS.absoluteSessionHours}
                unit="hours"
              />
            </SettingRow>
          </SectionCard>

          <SectionCard
            icon={Bot}
            title="AI Assistant"
            description="The chat assistant in the side panel and on the AI Assistant page."
          >
            <SettingRow
              title="AI Assistant"
              description="When off, the assistant's menu item, button and panel are hidden and chat requests are refused."
            >
              <Toggle
                label="AI Assistant"
                checked={draft.ai.assistantEnabled}
                onChange={(v) => setAi("assistantEnabled", v)}
              />
            </SettingRow>
            <SettingRow
              title="Monthly token budget"
              htmlFor="token-budget"
              muted={!draft.ai.assistantEnabled}
              description={`AI provider tokens allowed per calendar month; once used up, the built-in assistant answers instead (${rangeText(SETTINGS_LIMITS.monthlyTokenBudget, "tokens")}).`}
            >
              <NumberField
                id="token-budget"
                value={draft.ai.monthlyTokenBudget}
                onChange={(v) => setAi("monthlyTokenBudget", v)}
                {...SETTINGS_LIMITS.monthlyTokenBudget}
                unit="tokens"
                disabled={!draft.ai.assistantEnabled}
              />
            </SettingRow>
          </SectionCard>

          <SectionCard
            icon={Server}
            title="Server configuration"
            description="Read-only. These values are set in the server's .env file by the system administrator."
          >
            {healthQuery.isLoading ? (
              <SkeletonBlock className="h-16 w-full" />
            ) : !health ? (
              <p className="text-xs text-[var(--ordiq-muted)]">The server status could not load.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["AI provider", health.web.llmProvider === "gemini" ? "Google Gemini" : health.web.llmProvider],
                  ["Scheduling engine", health.engine.connected ? `Connected (v${health.engine.version ?? "?"})` : "Not connected"],
                  [
                    "Solver time limit",
                    health.engine.solverTimeLimitSeconds ? `${health.engine.solverTimeLimitSeconds} seconds` : "—",
                  ],
                  ["Solver workers", health.engine.solverWorkers ? String(health.engine.solverWorkers) : "—"],
                  ["App version", health.web.version],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-[var(--ordiq-surface-muted)]/60 px-4 py-3">
                    <dt className="text-[11px] text-[var(--ordiq-muted)]">{k}</dt>
                    <dd className="mt-0.5 text-sm font-semibold text-[var(--ordiq-ink)]">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </SectionCard>
        </>
      )}

      {/* Save bar: floats at the bottom while there are unsaved changes,
          then briefly confirms the save. Kept clear of the AI button on
          narrower screens. */}
      {(dirty || message) && !isLoading && (
        <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center max-xl:pr-14 sm:bottom-4">
          <div
            role="region"
            aria-label="Unsaved settings"
            className="pointer-events-auto w-full max-w-4xl rounded-2xl border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)]/95 shadow-xl shadow-black/10 backdrop-blur-md animate-info-pop"
          >
            <div className="flex flex-col gap-3 p-3 sm:pl-4 xl:flex-row xl:items-center xl:gap-4">
              {/* Status */}
              <div className="flex min-w-0 items-center gap-2.5 xl:flex-1 xl:shrink-0">
                {message && (message.kind === "ok" || !dirty) ? (
                  <p
                    role={message.kind === "error" ? "alert" : "status"}
                    className={cn(
                      "flex items-center gap-2 text-xs font-medium",
                      message.kind === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
                    )}
                  >
                    {message.kind === "ok" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                    )}
                    {message.text}
                  </p>
                ) : (
                  <div className="min-w-0">
                    {/* Dot and title on one row; the description starts at the left edge below */}
                    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ordiq-ink)]">
                      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60 motion-reduce:animate-none" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                      </span>
                      Unsaved changes
                    </p>
                    <p
                      role={message?.kind === "error" ? "alert" : undefined}
                      className={cn(
                        "mt-0.5 text-[11px] leading-snug sm:whitespace-nowrap",
                        message?.kind === "error" ? "text-red-700 dark:text-red-300" : "text-[var(--ordiq-muted)]",
                      )}
                    >
                      {message?.kind === "error"
                        ? message.text
                        : needsPassword
                          ? "Sign-in and session changes need the current password."
                          : "Changes take effect once saved."}
                    </p>
                  </div>
                )}
              </div>

              {/* Password + actions */}
              {dirty && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:shrink-0">
                  {needsPassword && (
                    <div className="relative sm:flex-1 xl:w-52 xl:flex-none">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ordiq-muted)]" />
                      <input
                        type="password"
                        autoComplete="current-password"
                        placeholder="Current password"
                        aria-label="Current password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save();
                        }}
                        className="h-9 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] pl-8 pr-3 text-xs text-[var(--ordiq-ink)] placeholder:text-[var(--ordiq-muted)] focus:border-[var(--ordiq-maroon)] focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-maroon)]/15"
                      />
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 flex-1 rounded-lg px-4 text-[var(--ordiq-muted)] hover:border-[var(--ordiq-ink)]/30 hover:text-[var(--ordiq-ink)] sm:flex-none"
                      onClick={discard}
                      disabled={saving}
                    >
                      Discard
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 flex-1 rounded-lg px-4 sm:flex-none"
                      onClick={() => void save()}
                      disabled={saving || (needsPassword && !password)}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Saving…
                        </>
                      ) : (
                        "Save changes"
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
