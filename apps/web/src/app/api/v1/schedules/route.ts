import {
  HARD_CONSTRAINT_CODES,
  WEEKDAYS,
  type HardConstraintCode,
} from "@ordiq/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getMasterDataState } from "../../../../server/modules/master-data/master-data.store";
import {
  acceptCandidateSchedule,
  addScheduleException,
  compareCandidateSchedules,
  createRevisionFromAccepted,
  editScheduleEntry,
  getMeetingAlternatives,
  undoLastScheduleChange,
} from "../../../../server/modules/schedules/schedules.service";
import { withAuth } from "../../../../server/platform/auth";
import { toErrorResponse } from "../../../../server/platform/errors";

const hardCodeEnum = z.enum(
  HARD_CONSTRAINT_CODES as unknown as [
    HardConstraintCode,
    ...HardConstraintCode[],
  ],
);

const scheduleActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit_entry"),
    scheduleId: z.string().min(1),
    entryId: z.string().min(1),
    expectedVersion: z.number().int().min(1),
    facultyCode: z.string().optional(),
    roomCode: z.string().optional(),
    weekday: z.enum(WEEKDAYS).optional(),
    startMin: z.number().int().min(0).max(1440).optional(),
    endMin: z.number().int().min(0).max(1440).optional(),
    pinned: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("undo"),
    scheduleId: z.string().min(1),
  }),
  z.object({
    action: z.literal("add_exception"),
    scheduleId: z.string().min(1),
    code: hardCodeEnum,
    offeringCode: z.string().nullable().optional(),
    facultyCode: z.string().nullable().optional(),
    roomCode: z.string().nullable().optional(),
    sectionCode: z.string().nullable().optional(),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal("accept"),
    scheduleId: z.string().min(1),
  }),
  z.object({
    action: z.literal("create_revision"),
    scheduleId: z.string().min(1),
  }),
  z.object({
    action: z.literal("compare"),
    scheduleIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    action: z.literal("alternatives"),
    scheduleId: z.string().min(1),
    offeringCode: z.string().min(1),
    meetingIndex: z.number().int().min(0).default(0),
  }),
]);

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const termCode = searchParams.get("termCode") ?? "AY2026-2027-S1";
  const scheduleId = searchParams.get("scheduleId");
  const store = getMasterDataState();

  if (scheduleId) {
    const sched = store.schedules.get(scheduleId);
    if (!sched) {
      return NextResponse.json(
        {
          error: {
            code: "SCHEDULE_NOT_FOUND",
            message: `Schedule "${scheduleId}" not found.`,
            details: {},
          },
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ schedule: sched }, { status: 200 });
  }

  const schedules = Array.from(store.schedules.values()).filter(
    (s) => s.termCode === termCode,
  );
  return NextResponse.json({ schedules }, { status: 200 });
});

export const POST = withAuth(async (request, { user }) => {
  try {
    const body = await request.json();
    const parsed = scheduleActionSchema.parse(body);

    switch (parsed.action) {
      case "edit_entry": {
        const res = await editScheduleEntry({
          ...parsed,
          actor: user.username,
        });
        return NextResponse.json(res, { status: 200 });
      }
      case "undo": {
        const res = await undoLastScheduleChange(parsed.scheduleId, {
          actor: user.username,
        });
        return NextResponse.json(res, { status: 200 });
      }
      case "add_exception": {
        const res = await addScheduleException({
          ...parsed,
          actor: user.username,
        });
        return NextResponse.json(res, { status: 201 });
      }
      case "accept": {
        const res = await acceptCandidateSchedule(parsed.scheduleId, {
          actor: user.username,
        });
        return NextResponse.json({ schedule: res }, { status: 200 });
      }
      case "create_revision": {
        const res = await createRevisionFromAccepted(parsed.scheduleId, {
          actor: user.username,
        });
        return NextResponse.json({ schedule: res }, { status: 201 });
      }
      case "compare": {
        const comparison = compareCandidateSchedules(parsed.scheduleIds);
        return NextResponse.json({ comparison }, { status: 200 });
      }
      case "alternatives": {
        const alternatives = await getMeetingAlternatives(
          parsed.scheduleId,
          parsed.offeringCode,
          parsed.meetingIndex,
        );
        return NextResponse.json(alternatives, { status: 200 });
      }
    }
  } catch (error) {
    return toErrorResponse(error);
  }
});
