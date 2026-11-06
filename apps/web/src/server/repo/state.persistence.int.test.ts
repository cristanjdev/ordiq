import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "../platform/audit";
import {
  generateSmallFixture,
  loadFixtureIntoStore,
} from "../modules/fixtures/fixture.generator";
import { getMasterDataState } from "../modules/master-data/master-data.store";
import { applyChanges, diffState, loadState, takeSnapshot } from "./state.repository";

/**
 * Round trip against a real PostgreSQL database: save the small fixture,
 * load it back, and require an identical state. Everything runs inside one
 * transaction that is rolled back, so the database is left exactly as found.
 *
 * Run from apps/web:
 *   ORDIQ_DB_TEST=1 node --env-file=.env node_modules/vitest/vitest.mjs run src/server/repo/state.persistence.int.test.ts
 */
const enabled = process.env.ORDIQ_DB_TEST === "1";
const ROLLBACK = "ORDIQ_ROLLBACK";

describe.skipIf(!enabled)("state repository round trip (PostgreSQL)", () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
  });

  afterAll(async () => {
    setAuditSinkForTests(null);
    await prisma.$disconnect();
  });

  it("saves and reloads every collection without loss, then rolls back", async () => {
    // Keep audit rows out of the database too.
    setAuditSinkForTests({
      write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }),
    });

    let verified = false;
    await expect(
      prisma.$transaction(
        async (tx) => {
          // Whatever the database holds now is replaced by the fixture inside
          // this transaction, then restored by the rollback.
          const before = await loadState(tx);
          await loadFixtureIntoStore(generateSmallFixture(), { actor: "db-test" });
          const state = getMasterDataState();
          const changes = diffState(before.snapshot, state, before.aliasCounter);
          expect(changes.count).toBeGreaterThan(0);
          await applyChanges(tx, changes);

          const after = await loadState(tx);
          const expected = takeSnapshot(state);
          for (const [name, prints] of expected) {
            expect(after.snapshot.get(name), name).toEqual(prints);
          }
          verified = true;
          throw new Error(ROLLBACK);
        },
        { maxWait: 10_000, timeout: 120_000 },
      ),
    ).rejects.toThrow(ROLLBACK);
    expect(verified).toBe(true);
  }, 180_000);
});
