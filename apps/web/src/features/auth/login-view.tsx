"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LifeBuoy,
  Loader2,
  Lock,
  Maximize2,
  QrCode,
  ShieldCheck,
  Smartphone,
  User,
  X,
} from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";
import { TotpCodeInput } from "@/components/ui/totp-code-input";
import type { LoginNoticeReason } from "@/lib/auth-constants";
import { cn } from "@/lib/utils";

interface EnrollmentPayload {
  secretBase32: string;
  otpauthUri: string;
  qrCodeDataUrl: string;
  accountLabel: string;
  issuer: string;
  digits: number;
  periodSeconds: number;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: { lockedUntil?: string; attemptsRemaining?: number };
  };
}

type Step = "PASSWORD" | "TOTP" | "RECOVERY_CODES" | "RECOVERY_USED";
type CodeMode = "totp" | "recovery";

const NOTICE_MESSAGES: Record<LoginNoticeReason, string> = {
  expired: "Your session has expired. Please sign in again.",
  signed_out: "You have been signed out.",
  required: "Please sign in to continue.",
};

const RESTART_CODES = new Set([
  "SESSION_EXPIRED",
  "ACCOUNT_LOCKED",
  "TOTP_NOT_INITIALIZED",
  "UNAUTHORIZED",
  "ALREADY_AUTHENTICATED",
]);

const TOTP_LENGTH = 6;
const LOW_ATTEMPTS_WARNING = 3;

function lockedMessage(lockedUntil?: string): string {
  if (!lockedUntil) {
    return "Account locked after failed attempts. Please contact systems administration.";
  }
  const time = new Date(lockedUntil).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Account temporarily locked. Retry permitted at ${time}.`;
}

function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LoginView({
  nextPath = "/",
  notice = null,
}: {
  /** Validated in-app destination to open after a successful sign-in. */
  nextPath?: string;
  notice?: LoginNoticeReason | null;
}) {
  const [step, setStep] = React.useState<Step>("PASSWORD");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [codeMode, setCodeMode] = React.useState<CodeMode>("totp");
  const [code, setCode] = React.useState("");
  const [enrollment, setEnrollment] = React.useState<EnrollmentPayload | null>(null);
  const [showManualKey, setShowManualKey] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [recoveryRemaining, setRecoveryRemaining] = React.useState<number | null>(null);
  const [codesSaved, setCodesSaved] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [copied, setCopied] = React.useState<"secret" | "codes" | null>(null);
  const [copyFailed, setCopyFailed] = React.useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = React.useState(false);
  const [modalTab, setModalTab] = React.useState<"qr" | "key">("qr");
  const [isFirstEnrollment, setIsFirstEnrollment] = React.useState(false);
  const [loadingEnrollment, setLoadingEnrollment] = React.useState(false);

  const codeInputRef = React.useRef<HTMLInputElement>(null);
  const submittingRef = React.useRef(false);
  // Set once sign-in succeeded and the browser is loading the app. The form
  // stays locked from then on, so the button cannot be pressed a second time.
  const [redirecting, setRedirecting] = React.useState(false);
  const redirectingRef = React.useRef(false);

  // Coming back with the browser's Back button restores this page from cache
  // with the lock still on; unlock it so the Dean can sign in again.
  React.useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      redirectingRef.current = false;
      submittingRef.current = false;
      setRedirecting(false);
      setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const enrolling = isFirstEnrollment;

  // Close QR modal on ESC key
  React.useEffect(() => {
    if (!isQrModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsQrModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isQrModalOpen]);

  const enterApp = () => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    setRedirecting(true);
    setSubmitting(true);
    window.location.assign(nextPath);
  };

  const restartSignIn = (message: string) => {
    setStep("PASSWORD");
    setPassword("");
    setCode("");
    setCodeMode("totp");
    setEnrollment(null);
    setIsFirstEnrollment(false);
    setShowManualKey(false);
    setIsQrModalOpen(false);
    setModalTab("qr");
    setErrorMessage(message);
  };

  const openQrModal = async () => {
    setModalTab("qr");
    setIsQrModalOpen(true);
    if (!enrollment) {
      setLoadingEnrollment(true);
      try {
        const res = await fetch("/api/v1/auth/totp");
        if (res.ok) {
          const d = (await res.json()) as { totpEnrollment?: EnrollmentPayload | null };
          if (d.totpEnrollment) {
            setEnrollment(d.totpEnrollment);
          }
        }
      } catch {
        // Ignored
      } finally {
        setLoadingEnrollment(false);
      }
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = (await res.json()) as ApiErrorBody & {
        stage?: "ENROLL_TOTP" | "VERIFY_TOTP" | "ACTIVE";
        totpEnrollment?: EnrollmentPayload | null;
      };
      if (!res.ok) {
        setErrorMessage(
          data.error?.code === "ACCOUNT_LOCKED"
            ? lockedMessage(data.error.details?.lockedUntil)
            : (data.error?.message ?? "Invalid username or password."),
        );
        return;
      }
      setPassword("");
      if (data.stage === "ACTIVE") {
        // Two-factor sign-in is turned off in Settings: the password is enough.
        enterApp();
        return;
      }
      setIsFirstEnrollment(data.stage === "ENROLL_TOTP");
      setEnrollment(data.totpEnrollment ?? null);
      setCode("");
      setCodeMode("totp");
      setStep("TOTP");
    } catch {
      setErrorMessage(
        "Could not reach authentication service. Please check your network.",
      );
    } finally {
      if (!redirectingRef.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const submitCode = async (value: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = (await res.json()) as ApiErrorBody & {
        stage?: "ACTIVE";
        recoveryCodes?: string[] | null;
        recoveryCodesRemaining?: number | null;
      };
      if (!res.ok) {
        const errCode = data.error?.code ?? "";
        if (RESTART_CODES.has(errCode)) {
          restartSignIn(
            errCode === "ACCOUNT_LOCKED"
              ? lockedMessage(data.error?.details?.lockedUntil)
              : (data.error?.message ?? "Session expired. Please sign in again."),
          );
          return;
        }
        const remaining = data.error?.details?.attemptsRemaining;
        const base = data.error?.message ?? "Invalid code. Please try again.";
        setErrorMessage(
          typeof remaining === "number" && remaining <= LOW_ATTEMPTS_WARNING
            ? `${base} ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
            : base,
        );
        setCode("");
        requestAnimationFrame(() => codeInputRef.current?.focus());
        return;
      }
      if (data.recoveryCodes && data.recoveryCodes.length > 0) {
        setRecoveryCodes(data.recoveryCodes);
        setCodesSaved(false);
        setStep("RECOVERY_CODES");
      } else if (typeof data.recoveryCodesRemaining === "number") {
        setRecoveryRemaining(data.recoveryCodesRemaining);
        setStep("RECOVERY_USED");
      } else {
        enterApp();
      }
    } catch {
      setErrorMessage(
        "Could not reach authentication service. Please check your network.",
      );
    } finally {
      if (!redirectingRef.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  const handleCodeChange = (raw: string) => {
    if (codeMode === "totp") {
      const digits = raw.replace(/\D/g, "").slice(0, TOTP_LENGTH);
      setCode(digits);
      if (digits.length === TOTP_LENGTH) void submitCode(digits);
    } else {
      setCode(raw.toUpperCase().replace(/[^A-Z0-9-\s]/g, "").slice(0, 16));
    }
  };

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitCode(code);
  };

  const switchCodeMode = (mode: CodeMode) => {
    setCodeMode(mode);
    setCode("");
    setErrorMessage(null);
    requestAnimationFrame(() => codeInputRef.current?.focus());
  };

  const handleCopy = async (kind: "secret" | "codes") => {
    const text = kind === "secret" ? (enrollment?.secretBase32 ?? "") : recoveryCodes.join("\n");
    if (!text) return;
    const ok = await copyText(text);
    setCopyFailed(!ok);
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2500);
    }
  };

  const downloadRecoveryCodes = () => {
    if (recoveryCodes.length === 0) return;
    const content = [
      "ORDIQ Recovery Codes",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      ...recoveryCodes,
      "",
      "Keep these single-use recovery codes safe to regain account access.",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ordiq-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const activeNotice = notice ? NOTICE_MESSAGES[notice] : null;

  return (
    <div className="relative flex h-full h-[100dvh] w-full items-center justify-center p-4 overflow-hidden select-none bg-gradient-to-br from-[#4a0a0f] via-[#2d0508] to-[#170204] no-scrollbar">
      {/* Background radial glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(234,88,12,0.08),transparent_70%)]" />

      {/* Main Form Container */}
      <div className="relative z-10 w-full max-w-[400px] sm:max-w-[420px]">
        {/* Ambient aura behind card */}
        <div className="pointer-events-none absolute -inset-1 rounded-3xl bg-gradient-to-r from-amber-500/10 via-rose-500/15 to-orange-500/10 blur-xl opacity-70" />

        <div className="relative overflow-hidden rounded-2xl border border-white/20 dark:border-white/10 bg-white/98 dark:bg-[#18090c]/98 p-5 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl">
          {/* Top Hairline Highlight */}
          <div className="absolute inset-x-0 top-0 h-[2.5px] bg-gradient-to-r from-transparent via-[#7a121b]/60 to-transparent" />

          {/* Top Back Action (positioned above at top-left) */}
          {step !== "PASSWORD" && (
            <button
              type="button"
              onClick={() => restartSignIn("")}
              className="absolute left-4 top-4 sm:left-5 sm:top-5 z-20 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer group"
              aria-label="Back to sign in"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to sign in</span>
            </button>
          )}

          {/* Form Header */}
          <div className="mb-6 text-center">
            {/* System Logo: ORDIQ (plain, no bg container) */}
            <div className="mx-auto mb-3 flex items-center justify-center">
              <OrdiqLogo size={48} variant="maroon" alt="ORDIQ" className="dark:hidden drop-shadow-xs" />
              <OrdiqLogo size={48} variant="white" alt="ORDIQ" className="hidden dark:block drop-shadow-xs" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {step === "PASSWORD"
                ? "Sign in to ORDIQ"
                : step === "TOTP"
                  ? "Two-Factor Authentication"
                  : step === "RECOVERY_CODES"
                    ? "Recovery Codes"
                    : "Access Granted"}
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              {step === "PASSWORD"
                ? "Dean Academic Scheduling Portal"
                : step === "TOTP"
                  ? enrolling
                    ? "Set up your authenticator app"
                    : "Enter the code from your authenticator"
                  : step === "RECOVERY_CODES"
                    ? "Preserve these single-use codes safely"
                    : "Signed in via recovery credential"}
            </p>
          </div>

          {/* Notice Banner */}
          {activeNotice && !errorMessage && step === "PASSWORD" && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 px-3 py-2 text-xs text-slate-600 dark:text-zinc-300 shadow-2xs"
            >
              <Info className="h-4 w-4 shrink-0 text-slate-500 dark:text-zinc-400" />
              <span>{activeNotice}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 font-medium shadow-2xs"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ===================================================================
              STEP 1: Credentials (Username & Password)
              =================================================================== */}
          {step === "PASSWORD" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="identifier"
                  className="block text-xs font-semibold text-slate-700 dark:text-zinc-200 mb-1.5"
                >
                  Username or email
                </label>
                <div className="relative flex items-center group">
                  <User className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400 dark:text-zinc-500 transition-colors group-focus-within:text-[#7a121b] dark:group-focus-within:text-amber-400" />
                  <input
                    id="identifier"
                    type="text"
                    required
                    autoFocus
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="dean@mseuf.edu.ph"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="h-10.5 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 pl-10 pr-3.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 shadow-2xs transition-all duration-150 focus:bg-white dark:focus:bg-zinc-900 focus:border-[#7a121b] dark:focus:border-amber-500 focus:ring-3 focus:ring-[#7a121b]/15 dark:focus:ring-amber-500/20 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-slate-700 dark:text-zinc-200 mb-1.5"
                >
                  Password
                </label>
                <div className="relative flex items-center group">
                  <Lock className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400 dark:text-zinc-500 transition-colors group-focus-within:text-[#7a121b] dark:group-focus-within:text-amber-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10.5 w-full rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 pl-10 pr-10 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 shadow-2xs transition-all duration-150 focus:bg-white dark:focus:bg-zinc-900 focus:border-[#7a121b] dark:focus:border-amber-500 focus:ring-3 focus:ring-[#7a121b]/15 dark:focus:ring-amber-500/20 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2.5 flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="group relative h-11 w-full overflow-hidden rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] active:from-[#600b14] active:to-[#540810] text-white text-sm font-semibold tracking-wide shadow-md hover:shadow-lg transition-all duration-150 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/25"
                >
                  {submitting ? (
                    "Signing in..."
                  ) : (
                    <>
                      <span>Sign in</span>
                      <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </div>

              <div className="pt-1 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 dark:text-zinc-500 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Authorized Administrative Access Only</span>
              </div>
            </form>
          )}

          {/* ===================================================================
              STEP 2: Two-Factor Authentication
              =================================================================== */}
          {step === "TOTP" && (
            <form onSubmit={handleCodeSubmit} className="space-y-4">

              {isFirstEnrollment && enrollment ? (
                /* Initial MFA Setup */
                <div className="space-y-3.5">
                  <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 p-3 text-xs shadow-2xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-slate-700 dark:text-zinc-300">
                        {showManualKey ? "Manual key" : "Scan QR code"}
                      </span>
                      <div className="inline-flex rounded-lg bg-slate-200/70 dark:bg-zinc-800 p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setShowManualKey(false)}
                          className={cn(
                            "px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                            !showManualKey
                              ? "bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-2xs"
                              : "text-slate-600 dark:text-zinc-400 hover:text-slate-900",
                          )}
                        >
                          QR
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowManualKey(true)}
                          className={cn(
                            "px-2.5 py-0.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer",
                            showManualKey
                              ? "bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-2xs"
                              : "text-slate-600 dark:text-zinc-400 hover:text-slate-900",
                          )}
                        >
                          Key
                        </button>
                      </div>
                    </div>

                    {/* Content Area with consistent height across both tabs */}
                    <div className="h-[112px] flex flex-col items-center justify-center w-full">
                      {!showManualKey ? (
                        <button
                          type="button"
                          onClick={() => {
                            setModalTab("qr");
                            setIsQrModalOpen(true);
                          }}
                          className="group relative rounded-xl border border-slate-200 dark:border-zinc-700 bg-white p-1.5 shadow-xs transition-transform hover:scale-105 cursor-pointer"
                          title="Click to enlarge"
                        >
                          <img
                            src={enrollment.qrCodeDataUrl}
                            alt="QR Code"
                            width={96}
                            height={96}
                            className="block h-24 w-24"
                          />
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Maximize2 className="h-4 w-4 text-white" />
                          </div>
                        </button>
                      ) : (
                        <div className="w-full space-y-2">
                          <div className="flex w-full items-center gap-1.5 sm:gap-2">
                            <code
                              aria-label="Setup key"
                              title="Click to copy key"
                              onClick={() => void handleCopy("secret")}
                              className="flex-1 min-w-0 select-all rounded-lg bg-white dark:bg-zinc-900 px-1.5 py-1.5 sm:px-2 text-center font-mono text-[8.5px] min-[360px]:text-[9px] min-[400px]:text-[9.5px] sm:text-[10px] font-semibold text-slate-800 dark:text-zinc-200 border border-slate-200 dark:border-zinc-700 whitespace-nowrap tracking-tight hover:border-slate-300 dark:hover:border-zinc-600 transition-colors cursor-pointer"
                            >
                              {groupKey(enrollment.secretBase32)}
                            </code>
                            <button
                              type="button"
                              onClick={() => void handleCopy("secret")}
                              className="h-7 sm:h-7.5 shrink-0 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 sm:px-2.5 text-[11px] font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                            >
                              {copied === "secret" ? "Copied" : "Copy"}
                            </button>
                          </div>
                          <p className="text-[10px] sm:text-[10.5px] text-center text-slate-500 dark:text-zinc-400">
                            Enter this key into your authenticator app
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="authCode"
                      className="block text-xs font-semibold text-slate-700 dark:text-zinc-200 mb-1.5"
                    >
                      6-digit authenticator code
                    </label>
                    <TotpCodeInput
                      ref={codeInputRef}
                      id="authCode"
                      value={code}
                      onChange={handleCodeChange}
                      disabled={submitting}
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={submitting || code.length !== TOTP_LENGTH}
                    className="h-11 w-full rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] text-white text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-60"
                  >
                    {redirecting ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                      </span>
                    ) : submitting ? (
                      "Verifying..."
                    ) : (
                      "Verify & Continue"
                    )}
                  </Button>
                </div>
              ) : (
                /* Returning Verification */
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="authCode"
                        className="block text-xs font-semibold text-slate-700 dark:text-zinc-200"
                      >
                        {codeMode === "totp" ? "6-digit authenticator code" : "Single-use recovery code"}
                      </label>
                      {codeMode === "totp" && (
                        <button
                          type="button"
                          onClick={() => void openQrModal()}
                          className="inline-flex items-center justify-center rounded-md p-1 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
                          title="Show QR code or setup key"
                          aria-label="Show QR code or setup key"
                        >
                          <QrCode className="h-4 w-4 text-slate-600 dark:text-zinc-300 hover:text-[#7a121b] dark:hover:text-[#f87171] transition-colors" />
                        </button>
                      )}
                    </div>

                    {codeMode === "totp" ? (
                      <TotpCodeInput
                        ref={codeInputRef}
                        id="authCode"
                        value={code}
                        onChange={handleCodeChange}
                        disabled={submitting}
                        autoFocus={!enrolling}
                      />
                    ) : (
                      <div className="relative flex items-center">
                        <KeyRound className="pointer-events-none absolute left-3.5 h-4 w-4 text-slate-400" />
                        <input
                          ref={codeInputRef}
                          id="authCode"
                          key="recovery"
                          type="text"
                          required
                          autoFocus={!enrolling}
                          disabled={submitting}
                          autoComplete="off"
                          autoCapitalize="characters"
                          maxLength={16}
                          placeholder="ORDQ-XXXX-XXXX"
                          spellCheck={false}
                          value={code}
                          onChange={(e) => handleCodeChange(e.target.value)}
                          className="h-10.5 w-full pl-10 pr-3.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 text-center font-mono text-sm font-bold tracking-wider text-slate-900 dark:text-white placeholder:font-normal placeholder:tracking-normal focus:border-[#7a121b] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#7a121b]/15 transition-all shadow-2xs"
                        />
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={
                      submitting || (codeMode === "totp" ? code.length !== TOTP_LENGTH : code.trim().length < 8)
                    }
                    className="h-11 w-full rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] text-white text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-60"
                  >
                    {redirecting ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                      </span>
                    ) : submitting ? (
                      "Verifying..."
                    ) : (
                      "Verify"
                    )}
                  </Button>

                  <div className="text-center pt-1">
                    {codeMode === "totp" ? (
                      <button
                        type="button"
                        onClick={() => switchCodeMode("recovery")}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors cursor-pointer font-medium"
                      >
                        <LifeBuoy className="h-3.5 w-3.5" />
                        <span>Use a recovery code</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => switchCodeMode("totp")}
                        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 transition-colors cursor-pointer font-medium"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span>Use authenticator app</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </form>
          )}

          {/* ===================================================================
              STEP 3: Recovery Codes Preservation
              =================================================================== */}
          {step === "RECOVERY_CODES" && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-3.5 shadow-2xs">
                <p className="font-semibold text-slate-800 dark:text-zinc-200 mb-2">
                  Emergency recovery codes
                </p>
                <ul className="grid grid-cols-2 gap-1.5 font-mono text-xs font-bold">
                  {recoveryCodes.map((rc) => (
                    <li
                      key={rc}
                      className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-center text-slate-800 dark:text-zinc-200 shadow-2xs select-all"
                    >
                      {rc}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy("codes")}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 h-8 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                  >
                    {copied === "codes" ? "Copied" : "Copy codes"}
                  </button>
                  <button
                    type="button"
                    onClick={downloadRecoveryCodes}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 h-8 text-xs font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 transition-colors cursor-pointer shadow-2xs"
                  >
                    Download .txt
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={codesSaved}
                  onChange={(e) => setCodesSaved(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#7a121b]"
                />
                <span className="text-slate-600 dark:text-zinc-400 font-medium">
                  I have saved these recovery codes in a secure location.
                </span>
              </label>

              <Button
                type="button"
                disabled={!codesSaved || redirecting}
                className="h-11 w-full rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] text-white text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-60"
                onClick={enterApp}
              >
                {redirecting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Opening ORDIQ…
                  </span>
                ) : (
                  "Continue to ORDIQ"
                )}
              </Button>
            </div>
          )}

          {/* ===================================================================
              RECOVERY CODE CONSUMED WARNING
              =================================================================== */}
          {step === "RECOVERY_USED" && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-3.5 shadow-2xs">
                <p className="font-semibold text-slate-900 dark:text-white">
                  {recoveryRemaining === 0
                    ? "No recovery codes remaining"
                    : `${recoveryRemaining} recovery code${recoveryRemaining === 1 ? "" : "s"} remaining`}
                </p>
                <p className="mt-1 text-slate-600 dark:text-zinc-400 leading-relaxed">
                  The recovery code you used is now inactive. If you have lost your authenticator, reset two-factor authentication in settings.
                </p>
              </div>
              <Button
                type="button"
                disabled={redirecting}
                className="h-11 w-full rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] text-white text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-60"
                onClick={enterApp}
              >
                {redirecting ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Opening ORDIQ…
                  </span>
                ) : (
                  "Continue to ORDIQ"
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* QR Code & Setup Key Modal */}
      {isQrModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={() => setIsQrModalOpen(false)}
            aria-hidden="true"
          />

          <div className="relative z-10 w-full max-w-[480px] rounded-2xl border border-white/20 bg-white dark:bg-[#1a0b0e] p-5 shadow-2xl text-center">
            <button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 id="qr-modal-title" className="text-base font-semibold text-slate-900 dark:text-white">
              {modalTab === "qr" ? "Scan QR code" : "Manual setup key"}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-zinc-400">
              {enrollment?.accountLabel ?? "Authenticator setup"}
            </p>

            {/* Navigation Tabs */}
            <div className="mt-3 inline-flex rounded-lg bg-slate-100 dark:bg-zinc-800/80 p-0.5 text-xs border border-slate-200/80 dark:border-zinc-700/60">
              <button
                type="button"
                onClick={() => setModalTab("qr")}
                className={cn(
                  "px-3.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                  modalTab === "qr"
                    ? "bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white",
                )}
              >
                QR Code
              </button>
              <button
                type="button"
                onClick={() => setModalTab("key")}
                className={cn(
                  "px-3.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                  modalTab === "key"
                    ? "bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-2xs"
                    : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white",
                )}
              >
                Manual Key
              </button>
            </div>

            {/* Fixed height content area across tabs to prevent modal height jumping */}
            <div className="my-4 h-[232px] flex flex-col items-center justify-center w-full">
              {loadingEnrollment ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-7 w-7 animate-spin text-[#7a121b]" />
                </div>
              ) : enrollment ? (
                modalTab === "qr" ? (
                  <div className="flex flex-col items-center justify-center">
                    <div className="rounded-xl border border-slate-200 dark:border-zinc-700 bg-white p-2.5 inline-block shadow-sm">
                      <img
                        src={enrollment.qrCodeDataUrl}
                        alt="Authenticator QR"
                        width={160}
                        height={160}
                        className="block h-40 w-40"
                      />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-zinc-200 text-center">
                      Scan with your authenticator app
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-zinc-500 text-center">
                      Compatible with Google Authenticator, Microsoft Authenticator, and more
                    </p>
                  </div>
                ) : (
                  <div className="w-full space-y-2.5 px-0.5">
                    {/* Setup Key with inline Copy Button */}
                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900/80 p-2 sm:p-2.5">
                      <code
                        aria-label="Setup key"
                        title="Click to copy key"
                        onClick={() => void handleCopy("secret")}
                        className="flex-1 select-all text-center font-mono text-[11px] min-[400px]:text-xs sm:text-[12.5px] font-bold text-slate-800 dark:text-zinc-100 tracking-normal whitespace-nowrap overflow-hidden no-scrollbar cursor-pointer hover:text-[#7a121b] dark:hover:text-[#f87171] transition-colors py-0.5"
                      >
                        {groupKey(enrollment.secretBase32)}
                      </code>
                      <button
                        type="button"
                        onClick={() => void handleCopy("secret")}
                        className="inline-flex items-center gap-1.5 h-8 shrink-0 rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer shadow-2xs"
                      >
                        {copied === "secret" ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Formal Setup Parameters Card */}
                    <div className="rounded-xl border border-slate-200/90 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/40 p-2.5 text-left">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1.5">
                        Manual Configuration Details
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                        <div>
                          <span className="text-slate-400 dark:text-zinc-500 text-[10px] block">Account Name</span>
                          <span className="font-semibold text-slate-700 dark:text-zinc-200 truncate block">
                            {enrollment.accountLabel}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 dark:text-zinc-500 text-[10px] block">Key Type</span>
                          <span className="font-semibold text-slate-700 dark:text-zinc-200 block">
                            Time-based (TOTP)
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 dark:text-zinc-500 text-[10px] block">Code Length</span>
                          <span className="font-semibold text-slate-700 dark:text-zinc-200 block">
                            {enrollment.digits ?? 6} digits
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 dark:text-zinc-500 text-[10px] block">Time Step</span>
                          <span className="font-semibold text-slate-700 dark:text-zinc-200 block">
                            {enrollment.periodSeconds ?? 30} seconds
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-[10.5px] text-center text-slate-400 dark:text-zinc-500">
                      Enter this key into your authenticator app (Google Authenticator, Microsoft Authenticator, etc.)
                    </p>
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-xs text-slate-500 dark:text-zinc-400">
                  <p>Could not load authenticator setup.</p>
                </div>
              )}
            </div>

            <Button
              type="button"
              onClick={() => setIsQrModalOpen(false)}
              className="h-10 w-full rounded-xl bg-gradient-to-b from-[#8a1420] to-[#6d0d17] hover:from-[#961724] hover:to-[#78101a] text-white text-xs font-semibold tracking-wide shadow-md transition-all cursor-pointer"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
