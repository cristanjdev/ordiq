import { beforeEach, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "./audit";
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  PENDING_MFA_TIMEOUT_MS,
  createInMemoryAuthStore,
  generateCurrentTotpCode,
  inspectDeanSession,
  loginStep1Password,
  loginStep2Totp,
  normalizeRecoveryCode,
  seedSingleDeanAccount,
  setAuthStore,
  type AuthStore,
} from "./auth";
import { decryptSecret } from "./crypto";
import { resetEnvCacheForTests } from "./env";

const PASSWORD = "Correct-Horse-Battery-Staple-2026!";
const T0 = new Date("2026-11-02T08:00:00.000Z");

describe("two-factor sign-in safeguards", () => {
  let store: AuthStore;

  beforeEach(async () => {
    process.env.DATABASE_URL = "postgresql://ordiq:secret@localhost:5432/ordiq";
    process.env.AUTH_SECRET = "auth-secret-at-least-16-chars";
    process.env.APP_ENCRYPTION_KEY = "encryption-key-at-least-16-chars";
    process.env.ENGINE_URL = "http://localhost:8000";
    process.env.ENGINE_TOKEN = "shared-engine-token-123456";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.LLM_API_KEY = "sk-test-key";
    process.env.LLM_MONTHLY_TOKEN_BUDGET = "500000";
    resetEnvCacheForTests();
    setAuditSinkForTests({
      async write(input) {
        return { id: crypto.randomUUID(), createdAt: new Date(), ...input };
      },
    });
    store = createInMemoryAuthStore();
    setAuthStore(store);
    await seedSingleDeanAccount({
      username: "dean",
      email: "dean@mseuf.edu.ph",
      password: PASSWORD,
      store,
    });
  });

  const signIn = (now: Date) =>
    loginStep1Password({ identifier: "dean", password: PASSWORD, now, store });

  async function secretOf(): Promise<string> {
    const user = await store.findUserByUsernameOrEmail("dean");
    return decryptSecret(user?.totpSecretEncrypted ?? "");
  }

  async function enroll(now: Date) {
    const step1 = await signIn(now);
    const secret = step1.totpEnrollment?.secretBase32 ?? "";
    const step2 = await loginStep2Totp({
      sessionToken: step1.sessionToken,
      code: generateCurrentTotpCode(secret, now.getTime()),
      now,
      store,
    });
    return { secret, recoveryCodes: step2.recoveryCodes ?? [] };
  }

  it("serves a scannable QR code and keeps the pending secret across retries", async () => {
    const first = await signIn(T0);
    expect(first.stage).toBe("ENROLL_TOTP");
    expect(first.totpEnrollment?.qrCodeDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(first.totpEnrollment?.otpauthUri).toContain("otpauth://totp/");
    expect(first.totpEnrollment?.accountLabel).toBe("dean@mseuf.edu.ph");

    const second = await signIn(new Date(T0.getTime() + 60_000));
    expect(second.totpEnrollment?.secretBase32).toBe(first.totpEnrollment?.secretBase32);
  });

  it("does not accept recovery-code input while enrolling", async () => {
    const step1 = await signIn(T0);
    await expect(
      loginStep2Totp({ sessionToken: step1.sessionToken, code: "ORDQ-AAAA-BBBB", now: T0, store }),
    ).rejects.toMatchObject({ code: "INVALID_TOTP_CODE" });
  });

  it("rejects a TOTP code that was already used (replay)", async () => {
    const { secret } = await enroll(T0);
    // Same 30-second window, same code, new sign-in.
    const later = new Date(T0.getTime() + 5_000);
    const step1 = await signIn(later);
    await expect(
      loginStep2Totp({
        sessionToken: step1.sessionToken,
        code: generateCurrentTotpCode(secret, T0.getTime()),
        now: later,
        store,
      }),
    ).rejects.toMatchObject({ code: "INVALID_TOTP_CODE" });

    // The next code is accepted.
    const next = new Date(T0.getTime() + 30_000);
    const step1b = await signIn(next);
    await expect(
      loginStep2Totp({
        sessionToken: step1b.sessionToken,
        code: generateCurrentTotpCode(secret, next.getTime()),
        now: next,
        store,
      }),
    ).resolves.toMatchObject({ stage: "ACTIVE" });
  });

  it("locks the account after repeated wrong codes, even across password re-entry", async () => {
    await enroll(T0);
    let now = new Date(T0.getTime() + 60_000);
    let pending = await signIn(now);

    for (let i = 1; i < MAX_FAILED_LOGIN_ATTEMPTS; i++) {
      await expect(
        loginStep2Totp({ sessionToken: pending.sessionToken, code: "000000", now, store }),
      ).rejects.toMatchObject({
        code: "INVALID_TOTP_CODE",
        details: { attemptsRemaining: MAX_FAILED_LOGIN_ATTEMPTS - i },
      });
      // Re-entering the password must not reset the counter.
      if (i === 2) {
        now = new Date(now.getTime() + 1_000);
        pending = await signIn(now);
      }
    }

    await expect(
      loginStep2Totp({ sessionToken: pending.sessionToken, code: "000000", now, store }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED", statusCode: 429 });

    // The pending session is revoked and the password step is blocked too.
    await expect(inspectDeanSession(pending.sessionToken, { now, store })).resolves.toEqual({
      ok: false,
      rejection: { reason: "INVALID" },
    });
    await expect(signIn(now)).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("expires a password-only session after the pending window", async () => {
    await enroll(T0);
    const now = new Date(T0.getTime() + 60_000);
    const pending = await signIn(now);
    const secret = await secretOf();
    const tooLate = new Date(now.getTime() + PENDING_MFA_TIMEOUT_MS + 1_000);
    await expect(
      loginStep2Totp({
        sessionToken: pending.sessionToken,
        code: generateCurrentTotpCode(secret, tooLate.getTime()),
        now: tooLate,
        store,
      }),
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("accepts loosely typed recovery codes once and reports how many remain", async () => {
    const { recoveryCodes } = await enroll(T0);
    const typed = (recoveryCodes[0] ?? "").toLowerCase().replace(/-/g, " ").replace("ordq ", "");
    const now = new Date(T0.getTime() + 60_000);
    const pending = await signIn(now);
    await expect(
      loginStep2Totp({ sessionToken: pending.sessionToken, code: typed, now, store }),
    ).resolves.toMatchObject({ stage: "ACTIVE", recoveryCodesRemaining: 7 });
  });

  it("shows recovery codes only at first setup, and a new sign-in clears abandoned ones", async () => {
    const { secret } = await enroll(T0);

    const now = new Date(T0.getTime() + 60_000);
    const abandoned = await signIn(now);
    expect(abandoned.stage).toBe("VERIFY_TOTP");
    expect(abandoned.totpEnrollment).toBeUndefined();

    const fresh = await signIn(new Date(now.getTime() + 1_000));
    await expect(
      inspectDeanSession(abandoned.sessionToken, { now, store }),
    ).resolves.toEqual({ ok: false, rejection: { reason: "INVALID" } });

    const step2 = await loginStep2Totp({
      sessionToken: fresh.sessionToken,
      code: generateCurrentTotpCode(secret, now.getTime()),
      now,
      store,
    });
    expect(step2.stage).toBe("ACTIVE");
    expect(step2.recoveryCodes).toBeUndefined();
  });

  it("normalizes recovery code formats", () => {
    expect(normalizeRecoveryCode("ordq-ab2c-d3ef")).toBe("ORDQ-AB2C-D3EF");
    expect(normalizeRecoveryCode("AB2C D3EF")).toBe("ORDQ-AB2C-D3EF");
    expect(normalizeRecoveryCode("ORDQAB2CD3EF")).toBe("ORDQ-AB2C-D3EF");
    expect(normalizeRecoveryCode("123456")).toBeNull();
  });
});
