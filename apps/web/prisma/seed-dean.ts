/**
 * CLI Seed Command for the single Dean account (Phase 1A).
 * Usage:
 *   pnpm seed:dean                      (create the Dean account if none exists)
 *   pnpm seed:dean -- --reset-password  (set the existing Dean's password to DEAN_SEED_PASSWORD and unlock it)
 *   pnpm seed:dean -- --reset-2fa       (lost authenticator: clear two-factor setup, unlock, sign out all sessions)
 */

import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const username =
    process.env.DEAN_USERNAME ?? process.env.DEAN_SEED_USERNAME ?? "dean";
  const email =
    process.env.DEAN_EMAIL ??
    process.env.DEAN_SEED_EMAIL ??
    "dean@mseuf.edu.ph";
  const password =
    process.env.DEAN_PASSWORD ??
    process.env.DEAN_SEED_PASSWORD ??
    "Password123!";

  if (!password || password.length < 12) {
    throw new Error(
      "DEAN_PASSWORD / DEAN_SEED_PASSWORD (minimum 12 characters) is required to seed the Dean account.",
    );
  }

  const resetPassword = process.argv.includes("--reset-password");
  const reset2fa = process.argv.includes("--reset-2fa");

  const existingCount = await prisma.user.count();
  if (existingCount > 0) {
    const existing = await prisma.user.findFirst();
    if (existing && reset2fa) {
      // Lost or replaced authenticator: clear the TOTP secret and recovery codes,
      // unlock, and sign out every session. The next sign-in shows the QR setup again.
      await prisma.$transaction([
        prisma.user.update({
          where: { id: existing.id },
          data: {
            totpSecretEncrypted: null,
            totpEnrolled: false,
            totpLastUsedStep: null,
            recoveryCodesHashes: [],
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        }),
        prisma.session.deleteMany({ where: { userId: existing.id } }),
        prisma.auditLog.create({
          data: {
            actor: "SYSTEM_SEED",
            action: "DEAN_2FA_RESET",
            entity: "User",
            entityId: existing.id,
            after: { username: existing.username, email: existing.email },
          },
        }),
      ]);
      console.info(
        JSON.stringify({
          event: "dean_2fa_reset",
          userId: existing.id,
          username: existing.username,
        }),
      );
      return;
    }
    if (existing && resetPassword) {
      // Re-hash the configured password onto the existing Dean account and clear any lockout.
      // TOTP enrollment and sessions are left untouched.
      const passwordHash = await hash(password, {
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      await prisma.auditLog.create({
        data: {
          actor: "SYSTEM_SEED",
          action: "DEAN_PASSWORD_RESET",
          entity: "User",
          entityId: existing.id,
          after: { username: existing.username, email: existing.email },
        },
      });
      console.info(
        JSON.stringify({
          event: "dean_password_reset",
          userId: existing.id,
          username: existing.username,
          email: existing.email,
          totpEnrolled: existing.totpEnrolled,
        }),
      );
      return;
    }
    console.info(
      JSON.stringify({
        event: "dean_account_already_exists",
        userId: existing?.id,
        username: existing?.username,
        email: existing?.email,
      }),
    );
    return;
  }

  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const user = await prisma.user.create({
    data: {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      role: "DEAN",
      passwordHash,
      totpSecretEncrypted: null,
      totpEnrolled: false,
      recoveryCodesHashes: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "SYSTEM_SEED",
      action: "DEAN_ACCOUNT_SEEDED",
      entity: "User",
      entityId: user.id,
      after: { username: user.username, email: user.email, role: user.role },
    },
  });

  console.info(
    JSON.stringify({
      event: "dean_account_seeded",
      userId: user.id,
      username: user.username,
      email: user.email,
      totpEnrolled: user.totpEnrolled,
    }),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

