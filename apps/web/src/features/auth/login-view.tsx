"use client";

import { KeyRound, Lock, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OrdiqLogo } from "@/components/ui/ordiq-logo";

interface EnrollmentPayload {
  secretBase32: string;
  otpauthUri: string;
}

export function LoginView() {
  const router = useRouter();
  const [step, setStep] = React.useState<
    "PASSWORD" | "TOTP" | "RECOVERY_CODES"
  >("PASSWORD");
  const [identifier, setIdentifier] = React.useState("dean");
  const [password, setPassword] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [enrollment, setEnrollment] =
    React.useState<EnrollmentPayload | null>(null);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = (await res.json()) as {
        stage?: "ENROLL_TOTP" | "VERIFY_TOTP";
        totpEnrollment?: EnrollmentPayload | null;
        error?: { message?: string };
      };
      if (!res.ok) {
        setErrorMessage(data.error?.message ?? "Authentication failed.");
        return;
      }
      setEnrollment(data.totpEnrollment ?? null);
      setStep("TOTP");
    } catch {
      setErrorMessage("Network error while contacting authentication server.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode }),
      });
      const data = (await res.json()) as {
        stage?: "ACTIVE";
        recoveryCodes?: string[] | null;
        error?: { message?: string };
      };
      if (!res.ok) {
        setErrorMessage(data.error?.message ?? "Invalid TOTP or recovery code.");
        return;
      }
      if (data.recoveryCodes && data.recoveryCodes.length > 0) {
        setRecoveryCodes(data.recoveryCodes);
        setStep("RECOVERY_CODES");
      } else {
        router.push("/");
      }
    } catch {
      setErrorMessage("Network error while verifying TOTP code.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#4a0a0f] via-[#2d0508] to-[#170204] p-4">
      <div className="mb-6 flex flex-col items-center text-center text-white">
        <OrdiqLogo size={64} />
        <h1 className="mt-3 text-2xl font-bold tracking-wider">ORDIQ</h1>
        <p className="text-xs italic text-white/80">
          Order Meets Intelligence · MSEUF College of Engineering
        </p>
      </div>

      <Card className="w-full max-w-md border-white/15 shadow-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-5 w-5 text-[var(--ordiq-maroon)]" />
              Office of the Dean Sign-In
            </CardTitle>
            <Badge variant="default">Dean-Only · MFA</Badge>
          </div>
          <CardDescription>
            Public registration is disabled. Access requires both your Dean
            password and a one-time authenticator code.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
            >
              {errorMessage}
            </div>
          )}

          {step === "PASSWORD" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="identifier"
                  className="block text-xs font-semibold text-[var(--ordiq-ink)]"
                >
                  Username or University Email
                </label>
                <input
                  id="identifier"
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-orange)]"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold text-[var(--ordiq-ink)]"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 text-xs text-[var(--ordiq-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-orange)]"
                />
              </div>

              <Button
                type="submit"
                variant="accent"
                className="w-full"
                disabled={submitting}
              >
                <Lock className="h-4 w-4" />
                {submitting ? "Verifying password..." : "Continue to 2FA (TOTP)"}
              </Button>
            </form>
          )}

          {step === "TOTP" && (
            <form onSubmit={handleTotpSubmit} className="space-y-4">
              {enrollment && (
                <div className="rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] p-3.5 text-xs">
                  <p className="font-semibold text-[var(--ordiq-ink)]">
                    First-Login Authenticator Enrollment Required
                  </p>
                  <p className="mt-1 text-[var(--ordiq-muted)]">
                    Enter this Base32 key in Google Authenticator, Microsoft
                    Authenticator, or 1Password:
                  </p>
                  <code className="mt-2 block select-all rounded bg-black/10 p-2 text-center font-mono text-xs font-bold tracking-widest dark:bg-white/10">
                    {enrollment.secretBase32}
                  </code>
                </div>
              )}

              <div>
                <label
                  htmlFor="totpCode"
                  className="block text-xs font-semibold text-[var(--ordiq-ink)]"
                >
                  6-Digit Authenticator Code (or Recovery Code)
                </label>
                <input
                  id="totpCode"
                  type="text"
                  required
                  placeholder="123456 or ORDQ-XXXX-XXXX"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-lg border border-[var(--ordiq-border)] bg-[var(--ordiq-surface-muted)] px-3 font-mono text-xs tracking-wider text-[var(--ordiq-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--ordiq-orange)]"
                />
              </div>

              <Button
                type="submit"
                variant="accent"
                className="w-full"
                disabled={submitting}
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? "Verifying code..." : "Verify & Sign In"}
              </Button>
            </form>
          )}

          {step === "RECOVERY_CODES" && (
            <div className="space-y-4 text-xs">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Save Your Single-Use Recovery Codes
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  Each code below can be used once if you lose access to your
                  authenticator device. Store them securely now.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono font-bold">
                  {recoveryCodes.map((code) => (
                    <div
                      key={code}
                      className="rounded bg-white/80 px-2.5 py-1.5 text-center text-[#2d0508]"
                    >
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                variant="default"
                className="w-full"
                onClick={() => router.push("/")}
              >
                I Have Saved My Recovery Codes — Enter ORDIQ
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

