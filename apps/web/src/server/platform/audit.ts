import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { logger } from "./logger";

export interface AuditInput {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

export interface AuditRecord extends AuditInput {
  id: string;
  createdAt: Date;
}

export interface AuditSink {
  write(input: AuditInput): Promise<AuditRecord>;
}

function toJsonValue(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const prismaAuditSink: AuditSink = {
  async write(input: AuditInput): Promise<AuditRecord> {
    const created = await prisma.auditLog.create({
      data: {
        actor: input.actor,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: toJsonValue(input.before),
        after: toJsonValue(input.after),
        ipAddress: input.ipAddress ?? null,
      },
    });
    return {
      id: created.id,
      actor: created.actor,
      action: created.action,
      entity: created.entity,
      entityId: created.entityId,
      before: created.before,
      after: created.after,
      ipAddress: created.ipAddress,
      createdAt: created.createdAt,
    };
  },
};

/**
 * The automated test suite never writes to the real audit_logs table: under
 * NODE_ENV=test the default sink only returns the record. The running app
 * (development and production) always writes to PostgreSQL.
 */
const testAuditSink: AuditSink = {
  async write(input: AuditInput): Promise<AuditRecord> {
    return { ...input, id: crypto.randomUUID(), createdAt: new Date() };
  },
};

const defaultAuditSink: AuditSink =
  process.env.NODE_ENV === "test" ? testAuditSink : prismaAuditSink;

let activeAuditSink: AuditSink = defaultAuditSink;

export function setAuditSinkForTests(sink: AuditSink | null): void {
  activeAuditSink = sink ?? defaultAuditSink;
}

/**
 * Append-only audit log writer.
 * Every mutation across ORDIQ must write an audit entry (Definition of Done).
 */
export async function recordAudit(input: AuditInput): Promise<AuditRecord> {
  const entry = await activeAuditSink.write(input);
  logger.info("audit_recorded", {
    auditId: entry.id,
    actor: entry.actor,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
  });
  return entry;
}

/**
 * Wraps a mutation operation and guarantees an append-only audit log entry is written.
 */
export async function withAudit<TResult>(
  meta: Omit<AuditInput, "after"> & {
    extractEntityId?: (result: TResult) => string;
    extractAfter?: (result: TResult) => unknown;
  },
  operation: () => Promise<TResult>,
): Promise<TResult> {
  const result = await operation();
  const entityId = meta.extractEntityId
    ? meta.extractEntityId(result)
    : meta.entityId;
  const after = meta.extractAfter ? meta.extractAfter(result) : result;

  await recordAudit({
    actor: meta.actor,
    action: meta.action,
    entity: meta.entity,
    entityId,
    before: meta.before,
    after,
    ipAddress: meta.ipAddress ?? null,
  });

  return result;
}

