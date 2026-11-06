import { hash, verify } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE_NAME,
} from "@/lib/auth-constants";
import { recordAudit } from "./audit";
import {
  decryptSecret,
  encryptSecret,
  generateOpaqueToken,
  generateRecoveryCodes,
  sha256Hex,
} from "./crypto";
import { AppError, withErrorHandler } from "./errors";
import { currentSystemSettings, getSystemSettings } from "./system-settings";

// Timeouts and the cookie name live in an edge-safe module so the middleware and
// client code share one source of truth; re-exported here for server callers.
export { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, SESSION_COOKIE_NAME };
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout
/** Lifetime of a password-only session waiting for the authenticator step. */
export const PENDING_MFA_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * The idle window is written back at most this often. Every page loads several
 * API calls at once; extending the session on each would add a database write
 * per call for a change of a few seconds against a 30-minute idle timeout.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * Sign-in and session rules from the Settings page. The constants above are
 * the defaults (used until the Dean saves the Settings page).
 */
interface AuthPolicy {
  twoFactorRequired: boolean;
  /** null when automatic sign-out after inactivity is turned off. */
  idleTimeoutMs: number | null;
  absoluteTimeoutMs: number;
  maxFailedAttempts: number;
  lockoutMs: number;
}

async function loadAuthPolicy(): Promise<AuthPolicy> {
  const s = (await getSystemSettings()).security;
  return {
    twoFactorRequired: s.twoFactorRequired,
    idleTimeoutMs: s.idleTimeoutEnabled ? s.idleTimeoutMinutes * 60 * 1000 : null,
    absoluteTimeoutMs: s.absoluteSessionHours * 60 * 60 * 1000,
    maxFailedAttempts: s.maxFailedLoginAttempts,
    lockoutMs: s.lockoutMinutes * 60 * 1000,
  };
}

/** First idle deadline of a new ACTIVE session. */
function initialIdleExpiry(now: Date, policy: AuthPolicy): Date {
  const absolute = now.getTime() + policy.absoluteTimeoutMs;
  return new Date(
    policy.idleTimeoutMs === null ? absolute : Math.min(now.getTime() + policy.idleTimeoutMs, absolute),
  );
}

export type SessionStage = "ENROLL_TOTP" | "VERIFY_TOTP" | "ACTIVE";

export interface AuthUserRecord {
  id: string;
  username: string;
  email: string;
  role: "DEAN";
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnrolled: boolean;
  /** Last accepted TOTP time step; codes at or before it are rejected (replay protection). */
  totpLastUsedStep: number | null;
  recoveryCodesHashes: string[];
  /** Failed password and second-factor attempts since the last fully completed sign-in. */
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  stage: SessionStage;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
}

export interface AuthStore {
  countUsers(): Promise<number>;
  findUserByUsernameOrEmail(identifier: string): Promise<AuthUserRecord | null>;
  findUserById(id: string): Promise<AuthUserRecord | null>;
  createUser(
    data: Omit<AuthUserRecord, "id">,
  ): Promise<AuthUserRecord>;
  updateUser(
    id: string,
    patch: Partial<Omit<AuthUserRecord, "id">>,
  ): Promise<AuthUserRecord>;
  createSession(
    data: Omit<AuthSessionRecord, "id" | "createdAt">,
  ): Promise<AuthSessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  /** Session and its user in one lookup (one database round trip). */
  findSessionWithUserByTokenHash(
    tokenHash: string,
  ): Promise<{ session: AuthSessionRecord; user: AuthUserRecord | null } | null>;
  updateSession(
    id: string,
    patch: Partial<Omit<AuthSessionRecord, "id" | "createdAt">>,
  ): Promise<AuthSessionRecord>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
  /** Removes the user's expired sessions and abandoned (not yet ACTIVE) sign-ins. */
  purgeStaleSessions(userId: string, now: Date): Promise<number>;
}

/**
 * Default in-memory fallback store used in isolated unit/route tests when DB is not attached;
 * the running app always uses the PostgreSQL store (see getAuthStore).
 */
export function createInMemoryAuthStore(): AuthStore {
  const users = new Map<string, AuthUserRecord>();
  const sessions = new Map<string, AuthSessionRecord>();

  return {
    async countUsers() {
      return users.size;
    },
    async findUserByUsernameOrEmail(identifier) {
      const normalized = identifier.trim().toLowerCase();
      for (const u of users.values()) {
        if (
          u.username.toLowerCase() === normalized ||
          u.email.toLowerCase() === normalized
        ) {
          return { ...u };
        }
      }
      return null;
    },
    async findUserById(id) {
      const found = users.get(id);
      return found ? { ...found } : null;
    },
    async createUser(data) {
      if (users.size >= 1) {
        throw new AppError(
          "DEAN_ACCOUNT_ALREADY_EXISTS",
          "ORDIQ allows only a single Dean account.",
          409,
        );
      }
      const id = crypto.randomUUID();
      const record: AuthUserRecord = { id, ...data };
      users.set(id, record);
      return { ...record };
    },
    async updateUser(id, patch) {
      const existing = users.get(id);
      if (!existing) {
        throw new AppError("USER_NOT_FOUND", "User not found.", 404);
      }
      const updated: AuthUserRecord = { ...existing, ...patch };
      users.set(id, updated);
      return { ...updated };
    },
    async createSession(data) {
      const id = crypto.randomUUID();
      const record: AuthSessionRecord = {
        id,
        createdAt: new Date(),
        ...data,
      };
      sessions.set(record.tokenHash, record);
      return { ...record };
    },
    async findSessionByTokenHash(tokenHash) {
      const found = sessions.get(tokenHash);
      return found ? { ...found } : null;
    },
    async findSessionWithUserByTokenHash(tokenHash) {
      const found = sessions.get(tokenHash);
      if (!found) return null;
      const user = users.get(found.userId);
      return { session: { ...found }, user: user ? { ...user } : null };
    },
    async updateSession(id, patch) {
      for (const [key, session] of sessions.entries()) {
        if (session.id === id) {
          const updated: AuthSessionRecord = { ...session, ...patch };
          sessions.set(key, updated);
          return { ...updated };
        }
      }
      throw new AppError("SESSION_NOT_FOUND", "Session not found.", 404);
    },
    async deleteSessionByTokenHash(tokenHash) {
      sessions.delete(tokenHash);
    },
    async purgeStaleSessions(userId, now) {
      let removed = 0;
      for (const [key, s] of sessions.entries()) {
        if (s.userId !== userId) continue;
        const expired =
          s.idleExpiresAt.getTime() <= now.getTime() ||
          s.absoluteExpiresAt.getTime() <= now.getTime();
        if (expired || s.stage !== "ACTIVE") {
          sessions.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * Postgres-backed store used in production. The Prisma client is loaded lazily
 * so in-memory runs (tests, local development) never require a database.
 */
function createLazyPrismaAuthStore(): AuthStore {
  const load = async (): Promise<AuthStore> =>
    (await import("./auth.prisma-store")).prismaAuthStore;
  return {
    countUsers: async () => (await load()).countUsers(),
    findUserByUsernameOrEmail: async (identifier) =>
      (await load()).findUserByUsernameOrEmail(identifier),
    findUserById: async (id) => (await load()).findUserById(id),
    createUser: async (data) => (await load()).createUser(data),
    updateUser: async (id, patch) => (await load()).updateUser(id, patch),
    createSession: async (data) => (await load()).createSession(data),
    findSessionByTokenHash: async (tokenHash) =>
      (await load()).findSessionByTokenHash(tokenHash),
    findSessionWithUserByTokenHash: async (tokenHash) =>
      (await load()).findSessionWithUserByTokenHash(tokenHash),
    updateSession: async (id, patch) =>
      (await load()).updateSession(id, patch),
    deleteSessionByTokenHash: async (tokenHash) =>
      (await load()).deleteSessionByTokenHash(tokenHash),
    purgeStaleSessions: async (userId, now) =>
      (await load()).purgeStaleSessions(userId, now),
  };
}

/**
 * Users and sessions always live in PostgreSQL (Supabase), in development and
 * production. The Prisma-backed store keeps no state of its own, so it is
 * created per module instance; after a hot reload in `next dev` the new code
 * takes effect immediately instead of an outdated store object lingering.
 */
const databaseAuthStore: AuthStore = createLazyPrismaAuthStore();

/**
 * The automated test suite (NODE_ENV=test) runs auth in memory. That store holds
 * state, so it is pinned on `globalThis` and tests may replace it with
 * `setAuthStore`.
 */
const globalForAuth = globalThis as unknown as {
  __ordiqAuthStore?: AuthStore;
};

export function getAuthStore(): AuthStore {
  if (process.env.NODE_ENV !== "test") {
    return databaseAuthStore;
  }
  globalForAuth.__ordiqAuthStore ??= createInMemoryAuthStore();
  return globalForAuth.__ordiqAuthStore;
}

/** Test-only: installs the auth store used by the automated test suite. */
export function setAuthStore(store: AuthStore): void {
  globalForAuth.__ordiqAuthStore = store;
}

export async function hashPasswordArgon2id(password: string): Promise<string> {
  // algorithm: 2 is Argon2id in @node-rs/argon2 (default algorithm)
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPasswordArgon2id(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

export function generateTotpSecretBase32(): string {
  const secret = new OTPAuth.Secret({ size: 20 });
  return secret.base32;
}

export const TOTP_ISSUER = "ORDIQ (MSEUF Engineering)";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function buildTotpInstance(
  base32Secret: string,
  accountLabel: string,
): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
  });
}

export function generateCurrentTotpCode(
  base32Secret: string,
  timestampMs = Date.now(),
): string {
  const totp = buildTotpInstance(base32Secret, "dean@mseuf.edu.ph");
  return totp.generate({ timestamp: timestampMs });
}

export function verifyTotpCode(
  base32Secret: string,
  code: string,
  timestampMs = Date.now(),
): boolean {
  return matchTotpStep(base32Secret, code, timestampMs) !== null;
}

/**
 * Returns the TOTP time step the code belongs to (one step of clock drift is
 * accepted either way), or null when the code does not match.
 */
export function matchTotpStep(
  base32Secret: string,
  code: string,
  timestampMs = Date.now(),
): number | null {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  const totp = buildTotpInstance(base32Secret, "dean@mseuf.edu.ph");
  const delta = totp.validate({
    token: normalized,
    timestamp: timestampMs,
    window: 1,
  });
  if (delta === null) return null;
  return Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS) + delta;
}

/**
 * Accepts recovery codes typed in lower case, with spaces, or without the ORDQ
 * prefix and dashes, and returns the canonical `ORDQ-XXXX-XXXX` form.
 */
export function normalizeRecoveryCode(code: string): string | null {
  const compact = code.toUpperCase().replace(/[\s-]+/g, "");
  const match = /^(?:ORDQ)?([A-Z0-9]{4})([A-Z0-9]{4})$/.exec(compact);
  return match ? `ORDQ-${match[1]}-${match[2]}` : null;
}

/** Renders the otpauth URI as an SVG QR code data URL (never via a third-party service). */
async function renderTotpQrCode(otpauthUri: string): Promise<string> {
  const svg = await QRCode.toString(otpauthUri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Seeds the single Dean account (CLI seed only — public signup does not exist).
 * Refuses to create a second account (Phase 1A Exit Criterion).
 */
export async function seedSingleDeanAccount(params: {
  username: string;
  email: string;
  password: string;
  store?: AuthStore;
}): Promise<{ user: AuthUserRecord }> {
  const store = params.store ?? getAuthStore();
  const count = await store.countUsers();
  if (count > 0) {
    throw new AppError(
      "DEAN_ACCOUNT_ALREADY_EXISTS",
      "A Dean account already exists. Second account creation is forbidden.",
      409,
    );
  }
  const passwordHash = await hashPasswordArgon2id(params.password);
  const user = await store.createUser({
    username: params.username.trim(),
    email: params.email.trim().toLowerCase(),
    role: "DEAN",
    passwordHash,
    totpSecretEncrypted: null,
    totpEnrolled: false,
    totpLastUsedStep: null,
    recoveryCodesHashes: [],
    failedLoginAttempts: 0,
    lockedUntil: null,
  });

  await recordAudit({
    actor: "SYSTEM_SEED",
    action: "DEAN_ACCOUNT_SEEDED",
    entity: "User",
    entityId: user.id,
    after: { username: user.username, email: user.email, role: user.role },
  });

  return { user };
}

/** Failures before this attempt; a lockout that has run out starts a fresh count. */
function priorFailedAttempts(user: AuthUserRecord, now: Date): number {
  if (user.lockedUntil && user.lockedUntil.getTime() <= now.getTime()) {
    return 0;
  }
  return user.failedLoginAttempts;
}

export interface PasswordStepResult {
  sessionToken: string;
  /** ACTIVE when two-factor sign-in is turned off in Settings. */
  stage: "ENROLL_TOTP" | "VERIFY_TOTP" | "ACTIVE";
  totpEnrollment?: TotpEnrollmentPayload;
}

export interface TotpEnrollmentPayload {
  secretBase32: string;
  otpauthUri: string;
  /** QR code of `otpauthUri` as an SVG data URL, rendered on the server. */
  qrCodeDataUrl: string;
  accountLabel: string;
  issuer: string;
  digits: number;
  periodSeconds: number;
}

/**
 * Step 1 of login: verifies username/email + password with rate-limiting and lockout.
 * Never grants an ACTIVE session until Step 2 (TOTP or recovery code) succeeds!
 */
export async function loginStep1Password(params: {
  identifier: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  store?: AuthStore;
}): Promise<PasswordStepResult> {
  const store = params.store ?? getAuthStore();
  const now = params.now ?? new Date();
  const policy = await loadAuthPolicy();
  const user = await store.findUserByUsernameOrEmail(params.identifier);

  if (!user) {
    await recordAudit({
      actor: "ANONYMOUS",
      action: "LOGIN_FAILED_UNKNOWN_USER",
      entity: "User",
      entityId: "unknown",
      ipAddress: params.ipAddress ?? null,
    });
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Invalid username or password.",
      401,
    );
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await recordAudit({
      actor: user.username,
      action: "LOGIN_BLOCKED_LOCKOUT",
      entity: "User",
      entityId: user.id,
      ipAddress: params.ipAddress ?? null,
    });
    throw new AppError(
      "ACCOUNT_LOCKED",
      "Account is temporarily locked due to repeated failed login attempts.",
      429,
      { lockedUntil: user.lockedUntil.toISOString() },
    );
  }

  const validPassword = await verifyPasswordArgon2id(
    user.passwordHash,
    params.password,
  );

  if (!validPassword) {
    const attempts = priorFailedAttempts(user, now) + 1;
    const lockedUntil =
      attempts >= policy.maxFailedAttempts
        ? new Date(now.getTime() + policy.lockoutMs)
        : null;

    await store.updateUser(user.id, {
      failedLoginAttempts: attempts,
      lockedUntil,
    });

    await recordAudit({
      actor: user.username,
      action: lockedUntil ? "ACCOUNT_LOCKED_OUT" : "LOGIN_PASSWORD_FAILED",
      entity: "User",
      entityId: user.id,
      after: { failedLoginAttempts: attempts },
      ipAddress: params.ipAddress ?? null,
    });

    if (lockedUntil) {
      throw new AppError(
        "ACCOUNT_LOCKED",
        "Account is temporarily locked due to repeated failed login attempts.",
        429,
        { lockedUntil: lockedUntil.toISOString() },
      );
    }

    throw new AppError(
      "INVALID_CREDENTIALS",
      "Invalid username or password.",
      401,
    );
  }

  if (!policy.twoFactorRequired) {
    // Two-factor sign-in is turned off in Settings: the password completes
    // the sign-in. Any enrolled authenticator is kept for when it is turned on.
    await store.purgeStaleSessions(user.id, now);
    await store.updateUser(user.id, { failedLoginAttempts: 0, lockedUntil: null });
    const rawToken = generateOpaqueToken(32);
    const activeSession = await store.createSession({
      userId: user.id,
      tokenHash: sha256Hex(rawToken),
      stage: "ACTIVE",
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      lastActiveAt: now,
      idleExpiresAt: initialIdleExpiry(now, policy),
      absoluteExpiresAt: new Date(now.getTime() + policy.absoluteTimeoutMs),
    });
    await recordAudit({
      actor: user.username,
      action: "LOGIN_PASSWORD_ONLY",
      entity: "Session",
      entityId: activeSession.id,
      after: { twoFactorRequired: false },
      ipAddress: params.ipAddress ?? null,
    });
    return { sessionToken: rawToken, stage: "ACTIVE" };
  }

  // Password succeeded. The failure counter is deliberately NOT reset here; it
  // resets only once the second factor succeeds, so re-entering the password
  // cannot buy unlimited guesses at the authenticator code.
  let totpEnrollment: PasswordStepResult["totpEnrollment"];
  let stage: "ENROLL_TOTP" | "VERIFY_TOTP" = "VERIFY_TOTP";

  if (!user.totpEnrolled || !user.totpSecretEncrypted) {
    stage = "ENROLL_TOTP";
    // Reuse the pending (not yet confirmed) secret across retries so an
    // authenticator entry that was already scanned stays valid.
    let secretBase32: string | null = null;
    if (user.totpSecretEncrypted) {
      try {
        secretBase32 = decryptSecret(user.totpSecretEncrypted);
      } catch {
        secretBase32 = null;
      }
    }
    if (!secretBase32) {
      secretBase32 = generateTotpSecretBase32();
      await store.updateUser(user.id, {
        totpSecretEncrypted: encryptSecret(secretBase32),
        totpLastUsedStep: null,
      });
    }
    const otpauthUri = buildTotpInstance(secretBase32, user.email).toString();
    totpEnrollment = {
      secretBase32,
      otpauthUri,
      qrCodeDataUrl: await renderTotpQrCode(otpauthUri),
      accountLabel: user.email,
      issuer: TOTP_ISSUER,
      digits: TOTP_DIGITS,
      periodSeconds: TOTP_PERIOD_SECONDS,
    };
  }

  // A new sign-in supersedes any half-finished one; expired sessions go too.
  await store.purgeStaleSessions(user.id, now);

  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);

  await store.createSession({
    userId: user.id,
    tokenHash,
    stage,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    lastActiveAt: now,
    // A password-only session exists just long enough to finish the second factor.
    idleExpiresAt: new Date(now.getTime() + PENDING_MFA_TIMEOUT_MS),
    absoluteExpiresAt: new Date(now.getTime() + PENDING_MFA_TIMEOUT_MS),
  });

  await recordAudit({
    actor: user.username,
    action: "LOGIN_STEP1_PASSWORD_OK",
    entity: "Session",
    entityId: user.id,
    after: { stage },
    ipAddress: params.ipAddress ?? null,
  });

  return {
    sessionToken: rawToken,
    stage,
    ...(totpEnrollment ? { totpEnrollment } : {}),
  };
}

export interface TotpStepResult {
  stage: "ACTIVE";
  /**
   * Token of the new, fully authenticated session. The password-only session
   * is discarded, so the token issued before the second factor never becomes
   * an authenticated credential (session-fixation protection).
   */
  sessionToken: string;
  recoveryCodes?: string[];
  /** Set when a recovery code was used: how many unused codes remain. */
  recoveryCodesRemaining?: number;
}

/**
 * Step 2 of login: verifies the TOTP code (or a single-use recovery code) and
 * replaces the password-only session with a new ACTIVE session.
 *
 * Production safeguards:
 * - Failed codes count toward the same lockout as failed passwords; at the limit
 *   the account locks and the pending session is revoked.
 * - A TOTP code is accepted at most once (replay protection by time step).
 * - Recovery codes are accepted only after enrollment and are single-use.
 */
export async function loginStep2Totp(params: {
  sessionToken: string;
  code: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  now?: Date;
  store?: AuthStore;
}): Promise<TotpStepResult> {
  const store = params.store ?? getAuthStore();
  const now = params.now ?? new Date();
  const policy = await loadAuthPolicy();
  const tokenHash = sha256Hex(params.sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);

  if (
    !session ||
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  ) {
    if (session) await store.deleteSessionByTokenHash(tokenHash);
    throw new AppError(
      "SESSION_EXPIRED",
      "The sign-in attempt has expired. Please enter the username and password again.",
      401,
    );
  }

  if (session.stage === "ACTIVE") {
    throw new AppError(
      "ALREADY_AUTHENTICATED",
      "This session has already completed two-factor verification.",
      409,
    );
  }

  const user = await store.findUserById(session.userId);
  if (!user || !user.totpSecretEncrypted) {
    throw new AppError(
      "TOTP_NOT_INITIALIZED",
      "Two-factor authentication is not initialized for this account. Please sign in again.",
      400,
    );
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    await store.deleteSessionByTokenHash(tokenHash);
    throw new AppError(
      "ACCOUNT_LOCKED",
      "Account is temporarily locked due to repeated failed login attempts.",
      429,
      { lockedUntil: user.lockedUntil.toISOString() },
    );
  }

  const enrolling = session.stage === "ENROLL_TOTP" || !user.totpEnrolled;
  const secretBase32 = decryptSecret(user.totpSecretEncrypted);

  let verified = false;
  let usedRecoveryCode = false;
  let replayed = false;
  let acceptedStep: number | null = null;
  let remainingRecoveryHashes = user.recoveryCodesHashes;

  const totpStep = matchTotpStep(secretBase32, params.code, now.getTime());
  if (totpStep !== null) {
    if (user.totpLastUsedStep !== null && totpStep <= user.totpLastUsedStep) {
      replayed = true;
    } else {
      verified = true;
      acceptedStep = totpStep;
    }
  } else if (!enrolling) {
    // Recovery codes only exist once enrollment is complete.
    const recoveryCode = normalizeRecoveryCode(params.code);
    if (recoveryCode) {
      const candidateHash = sha256Hex(recoveryCode);
      const idx = user.recoveryCodesHashes.indexOf(candidateHash);
      if (idx !== -1) {
        verified = true;
        usedRecoveryCode = true;
        remainingRecoveryHashes = user.recoveryCodesHashes.filter(
          (_, i) => i !== idx,
        );
      }
    }
  }

  if (!verified) {
    const attempts = priorFailedAttempts(user, now) + 1;
    const lockedUntil =
      attempts >= policy.maxFailedAttempts
        ? new Date(now.getTime() + policy.lockoutMs)
        : null;
    await store.updateUser(user.id, {
      failedLoginAttempts: attempts,
      lockedUntil,
    });
    await recordAudit({
      actor: user.username,
      action: lockedUntil
        ? "ACCOUNT_LOCKED_OUT"
        : replayed
          ? "LOGIN_TOTP_REPLAY_REJECTED"
          : "LOGIN_TOTP_FAILED",
      entity: "User",
      entityId: user.id,
      after: { failedLoginAttempts: attempts },
      ipAddress: params.ipAddress ?? null,
    });

    if (lockedUntil) {
      await store.deleteSessionByTokenHash(tokenHash);
      throw new AppError(
        "ACCOUNT_LOCKED",
        "Account is temporarily locked due to repeated failed login attempts.",
        429,
        { lockedUntil: lockedUntil.toISOString() },
      );
    }

    const attemptsRemaining = policy.maxFailedAttempts - attempts;
    throw new AppError(
      "INVALID_TOTP_CODE",
      replayed
        ? "This code has already been used. Wait for the authenticator to show a new code."
        : enrolling
          ? "Invalid authenticator code. Check that the device clock is correct and enter the current 6-digit code."
          : "Invalid authenticator or recovery code.",
      401,
      { attemptsRemaining },
    );
  }

  let recoveryCodes: string[] | undefined;
  if (enrolling) {
    recoveryCodes = generateRecoveryCodes(8);
    remainingRecoveryHashes = recoveryCodes.map((c) => sha256Hex(c));
  }

  await store.updateUser(user.id, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    totpEnrolled: true,
    recoveryCodesHashes: remainingRecoveryHashes,
    ...(acceptedStep !== null ? { totpLastUsedStep: acceptedStep } : {}),
  });

  // Rotate the session: drop the password-only session and issue a new token.
  await store.deleteSessionByTokenHash(tokenHash);
  const rawToken = generateOpaqueToken(32);
  const activeSession = await store.createSession({
    userId: user.id,
    tokenHash: sha256Hex(rawToken),
    stage: "ACTIVE",
    ipAddress: params.ipAddress ?? session.ipAddress,
    userAgent: params.userAgent ?? session.userAgent,
    lastActiveAt: now,
    idleExpiresAt: initialIdleExpiry(now, policy),
    absoluteExpiresAt: new Date(now.getTime() + policy.absoluteTimeoutMs),
  });

  if (enrolling) {
    await recordAudit({
      actor: user.username,
      action: "TOTP_ENROLLED",
      entity: "User",
      entityId: user.id,
      after: { recoveryCodesIssued: recoveryCodes?.length ?? 0 },
      ipAddress: params.ipAddress ?? null,
    });
  }

  await recordAudit({
    actor: user.username,
    action: usedRecoveryCode ? "LOGIN_RECOVERY_CODE_USED" : "LOGIN_TOTP_VERIFIED",
    entity: "Session",
    entityId: activeSession.id,
    ...(usedRecoveryCode
      ? { after: { recoveryCodesRemaining: remainingRecoveryHashes.length } }
      : {}),
    ipAddress: params.ipAddress ?? null,
  });

  return {
    stage: "ACTIVE",
    sessionToken: rawToken,
    ...(recoveryCodes ? { recoveryCodes } : {}),
    ...(usedRecoveryCode
      ? { recoveryCodesRemaining: remainingRecoveryHashes.length }
      : {}),
  };
}

export async function getTotpEnrollmentForSession(params: {
  sessionToken: string;
  now?: Date;
  store?: AuthStore;
}): Promise<NonNullable<PasswordStepResult["totpEnrollment"]>> {
  const store = params.store ?? getAuthStore();
  const now = params.now ?? new Date();
  const tokenHash = sha256Hex(params.sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);

  if (!session || session.idleExpiresAt < now || session.absoluteExpiresAt < now) {
    throw new AppError(
      "SESSION_EXPIRED",
      "The sign-in attempt has expired. Please enter the username and password again.",
      401,
    );
  }

  if (session.stage !== "ENROLL_TOTP" && session.stage !== "VERIFY_TOTP") {
    throw new AppError("UNAUTHORIZED", "Invalid session state for TOTP setup.", 401);
  }

  const user = await store.findUserById(session.userId);
  if (!user || !user.totpSecretEncrypted) {
    throw new AppError("TOTP_NOT_INITIALIZED", "TOTP is not configured for this account.", 400);
  }

  const secretBase32 = decryptSecret(user.totpSecretEncrypted);
  const otpauthUri = buildTotpInstance(secretBase32, user.email).toString();

  return {
    secretBase32,
    otpauthUri,
    qrCodeDataUrl: await renderTotpQrCode(otpauthUri),
    accountLabel: user.email,
    issuer: TOTP_ISSUER,
    digits: TOTP_DIGITS,
    periodSeconds: TOTP_PERIOD_SECONDS,
  };
}

export interface AuthenticatedContext {
  user: AuthUserRecord;
  session: AuthSessionRecord;
}

export function extractSessionToken(request: NextRequest | Request): string | null {
  if ("cookies" in request && typeof request.cookies?.get === "function") {
    const cookieVal = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (cookieVal) return cookieVal;
  } else {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const match = cookieHeader
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (match) {
      return decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1));
    }
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export type SessionRejection =
  | { reason: "MISSING" }
  | { reason: "INVALID" }
  | { reason: "EXPIRED" }
  | { reason: "MFA_PENDING"; stage: SessionStage }
  | { reason: "FORBIDDEN" };

export type SessionInspection =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; rejection: SessionRejection };

export interface SessionValidationOptions {
  now?: Date;
  store?: AuthStore;
  /**
   * Slide the idle-expiry window forward on success (default `true`). Passive
   * checks (route guards, tab-focus re-validation) pass `false` so that merely
   * observing a session never keeps it alive; only real user activity does.
   */
  slide?: boolean;
}

/**
 * Non-throwing session validation shared by API routes and the page guard.
 * Expired sessions are purged as a side effect.
 */
export async function inspectDeanSession(
  rawToken: string | null,
  options?: SessionValidationOptions,
): Promise<SessionInspection> {
  if (!rawToken) {
    return { ok: false, rejection: { reason: "MISSING" } };
  }

  const store = options?.store ?? getAuthStore();
  const now = options?.now ?? new Date();
  const tokenHash = sha256Hex(rawToken);
  const [found, policy] = await Promise.all([
    store.findSessionWithUserByTokenHash(tokenHash),
    loadAuthPolicy(),
  ]);

  if (!found) {
    return { ok: false, rejection: { reason: "INVALID" } };
  }
  const { session, user } = found;

  // The idle deadline counts only while automatic sign-out is on (Settings).
  // Pending sign-ins (password done, code not yet) always use theirs.
  const idleApplies = policy.idleTimeoutMs !== null || session.stage !== "ACTIVE";
  if (
    (idleApplies && session.idleExpiresAt.getTime() <= now.getTime()) ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  ) {
    await store.deleteSessionByTokenHash(tokenHash);
    return { ok: false, rejection: { reason: "EXPIRED" } };
  }

  if (session.stage !== "ACTIVE") {
    return {
      ok: false,
      rejection: { reason: "MFA_PENDING", stage: session.stage },
    };
  }

  if (!user || user.role !== "DEAN") {
    return { ok: false, rejection: { reason: "FORBIDDEN" } };
  }

  if (options?.slide === false) {
    return { ok: true, context: { user, session } };
  }

  // Recently extended already: skip the write (see SESSION_TOUCH_INTERVAL_MS).
  if (now.getTime() - session.lastActiveAt.getTime() < SESSION_TOUCH_INTERVAL_MS) {
    return { ok: true, context: { user, session } };
  }

  // Slide idle window forward (capped at absoluteExpiresAt)
  const nextIdle =
    policy.idleTimeoutMs === null
      ? session.absoluteExpiresAt.getTime()
      : Math.min(now.getTime() + policy.idleTimeoutMs, session.absoluteExpiresAt.getTime());
  const updatedSession = await store.updateSession(session.id, {
    lastActiveAt: now,
    idleExpiresAt: new Date(nextIdle),
  });

  return { ok: true, context: { user, session: updatedSession } };
}

function rejectionToAppError(rejection: SessionRejection): AppError {
  switch (rejection.reason) {
    case "MISSING":
      return new AppError(
        "UNAUTHORIZED",
        "Authentication required. Only the Dean may access this resource.",
        401,
      );
    case "INVALID":
      return new AppError(
        "UNAUTHORIZED",
        "Invalid or unknown session token.",
        401,
      );
    case "EXPIRED":
      return new AppError(
        "SESSION_EXPIRED",
        "Session has expired due to inactivity or maximum session lifetime.",
        401,
      );
    case "MFA_PENDING":
      return new AppError(
        "TOTP_REQUIRED",
        "Multi-factor authentication (TOTP) verification is required before accessing data.",
        401,
        { stage: rejection.stage },
      );
    case "FORBIDDEN":
      return new AppError(
        "FORBIDDEN",
        "Only the Dean account may access ORDIQ.",
        403,
      );
  }
}

/**
 * Validates that the caller holds a non-expired ACTIVE Dean session (TOTP verified).
 */
export async function requireDeanSession(
  request: NextRequest | Request,
  options?: SessionValidationOptions,
): Promise<AuthenticatedContext> {
  const result = await inspectDeanSession(
    extractSessionToken(request),
    options,
  );
  if (!result.ok) {
    throw rejectionToAppError(result.rejection);
  }
  return result.context;
}

/**
 * Session cookies are `Secure` in production. `AUTH_COOKIE_SECURE=true|false`
 * overrides this for deployments that terminate TLS elsewhere or that are
 * reached over plain HTTP on a trusted network (browsers silently drop Secure
 * cookies on http:// origins, which would make sign-in appear to do nothing).
 */
export function isSessionCookieSecure(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  return env.NODE_ENV === "production";
}

export function attachSessionCookie(
  response: NextResponse,
  sessionToken: string,
): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: isSessionCookieSecure(),
    sameSite: "lax",
    path: "/",
    // Matches the session lifetime from Settings; the server enforces it anyway.
    maxAge: currentSystemSettings().security.absoluteSessionHours * 60 * 60,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

/**
 * Default route protection wrapper for /api/v1/* data and scheduling routes.
 * Every route wrapped with withAuth rejects unauthenticated or non-TOTP sessions with 401.
 */
export function withAuth<TContext = unknown>(
  handler: (
    request: NextRequest,
    auth: AuthenticatedContext,
    routeContext: TContext,
  ) => Promise<NextResponse>,
): (request: NextRequest, routeContext: TContext) => Promise<NextResponse> {
  return withErrorHandler(
    async (request: NextRequest, routeContext: TContext) => {
      const auth = await requireDeanSession(request);
      return handler(request, auth, routeContext);
    },
  );
}

