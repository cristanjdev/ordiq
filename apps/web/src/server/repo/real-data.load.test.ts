import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, it } from "vitest";
import { checkExistingSchedule } from "../modules/generation/generation.service";
import { importWorkbookPayload, parseWorkbookBuffer } from "../modules/imports/imports.service";
import {
  createEmptyMasterDataState,
  getMasterDataState,
  replaceMasterDataState,
} from "../modules/master-data/master-data.store";
import { type AuditInput, recordAudit, setAuditSinkForTests } from "../platform/audit";
import { logger } from "../platform/logger";
import { applyChanges, claimNextVersion, diffState, loadState } from "./state.repository";

/**
 * Replaces all domain data with the college's real data (development / staging tool).
 *
 * Reads the current database, starts from an empty domain state and imports the
 * converted college workbook through the real import service, then saves the
 * difference in one transaction: every seeded record is deleted and the real
 * data is inserted.
 *
 * Kept as they are: user accounts and sessions, the audit log (append-only; one
 * entry records what was removed), LLM usage records (real spend against the
 * monthly budget) and the term's settings.
 *
 * Run from apps/web:
 *   pnpm load:real-data                     dry run: reports what would change, writes nothing
 *   pnpm load:real-data --apply             deletes the seeded data and saves the real data
 *   pnpm load:real-data --file <path.xlsx>  use another converted workbook
 */
const enabled = process.env.ORDIQ_LOAD_REAL_DATA === "1";
const apply = process.env.ORDIQ_LOAD_APPLY === "1";
const DEAN = "dean@mseuf.edu.ph";
const TERM = "AY2026-2027-S1";

type Audit = AuditInput & { createdAt: Date };

describe.skipIf(!enabled)("load the college's real data into PostgreSQL", () => {
  const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
  url.searchParams.set("connection_limit", "4");
  url.searchParams.set("pool_timeout", "30");
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const audits: Audit[] = [];

  afterAll(async () => {
    setAuditSinkForTests(null);
    await prisma.$disconnect();
  });

  it(apply ? "replaces the seeded data with the real data" : "reports what loading the real data would change", async () => {
    setAuditSinkForTests({
      async write(input) {
        const createdAt = new Date();
        audits.push({ ...input, createdAt });
        return { ...input, id: crypto.randomUUID(), createdAt };
      },
    });

    const file = path.resolve(
      process.env.ORDIQ_REAL_WORKBOOK ?? path.join(process.cwd(), "../../docs/client/real-data/ordiq-import-AY2026-2027-S1.xlsx"),
    );
    if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}. Nothing was written.`);

    const before = await loadState(prisma);

    // Start from an empty domain state, keeping the term settings, LLM usage and alias counter.
    const next = createEmptyMasterDataState();
    const existingTerm = before.state.terms.get(TERM);
    if (existingTerm) next.terms = new Map([[TERM, existingTerm]]);
    next.llmUsage = before.state.llmUsage;
    next.aliasCounter = before.state.aliasCounter;
    replaceMasterDataState(next);

    const payload = await parseWorkbookBuffer(fs.readFileSync(file), TERM);
    const result = await importWorkbookPayload(payload, { actor: DEAN });
    if (result.status !== "COMMITTED") {
      throw new Error(
        `The workbook has ${result.errors.length} error(s); nothing was written. First: ${JSON.stringify(result.errors.slice(0, 5))}`,
      );
    }

    // Check the imported schedule now when the engine is reachable; otherwise the
    // Dean runs "Check schedule" in the app later.
    const imported = [...getMasterDataState().schedules.values()].find((s) => s.source === "IMPORTED");
    let check = "skipped";
    if (imported) {
      try {
        const { validation } = await checkExistingSchedule(imported.id, { actor: DEAN });
        check = `${validation.hard_violation_count} unresolved conflict(s)`;
      } catch (error) {
        check = `not run (${error instanceof Error ? error.message : String(error)}); use Check schedule in the app`;
      }
    }

    const changes = diffState(before.snapshot, getMasterDataState(), before.aliasCounter);
    const removed = Object.fromEntries(
      [...changes.deletes].filter(([, ids]) => ids.length > 0).map(([name, ids]) => [name, ids.length]),
    );
    const plan = {
      mode: apply ? "APPLY" : "DRY RUN (nothing written)",
      workbook: path.basename(file),
      recordsDeleted: removed,
      importedRows: result.countsBySheet,
      changedRecords: changes.count,
      collegeScheduleCheck: check,
    };
    // Printed for the person running the command (no names, counts only).
    console.log(`\nLOAD REAL DATA\n${JSON.stringify(plan, null, 2)}\n`);
    if (!apply) return;

    await recordAudit({
      actor: DEAN,
      action: "SEED_DATA_REPLACED_WITH_REAL_DATA",
      entity: "SystemState",
      entityId: TERM,
      before: removed,
      after: { workbook: path.basename(file), importedRows: result.countsBySheet },
    });

    await prisma.$transaction(
      async (tx) => {
        const claimed = await claimNextVersion(tx, before.version, changes.aliasCounter);
        if (!claimed) throw new Error("The database changed while loading. Nothing was written.");
        await applyChanges(tx, changes);
        const json = (value: unknown) =>
          value === undefined || value === null ? undefined : JSON.parse(JSON.stringify(value));
        await tx.auditLog.createMany({
          data: audits.map((a) => ({
            actor: a.actor,
            action: a.action,
            entity: a.entity,
            entityId: a.entityId,
            before: json(a.before),
            after: json(a.after),
            ipAddress: null,
            createdAt: a.createdAt,
          })),
        });
      },
      { maxWait: 20_000, timeout: 300_000 },
    );
    logger.info("real_data_loaded", { records: changes.count, audits: audits.length });
  }, 15 * 60_000);
});
