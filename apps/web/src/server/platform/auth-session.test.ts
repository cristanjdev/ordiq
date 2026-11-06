import { beforeEach, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "./audit";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  createInMemoryAuthStore,
  generateCurrentTotpCode,
  getAuthStore,
  inspectDeanSession,
  isSessionCookieSecure,
  loginStep1Password,
  loginStep2Totp,
  requireDeanSession,
  seedSingleDeanAccount,
  setAuthStore,
  type AuthStore,
} from "./auth";
import { decryptSecret } from "./crypto";
import { resetEnvCacheForTests } from "./env";
import { AppError } from "./errors";

const PASSWORD = "Correct-Horse-Battery-Staple-2026!";
const MINUTE_MS = 60 * 1000;

describe("session validation (route guard + API)", () => {
  beforeEach(() => {
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
  });

  /** Fresh store + Dean account, signed in through the password step only. */
  async function passwordOnlySession(at: Date) {
    const store: AuthStore = createInMemoryAuthStore();
    setAuthStore(store);
    await seedSingleDeanAccount({
      username: "dean",
      email: "dean@mseuf.edu.ph",
      password: PASSWORD,
      store,
    });
    const step1 = await loginStep1Password({
      identifier: "dean",
      password: PASSWORD,
      now: at,
      store,
    });
    return { store, token: step1.sessionToken };
  }

  /** Fresh store + Dean account with both the password and TOTP steps done. */
  async function activeSession(at: Date) {
    const { store, token } = await passwordOnlySession(at);
    const user = await store.findUserByUsernameOrEmail("dean");
    if (!user?.totpSecretEncrypted) {
      throw new Error("Expected the seeded Dean to have a TOTP secret");
    }
    const secret = decryptSecret(user.totpSecretEncrypted);
    const step2 = await loginStep2Totp({
      sessionToken: token,
      code: generateCurrentTotpCode(secret, at.getTime()),
      now: at,
      store,
    });
    // Completing the second factor rotates the session token.
    return { store, token: step2.sessionToken };
  }

  it("rejects a missing token and an unknown token", async () => {
    await expect(inspectDeanSession(null)).resolves.toEqual({
      ok: false,
      rejection: { reason: "MISSING" },
    });
    await expect(inspectDeanSession("not-a-real-token")).resolves.toEqual({
      ok: false,
      rejection: { reason: "INVALID" },
    });
  });

  it("refuses a password-only session until TOTP is verified", async () => {
    const { token } = await passwordOnlySession(new Date());
    await expect(inspectDeanSession(token)).resolves.toEqual({
      ok: false,
      rejection: { reason: "MFA_PENDING", stage: "ENROLL_TOTP" },
    });
  });

  it("accepts a fully authenticated Dean session", async () => {
    const { token } = await activeSession(new Date());
    const result = await inspectDeanSession(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.user.role).toBe("DEAN");
      expect(result.context.session.stage).toBe("ACTIVE");
    }
  });

  it("passive validation never extends the idle window; active validation does", async () => {
    const start = new Date("2026-01-01T08:00:00Z");
    const { token } = await activeSession(start);
    const later = new Date(start.getTime() + 10 * MINUTE_MS);

    const passive = await inspectDeanSession(token, {
      now: later,
      slide: false,
    });
    expect(passive.ok).toBe(true);
    if (passive.ok) {
      expect(passive.context.session.idleExpiresAt.getTime()).toBe(
        start.getTime() + IDLE_TIMEOUT_MS,
      );
    }

    const active = await inspectDeanSession(token, { now: later });
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.context.session.idleExpiresAt.getTime()).toBe(
        later.getTime() + IDLE_TIMEOUT_MS,
      );
    }
  });

  it("expires idle sessions and purges them", async () => {
    const start = new Date("2026-01-01T08:00:00Z");
    const { token } = await activeSession(start);

    const idleLapsed = new Date(start.getTime() + IDLE_TIMEOUT_MS + 1000);
    await expect(
      inspectDeanSession(token, { now: idleLapsed }),
    ).resolves.toEqual({ ok: false, rejection: { reason: "EXPIRED" } });

    // Purged: the same token is now simply unknown.
    await expect(inspectDeanSession(token, { now: start })).resolves.toEqual({
      ok: false,
      rejection: { reason: "INVALID" },
    });
  });

  it("caps continuous activity at the absolute session lifetime", async () => {
    const start = new Date("2026-01-01T08:00:00Z");
    const { token } = await activeSession(start);
    const absoluteLimit = start.getTime() + ABSOLUTE_TIMEOUT_MS;

    // A user who is active every 20 minutes keeps the session alive...
    let cursor = start.getTime();
    while (cursor + 20 * MINUTE_MS < absoluteLimit) {
      cursor += 20 * MINUTE_MS;
      const result = await inspectDeanSession(token, { now: new Date(cursor) });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // ...but the idle window can never be pushed past the absolute limit.
        expect(result.context.session.idleExpiresAt.getTime()).toBeLessThanOrEqual(
          absoluteLimit,
        );
      }
    }

    await expect(
      inspectDeanSession(token, { now: new Date(absoluteLimit + 1000) }),
    ).resolves.toEqual({ ok: false, rejection: { reason: "EXPIRED" } });
  });

  it("requireDeanSession keeps its error contract for API routes", async () => {
    const asRequest = (token?: string) =>
      new Request("http://localhost/api/v1/x", {
        headers: token ? { cookie: `ordiq_session=${token}` } : {},
      });

    await expect(requireDeanSession(asRequest())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      statusCode: 401,
    });
    await expect(requireDeanSession(asRequest("bogus"))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      statusCode: 401,
    });

    const { token } = await passwordOnlySession(new Date());
    const pending = requireDeanSession(asRequest(token));
    await expect(pending).rejects.toBeInstanceOf(AppError);
    await expect(pending).rejects.toMatchObject({
      code: "TOTP_REQUIRED",
      statusCode: 401,
      details: { stage: "ENROLL_TOTP" },
    });
  });

  it("pins the active store on globalThis so every bundle shares it", () => {
    const replacement = createInMemoryAuthStore();
    setAuthStore(replacement);
    expect(getAuthStore()).toBe(replacement);
    expect(
      (globalThis as unknown as { __ordiqAuthStore?: AuthStore })
        .__ordiqAuthStore,
    ).toBe(replacement);
  });

  it("derives the Secure cookie flag from NODE_ENV with an explicit override", () => {
    expect(isSessionCookieSecure({ NODE_ENV: "production" })).toBe(true);
    expect(isSessionCookieSecure({ NODE_ENV: "development" })).toBe(false);
    expect(isSessionCookieSecure({ NODE_ENV: "test" })).toBe(false);
    expect(
      isSessionCookieSecure({
        NODE_ENV: "production",
        AUTH_COOKIE_SECURE: "false",
      }),
    ).toBe(false);
    expect(
      isSessionCookieSecure({
        NODE_ENV: "development",
        AUTH_COOKIE_SECURE: " TRUE ",
      }),
    ).toBe(true);
  });
});
