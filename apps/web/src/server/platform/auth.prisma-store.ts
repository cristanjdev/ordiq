import type { AuthSessionRecord, AuthStore, AuthUserRecord, SessionStage } from "./auth";
import { prisma } from "./db";
import { AppError } from "./errors";

function mapUser(u: {
  id: string;
  username: string;
  email: string;
  role: string;
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnrolled: boolean;
  recoveryCodesHashes: unknown;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
}): AuthUserRecord {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: "DEAN",
    passwordHash: u.passwordHash,
    totpSecretEncrypted: u.totpSecretEncrypted,
    totpEnrolled: u.totpEnrolled,
    recoveryCodesHashes: Array.isArray(u.recoveryCodesHashes)
      ? (u.recoveryCodesHashes as string[])
      : [],
    failedLoginAttempts: u.failedLoginAttempts,
    lockedUntil: u.lockedUntil,
  };
}

function mapSession(s: {
  id: string;
  userId: string;
  tokenHash: string;
  stage: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
}): AuthSessionRecord {
  return {
    id: s.id,
    userId: s.userId,
    tokenHash: s.tokenHash,
    stage: s.stage as SessionStage,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastActiveAt: s.lastActiveAt,
    idleExpiresAt: s.idleExpiresAt,
    absoluteExpiresAt: s.absoluteExpiresAt,
    createdAt: s.createdAt,
  };
}

export const prismaAuthStore: AuthStore = {
  async countUsers() {
    return prisma.user.count();
  },
  async findUserByUsernameOrEmail(identifier) {
    const normalized = identifier.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: identifier.trim(), mode: "insensitive" } },
          { email: { equals: normalized, mode: "insensitive" } },
        ],
      },
    });
    return user ? mapUser(user) : null;
  },
  async findUserById(id) {
    const user = await prisma.user.findUnique({ where: { id } });
    return user ? mapUser(user) : null;
  },
  async createUser(data) {
    const count = await prisma.user.count();
    if (count >= 1) {
      throw new AppError(
        "DEAN_ACCOUNT_ALREADY_EXISTS",
        "ORDIQ allows only a single Dean account.",
        409,
      );
    }
    const created = await prisma.user.create({
      data: {
        username: data.username,
        email: data.email,
        role: "DEAN",
        passwordHash: data.passwordHash,
        totpSecretEncrypted: data.totpSecretEncrypted,
        totpEnrolled: data.totpEnrolled,
        recoveryCodesHashes: data.recoveryCodesHashes,
        failedLoginAttempts: data.failedLoginAttempts,
        lockedUntil: data.lockedUntil,
      },
    });
    return mapUser(created);
  },
  async updateUser(id, patch) {
    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.passwordHash !== undefined
          ? { passwordHash: patch.passwordHash }
          : {}),
        ...(patch.totpSecretEncrypted !== undefined
          ? { totpSecretEncrypted: patch.totpSecretEncrypted }
          : {}),
        ...(patch.totpEnrolled !== undefined
          ? { totpEnrolled: patch.totpEnrolled }
          : {}),
        ...(patch.recoveryCodesHashes !== undefined
          ? { recoveryCodesHashes: patch.recoveryCodesHashes }
          : {}),
        ...(patch.failedLoginAttempts !== undefined
          ? { failedLoginAttempts: patch.failedLoginAttempts }
          : {}),
        ...(patch.lockedUntil !== undefined
          ? { lockedUntil: patch.lockedUntil }
          : {}),
      },
    });
    return mapUser(updated);
  },
  async createSession(data) {
    const created = await prisma.session.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        stage: data.stage,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        lastActiveAt: data.lastActiveAt,
        idleExpiresAt: data.idleExpiresAt,
        absoluteExpiresAt: data.absoluteExpiresAt,
      },
    });
    return mapSession(created);
  },
  async findSessionByTokenHash(tokenHash) {
    const found = await prisma.session.findUnique({ where: { tokenHash } });
    return found ? mapSession(found) : null;
  },
  async updateSession(id, patch) {
    const updated = await prisma.session.update({
      where: { id },
      data: {
        ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        ...(patch.lastActiveAt !== undefined
          ? { lastActiveAt: patch.lastActiveAt }
          : {}),
        ...(patch.idleExpiresAt !== undefined
          ? { idleExpiresAt: patch.idleExpiresAt }
          : {}),
      },
    });
    return mapSession(updated);
  },
  async deleteSessionByTokenHash(tokenHash) {
    await prisma.session.deleteMany({ where: { tokenHash } });
  },
};

