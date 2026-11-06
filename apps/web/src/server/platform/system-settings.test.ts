import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_SETTINGS, normalizeSystemSettings, type SystemSettings } from "@/lib/system-settings";
import { setAuditSinkForTests } from "./audit";
import {
  type AuthStore,
  createInMemoryAuthStore,
  inspectDeanSession,
  loginStep1Password,
  seedSingleDeanAccount,
  setAuthStore,
} from "./auth";
import { AppError } from "./errors";
import {
  getSystemSettings,
  resetSystemSettingsForTests,
  updateSystemSettings,
} from "./system-settings";

const PASSWORD = "Correct-Horse-Battery-Staple-2026!";
const MINUTE_MS = 60 * 1000;

function withSecurity(patch: Partial<SystemSettings["security"]>): SystemSettings {
  return {
    ...DEFAULT_SYSTEM_SETTINGS,
    security: { ...DEFAULT_SYSTEM_SETTINGS.security, ...patch },
  };
}

async function freshDean(): Promise<AuthStore> {
  const store = createInMemoryAuthStore();
  setAuthStore(store);
  await seedSingleDeanAccount({ username: "dean", email: "dean@mseuf.edu.ph", password: PASSWORD, store });
  return store;
}

describe("system settings", () => {
  const audits: string[] = [];
  beforeEach(() => {
    resetSystemSettingsForTests();
    audits.length = 0;
    setAuditSinkForTests({
      async write(input) {
        audits.push(input.action);
        return { id: crypto.randomUUID(), createdAt: new Date(), ...input };
      },
    });
  });
  afterEach(() => resetSystemSettingsForTests());

  it("starts from the defaults and fills fields missing from older saved data", async () => {
    expect((await getSystemSettings()).security).toEqual(DEFAULT_SYSTEM_SETTINGS.security);
    const merged = normalizeSystemSettings({ security: { twoFactorRequired: false } });
    expect(merged.security.twoFactorRequired).toBe(false);
    expect(merged.security.idleTimeoutMinutes).toBe(30);
    // Out-of-range data is rejected as a whole.
    expect(normalizeSystemSettings({ security: { idleTimeoutMinutes: 1 } })).toEqual(DEFAULT_SYSTEM_SETTINGS);
  });

  it("saves, rejects out-of-range values and writes an audit entry", async () => {
    await updateSystemSettings({ next: withSecurity({ lockoutMinutes: 30 }), actor: "dean" });
    expect((await getSystemSettings()).security.lockoutMinutes).toBe(30);
    expect(audits).toContain("SYSTEM_SETTINGS_UPDATED");
    await expect(
      updateSystemSettings({ next: withSecurity({ maxFailedLoginAttempts: 99 }), actor: "dean" }),
    ).rejects.toThrow();
  });

  it("signs in with the password alone when two-factor authentication is off", async () => {
    const store = await freshDean();
    await updateSystemSettings({ next: withSecurity({ twoFactorRequired: false }), actor: "dean" });
    const now = new Date("2026-11-06T08:00:00Z");
    const step1 = await loginStep1Password({ identifier: "dean", password: PASSWORD, now, store });
    expect(step1.stage).toBe("ACTIVE");
    expect(step1.totpEnrollment).toBeUndefined();
    const check = await inspectDeanSession(step1.sessionToken, { store, now });
    expect(check.ok).toBe(true);
    expect(audits).toContain("LOGIN_PASSWORD_ONLY");
  });

  it("still asks for the code when two-factor authentication is on", async () => {
    const store = await freshDean();
    const step1 = await loginStep1Password({ identifier: "dean", password: PASSWORD, store });
    expect(step1.stage).not.toBe("ACTIVE");
    const check = await inspectDeanSession(step1.sessionToken, { store });
    expect(check.ok).toBe(false);
  });

  it("keeps an idle session when automatic sign-out is off, until the maximum length", async () => {
    const store = await freshDean();
    await updateSystemSettings({
      next: withSecurity({ twoFactorRequired: false, idleTimeoutEnabled: false, absoluteSessionHours: 2 }),
      actor: "dean",
    });
    const start = new Date("2026-11-06T08:00:00Z");
    const { sessionToken } = await loginStep1Password({ identifier: "dean", password: PASSWORD, now: start, store });
    const afterIdle = new Date(start.getTime() + 90 * MINUTE_MS);
    expect((await inspectDeanSession(sessionToken, { store, now: afterIdle, slide: false })).ok).toBe(true);
    const afterMax = new Date(start.getTime() + 121 * MINUTE_MS);
    const expired = await inspectDeanSession(sessionToken, { store, now: afterMax });
    expect(expired).toMatchObject({ ok: false, rejection: { reason: "EXPIRED" } });
  });

  it("uses the configured inactivity limit", async () => {
    const store = await freshDean();
    await updateSystemSettings({
      next: withSecurity({ twoFactorRequired: false, idleTimeoutMinutes: 10 }),
      actor: "dean",
    });
    const start = new Date("2026-11-06T08:00:00Z");
    const { sessionToken } = await loginStep1Password({ identifier: "dean", password: PASSWORD, now: start, store });
    const after11 = new Date(start.getTime() + 11 * MINUTE_MS);
    expect(await inspectDeanSession(sessionToken, { store, now: after11 })).toMatchObject({
      ok: false,
      rejection: { reason: "EXPIRED" },
    });
  });

  it("locks the account after the configured number of failed attempts", async () => {
    const store = await freshDean();
    await updateSystemSettings({
      next: withSecurity({ maxFailedLoginAttempts: 3, lockoutMinutes: 5 }),
      actor: "dean",
    });
    const now = new Date("2026-11-06T08:00:00Z");
    const attempt = () => loginStep1Password({ identifier: "dean", password: "wrong", now, store });
    await expect(attempt()).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(attempt()).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const third = await attempt().catch((e: unknown) => e);
    expect(third).toBeInstanceOf(AppError);
    expect((third as AppError).code).toBe("ACCOUNT_LOCKED");
    const lockedUntil = new Date(String((third as AppError).details.lockedUntil));
    expect(lockedUntil.getTime() - now.getTime()).toBe(5 * MINUTE_MS);
  });
});
