import { DIRECTIVE_TYPES } from "@ordiq/contracts";
import { z } from "zod";
import { withAudit } from "../../platform/audit";
import { AppError } from "../../platform/errors";
import type { ActorContext } from "../master-data/master-data.service";
import { weekdaySchema } from "../master-data/master-data.schema";
import {
  type DirectiveRecord,
  flagSchedulesForRecheck,
  getMasterDataState,
} from "../master-data/master-data.store";

/**
 * Dean directives (D-16): closed set of scheduling rules. HARD directives are
 * enforced by HC-12 only once approved; SOFT ones guide the solver.
 *
 * SET_WEIGHT directives hold the term's soft-objective weights (the constraint
 * code is stored in `offeringCode`); they are managed through
 * `saveSoftWeights`, not the directive list.
 */

const SOFT_CODES = [
  "SC-01", "SC-02", "SC-03", "SC-04", "SC-05", "SC-06", "SC-07", "SC-08",
  "SC-09", "SC-10", "SC-11", "SC-12", "SC-13", "SC-14", "SC-15", "SC-16",
] as const;

const nullableCode = z.string().trim().min(1).max(60).nullable().optional();

export const directiveInputSchema = z
  .object({
    termCode: z.string().min(2).max(40),
    type: z.enum(DIRECTIVE_TYPES as unknown as [string, ...string[]]),
    hardness: z.enum(["HARD", "SOFT"]).default("SOFT"),
    facultyCode: nullableCode,
    sectionCode: nullableCode,
    roomCode: nullableCode,
    offeringCode: nullableCode,
    weekday: weekdaySchema.nullable().optional(),
    startMin: z.number().int().min(0).max(1440).nullable().optional(),
    endMin: z.number().int().min(0).max(1440).nullable().optional(),
    weight: z.number().min(0).max(100).default(1),
  })
  .superRefine((d, ctx) => {
    const need = (field: keyof typeof d, message: string) => {
      if (d[field] === null || d[field] === undefined || d[field] === "") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });
      }
    };
    switch (d.type) {
      case "FACULTY_NOT_ON_DAY":
        need("facultyCode", "Choose the faculty member.");
        need("weekday", "Choose the day.");
        break;
      case "FACULTY_TIME_WINDOW":
        need("facultyCode", "Choose the faculty member.");
        need("startMin", "Set the start of the allowed window.");
        need("endMin", "Set the end of the allowed window.");
        break;
      case "SECTION_TIME_WINDOW":
        need("sectionCode", "Choose the section.");
        need("startMin", "Set the start of the allowed window.");
        need("endMin", "Set the end of the allowed window.");
        break;
      case "AVOID_ROOM":
        need("roomCode", "Choose the room.");
        break;
      case "REQUIRE_ROOM":
        need("offeringCode", "Choose the offering.");
        need("roomCode", "Choose the room.");
        break;
      case "ASSIGN_FACULTY":
        need("offeringCode", "Choose the offering.");
        need("facultyCode", "Choose the faculty member.");
        break;
      case "PIN_MEETING":
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["type"],
          message: "Pin meetings from the schedule workspace instead.",
        });
        break;
      case "SET_WEIGHT":
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["type"],
          message: "Soft-objective weights are set on the weights tab.",
        });
        break;
    }
    if (d.startMin != null && d.endMin != null && d.endMin <= d.startMin) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endMin"], message: "End must be after start." });
    }
  });

export type DirectiveInput = z.input<typeof directiveInputSchema>;

function checkReferences(d: z.infer<typeof directiveInputSchema>): void {
  const s = getMasterDataState();
  const missing = (label: string, code: string) =>
    new AppError("REFERENCE_NOT_FOUND", `${label} ${code} not found.`, 400, {
      issues: [{ path: [label === "Term" ? "termCode" : `${label.toLowerCase()}Code`], message: `${label} ${code} not found.` }],
    });
  if (!s.terms.has(d.termCode)) throw missing("Term", d.termCode);
  if (d.facultyCode && !s.faculty.has(d.facultyCode)) throw missing("Faculty", d.facultyCode);
  if (d.sectionCode && !s.sections.has(d.sectionCode)) throw missing("Section", d.sectionCode);
  if (d.roomCode && !s.rooms.has(d.roomCode)) throw missing("Room", d.roomCode);
  if (d.offeringCode && !s.offerings.has(d.offeringCode)) throw missing("Offering", d.offeringCode);
}

function requireDirective(id: string): DirectiveRecord {
  const record = getMasterDataState().directives.get(id);
  if (!record || record.type === "SET_WEIGHT") {
    throw new AppError("DIRECTIVE_NOT_FOUND", "Directive not found.", 404);
  }
  return record;
}

export function listDirectives(termCode?: string): DirectiveRecord[] {
  return Array.from(getMasterDataState().directives.values())
    .filter((d) => d.type !== "SET_WEIGHT" && (!termCode || d.termCode === termCode))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Create or edit a directive. Any edit clears the approval: a changed rule has
 * to be approved again before HC-12 enforces it.
 */
export async function saveDirective(
  raw: DirectiveInput,
  ctx: ActorContext,
  id?: string,
): Promise<DirectiveRecord> {
  const input = directiveInputSchema.parse(raw);
  checkReferences(input);
  const store = getMasterDataState();
  const existing = id ? requireDirective(id) : null;
  const recordId = existing?.id ?? `DIR-${crypto.randomUUID().slice(0, 8)}`;

  return withAudit(
    {
      actor: ctx.actor,
      action: existing ? "DIRECTIVE_UPDATED" : "DIRECTIVE_CREATED",
      entity: "Constraint",
      entityId: recordId,
      before: existing ?? null,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record: DirectiveRecord = {
        id: recordId,
        termCode: input.termCode,
        type: input.type as DirectiveRecord["type"],
        hardness: input.hardness,
        approved: false,
        facultyCode: input.facultyCode ?? null,
        sectionCode: input.sectionCode ?? null,
        roomCode: input.roomCode ?? null,
        offeringCode: input.offeringCode ?? null,
        weekday: input.weekday ?? null,
        startMin: input.startMin ?? null,
        endMin: input.endMin ?? null,
        weight: input.weight,
        createdBy: existing?.createdBy ?? ctx.actor,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      store.directives.set(record.id, record);
      if (existing?.approved) flagSchedulesForRecheck(record.termCode);
      return record;
    },
  );
}

export async function setDirectiveApproval(
  id: string,
  approved: boolean,
  ctx: ActorContext,
): Promise<DirectiveRecord> {
  const existing = requireDirective(id);
  return withAudit(
    {
      actor: ctx.actor,
      action: approved ? "DIRECTIVE_APPROVED" : "DIRECTIVE_APPROVAL_REVOKED",
      entity: "Constraint",
      entityId: id,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const record = { ...existing, approved };
      getMasterDataState().directives.set(id, record);
      flagSchedulesForRecheck(record.termCode);
      return record;
    },
  );
}

export async function deleteDirective(id: string, ctx: ActorContext): Promise<void> {
  const existing = requireDirective(id);
  await withAudit(
    {
      actor: ctx.actor,
      action: "DIRECTIVE_DELETED",
      entity: "Constraint",
      entityId: id,
      before: existing,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      getMasterDataState().directives.delete(id);
      if (existing.approved) flagSchedulesForRecheck(existing.termCode);
    },
  );
}

// ---------------------------------------------------------------------------
// Soft-objective weights (stored as SET_WEIGHT directives per term)
// ---------------------------------------------------------------------------

export const softWeightsInputSchema = z.object({
  termCode: z.string().min(2).max(40),
  weights: z.record(z.enum(SOFT_CODES), z.number().min(0).max(100)),
});

export function getSoftWeightOverrides(termCode: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of getMasterDataState().directives.values()) {
    if (d.type === "SET_WEIGHT" && d.termCode === termCode && d.offeringCode) {
      out[d.offeringCode] = d.weight;
    }
  }
  return out;
}

/** Replace the term's weight overrides; a weight equal to the default is dropped. */
export async function saveSoftWeights(
  raw: unknown,
  defaults: Record<string, number>,
  ctx: ActorContext,
): Promise<Record<string, number>> {
  const input = softWeightsInputSchema.parse(raw);
  if (!getMasterDataState().terms.has(input.termCode)) {
    throw new AppError("TERM_NOT_FOUND", `Term ${input.termCode} not found.`, 400);
  }
  const before = getSoftWeightOverrides(input.termCode);
  return withAudit(
    {
      actor: ctx.actor,
      action: "SOFT_WEIGHTS_UPDATED",
      entity: "Term",
      entityId: input.termCode,
      before,
      ipAddress: ctx.ipAddress ?? null,
    },
    async () => {
      const store = getMasterDataState();
      for (const [id, d] of store.directives) {
        if (d.type === "SET_WEIGHT" && d.termCode === input.termCode) store.directives.delete(id);
      }
      const now = new Date().toISOString();
      for (const [code, weight] of Object.entries(input.weights)) {
        if (defaults[code] !== undefined && Math.abs(defaults[code] - weight) < 1e-9) continue;
        const id = `WGT-${input.termCode}-${code}`;
        store.directives.set(id, {
          id,
          termCode: input.termCode,
          type: "SET_WEIGHT",
          hardness: "SOFT",
          approved: true,
          facultyCode: null,
          sectionCode: null,
          roomCode: null,
          offeringCode: code,
          weekday: null,
          startMin: null,
          endMin: null,
          weight,
          createdBy: ctx.actor,
          createdAt: now,
        });
      }
      flagSchedulesForRecheck(input.termCode);
      return getSoftWeightOverrides(input.termCode);
    },
  );
}
