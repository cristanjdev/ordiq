import { hash, verify } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import * as OTPAuth from "otpauth";
import { recordAudit } from "./audit";
import {
  decryptSecret,
  encryptSecret,
  generateOpaqueToken,
  generateRecoveryCodes,
  sha256Hex,
} from "./crypto";
import { AppError, withErrorHandler } from "./errors";

export const SESSION_COOKIE_NAME = "ordiq_session";
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle timeout
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours absolute timeout
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes lockout

export type SessionStage = "ENROLL_TOTP" | "VERIFY_TOTP" | "ACTIVE";

export interface AuthUserRecord {
  id: string;
  username: string;
  email: string;
  role: "DEAN";
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnrolled: boolean;
  recoveryCodesHashes: string[];
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
  updateSession(
    id: string,
    patch: Partial<Omit<AuthSessionRecord, "id" | "createdAt">>,
  ): Promise<AuthSessionRecord>;
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;
}

/**
 * Default in-memory fallback store used in isolated unit/route tests when DB is not attached;
 * production and integration tests can wire Prisma or custom stores via setAuthStore.
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
  };
}

let activeAuthStore: AuthStore = createInMemoryAuthStore();

export function getAuthStore(): AuthStore {
  return activeAuthStore;
}

export function setAuthStore(store: AuthStore): void {
  activeAuthStore = store;
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

export function buildTotpInstance(
  base32Secret: string,
  accountLabel: string,
): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: "ORDIQ (MSEUF Engineering)",
    label: accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
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
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }
  const totp = buildTotpInstance(base32Secret, "dean@mseuf.edu.ph");
  const delta = totp.validate({
    token: normalized,
     timestamp: timestampMs,
    window: 1,
  });
  return delta !== null;
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

export interface PasswordStepResult {
  sessionToken: string;
  stage: "ENROLL_TOTP" | "VERIFY_TOTP";
  totpEnrollment?: {
    secretBase32: string;
    otpauthUri: string;
  };
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
    const attempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_LOGIN_ATTEMPTS
        ? new Date(now.getTime() + LOCKOUT_DURATION_MS)
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

  // Password succeeded: reset failedLoginAttempts
  let totpEnrollment: PasswordStepResult["totpEnrollment"];
  let stage: "ENROLL_TOTP" | "VERIFY_TOTP" = "VERIFY_TOTP";
  let totpSecretEncrypted = user.totpSecretEncrypted;

  if (!user.totpEnrolled || !totpSecretEncrypted) {
    stage = "ENROLL_TOTP";
    const secretBase32 = generateTotpSecretBase32();
    totpSecretEncrypted = encryptSecret(secretBase32);
    const totp = buildTotpInstance(secretBase32, user.email);
    totpEnrollment = {
      secretBase32,
      otpauthUri: totp.toString(),
    };
  }

  await store.updateUser(user.id, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    totpSecretEncrypted,
  });

  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);

  await store.createSession({
    userId: user.id,
    tokenHash,
    stage,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    lastActiveAt: now,
    idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
    absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
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
  recoveryCodes?: string[];
}

/**
 * Step 2 of login: verifies TOTP code (or single-use recovery code) and upgrades
 * the session to ACTIVE.
 */
export async function loginStep2Totp(params: {
  sessionToken: string;
  code: string;
  ipAddress?: string | null;
  now?: Date;
  store?: AuthStore;
}): Promise<TotpStepResult> {
  const store = params.store ?? getAuthStore();
  const now = params.now ?? new Date();
  const tokenHash = sha256Hex(params.sessionToken);
  const session = await store.findSessionByTokenHash(tokenHash);

  if (
    !session ||
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  ) {
    throw new AppError(
      "SESSION_EXPIRED",
      "Your login session has expired. Please sign in again.",
      401,
    );
  }

  const user = await store.findUserById(session.userId);
  if (!user || !user.totpSecretEncrypted) {
    throw new AppError(
      "TOTP_NOT_INITIALIZED",
      "TOTP secret is not initialized for this account.",
      400,
    );
  }

  const secretBase32 = decryptSecret(user.totpSecretEncrypted);
  const trimmedCode = params.code.trim().toUpperCase();

  let verified = verifyTotpCode(secretBase32, trimmedCode, now.getTime());
  let usedRecoveryCode = false;

  if (!verified && user.totpEnrolled && trimmedCode.startsWith("ORDQ-")) {
    const candidateHash = sha256Hex(trimmedCode);
    const idx = user.recoveryCodesHashes.indexOf(candidateHash);
    if (idx !== -1) {
      verified = true;
      usedRecoveryCode = true;
      const remaining = user.recoveryCodesHashes.filter((_, i) => i !== idx);
      await store.updateUser(user.id, {
        recoveryCodesHashes: remaining,
      });
    }
  }

  if (!verified) {
    await recordAudit({
      actor: user.username,
      action: "LOGIN_TOTP_FAILED",
      entity: "User",
      entityId: user.id,
      ipAddress: params.ipAddress ?? null,
    });
    throw new AppError(
      "INVALID_TOTP_CODE",
      "Invalid authenticator or recovery code.",
      401,
    );
  }

  let recoveryCodes: string[] | undefined;
  if (session.stage === "ENROLL_TOTP" || !user.totpEnrolled) {
    recoveryCodes = generateRecoveryCodes(8);
    const recoveryCodesHashes = recoveryCodes.map((c) => sha256Hex(c));
    await store.updateUser(user.id, {
      totpEnrolled: true,
      recoveryCodesHashes,
    });
  }

  await store.updateSession(session.id, {
    stage: "ACTIVE",
    lastActiveAt: now,
    idleExpiresAt: new Date(now.getTime() + IDLE_TIMEOUT_MS),
  });

  await recordAudit({
    actor: user.username,
    action: usedRecoveryCode
      ? "LOGIN_RECOVERY_CODE_USED"
      : "LOGIN_TOTP_VERIFIED",
    entity: "Session",
    entityId: session.id,
    ipAddress: params.ipAddress ?? null,
  });

  return {
    stage: "ACTIVE",
    ...(recoveryCodes ? { recoveryCodes } : {}),
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

/**
 * Validates that the caller holds a non-expired ACTIVE Dean session (TOTP verified).
 */
export async function requireDeanSession(
  request: NextRequest | Request,
  options?: { now?: Date; store?: AuthStore },
): Promise<AuthenticatedContext> {
  const rawToken = extractSessionToken(request);
  if (!rawToken) {
    throw new AppError(
      "UNAUTHORIZED",
      "Authentication required. Only the Dean may access this resource.",
      401,
    );
  }

  const store = options?.store ?? getAuthStore();
  const now = options?.now ?? new Date();
  const tokenHash = sha256Hex(rawToken);
  const session = await store.findSessionByTokenHash(tokenHash);

  if (!session) {
    throw new AppError(
      "UNAUTHORIZED",
      "Invalid or unknown session token.",
      401,
    );
  }

  if (
    session.idleExpiresAt.getTime() <= now.getTime() ||
    session.absoluteExpiresAt.getTime() <= now.getTime()
  ) {
    await store.deleteSessionByTokenHash(tokenHash);
    throw new AppError(
      "SESSION_EXPIRED",
      "Session has expired due to inactivity or maximum session lifetime.",
      401,
    );
  }

  if (session.stage !== "ACTIVE") {
    throw new AppError(
      "TOTP_REQUIRED",
      "Multi-factor authentication (TOTP) verification is required before accessing data.",
      401,
      { stage: session.stage },
    );
  }

  const user = await store.findUserById(session.userId);
  if (!user || user.role !== "DEAN") {
    throw new AppError(
      "FORBIDDEN",
      "Only the Dean account may access ORDIQ.",
      403,
    );
  }

  // Slide idle window forward (capped at absoluteExpiresAt)
  const nextIdle = Math.min(
    now.getTime() + IDLE_TIMEOUT_MS,
    session.absoluteExpiresAt.getTime(),
  );
  const updatedSession = await store.updateSession(session.id, {
    lastActiveAt: now,
    idleExpiresAt: new Date(nextIdle),
  });

  return { user, session: updatedSession };
}

export function attachSessionCookie(
  response: NextResponse,
  sessionToken: string,
): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ABSOLUTE_TIMEOUT_MS / 1000),
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

