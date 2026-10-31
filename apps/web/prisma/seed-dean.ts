/**
 * CLI Seed Command for the single Dean account (Phase 1A).
 * Usage:
 *   DEAN_USERNAME=dean DEAN_EMAIL=dean.cet@mseuf.edu.ph DEAN_PASSWORD=... node --experimental-strip-types prisma/seed-dean.ts
 */

import { seedSingleDeanAccount } from "../src/server/platform/auth";
import { prismaAuthStore } from "../src/server/platform/auth.prisma-store";
import { prisma } from "../src/server/platform/db";

async function main(): Promise<void> {
  const username = process.env.DEAN_USERNAME ?? "dean";
  const email = process.env.DEAN_EMAIL ?? "dean.cet@mseuf.edu.ph";
  const password = process.env.DEAN_PASSWORD;

  if (!password || password.length < 12) {
    throw new Error(
      "DEAN_PASSWORD environment variable (minimum 12 characters) is required to seed the Dean account.",
    );
  }

  const { user } = await seedSingleDeanAccount({
    username,
    email,
    password,
    store: prismaAuthStore,
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

