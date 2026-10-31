import {
  EMPLOYMENT_TYPES,
  ROOM_TYPES,
  WEEKDAYS,
} from "@ordiq/contracts";
import { z } from "zod";

export const weekdaySchema = z.enum(WEEKDAYS);
export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export const roomTypeSchema = z.enum(ROOM_TYPES);

export const termInputSchema = z
  .object({
    code: z.string().min(2).max(40),
    academicYear: z
      .string()
      .regex(/^\d{4}-\d{4}$/, "Academic year must match YYYY-YYYY"),
    semester: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["DRAFT", "READY", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
    slotSizeMin: z.number().int().min(15).max(120).default(30),
    teachingDays: z.array(weekdaySchema).min(1).default([...WEEKDAYS]),
    dayStartMin: z.number().int().min(0).max(1440).default(450), // 07:30
    dayEndMin: z.number().int().min(0).max(1440).default(1230), // 20:30
  })
  .refine((t) => t.dayEndMin > t.dayStartMin, {
    message: "dayEndMin must be greater than dayStartMin",
    path: ["dayEndMin"],
  });

export type TermInput = z.infer<typeof termInputSchema>;

export const programInputSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2).max(120),
  coordinator: z.string().min(2).max(120),
});

export type ProgramInput = z.infer<typeof programInputSchema>;

export const facultyInputSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(2).max(120),
  programCode: z.string().min(2).max(20).nullable().optional(),
  employmentType: employmentTypeSchema,
  specialization: z.string().min(2).max(160),
  education: z.string().min(2).max(160),
  maxLoadUnits: z.number().int().min(1).max(36).default(21),
  maxLoadHours: z.number().int().min(1).max(48).default(24),
  status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]).default("ACTIVE"),
});

export type FacultyInput = z.infer<typeof facultyInputSchema>;

export const subjectCategorySchema = z.enum([
  "MAJOR",
  "GENERAL_ENGINEERING",
  "MATHEMATICS",
  "SCIENCE",
  "GENERAL_EDUCATION",
  "PATHFIT",
]);

export const subjectInputSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(2).max(160),
  description: z.string().max(500).default(""),
  programCode: z.string().min(2).max(20).nullable().optional(),
  yearLevel: z.number().int().min(1).max(5),
  category: subjectCategorySchema,
  units: z.number().int().min(1).max(12),
  contactHours: z.number().int().min(1).max(18),
  lectureHours: z.number().int().min(0).max(12).default(3),
  labHours: z.number().int().min(0).max(12).default(0),
  curriculumVersion: z.string().min(2).max(30).default("2024"),
  isCurrentCurriculum: z.boolean().default(true),
});

export type SubjectInput = z.infer<typeof subjectInputSchema>;

/**
 * Section schema: stores section-level student count only (D-21).
 * Individual student records are strictly forbidden.
 */
export const sectionInputSchema = z.object({
  code: z.string().min(2).max(30),
  programCode: z.string().min(2).max(20),
  yearLevel: z.number().int().min(1).max(5),
  studentCount: z.number().int().min(1).max(120),
});

export type SectionInput = z.infer<typeof sectionInputSchema>;

export const roomInputSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(2).max(120),
  type: roomTypeSchema,
  capacity: z.number().int().min(1).max(300),
  equipment: z.array(z.string()).default([]),
  restrictions: z.string().max(300).default(""),
  status: z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]).default("ACTIVE"),
});

export type RoomInput = z.infer<typeof roomInputSchema>;

export const offeringInputSchema = z.object({
  code: z.string().min(2).max(40),
  termCode: z.string().min(2).max(40),
  sectionCode: z.string().min(2).max(30),
  subjectCode: z.string().min(2).max(30),
  component: z.enum(["LECTURE", "LAB"]).default("LECTURE"),
  meetingsPerWeek: z.number().int().min(1).max(6).default(2),
  minutesPerMeeting: z.number().int().min(30).max(360).default(90),
  meetingPattern: z.enum(["MWF", "TTH", "SINGLE", "ANY"]).default("ANY"),
  requiredRoomType: roomTypeSchema.default("LECTURE"),
  preassignedFacultyCode: z.string().nullable().optional(),
  combinedClassGroup: z.string().nullable().optional(),
});

export type OfferingInput = z.infer<typeof offeringInputSchema>;

export const fixedBlockInputSchema = z
  .object({
    termCode: z.string().min(2).max(40),
    sectionCode: z.string().min(2).max(30),
    weekday: weekdaySchema,
    startMin: z.number().int().min(0).max(1440),
    endMin: z.number().int().min(0).max(1440),
    label: z.string().min(2).max(120),
    location: z.string().min(1).max(120).default("External Building"),
  })
  .refine((b) => b.endMin > b.startMin, {
    message: "endMin must be greater than startMin",
    path: ["endMin"],
  });

export type FixedBlockInput = z.infer<typeof fixedBlockInputSchema>;

export const facultyAvailabilityInputSchema = z
  .object({
    facultyCode: z.string().min(2).max(30),
    termCode: z.string().min(2).max(40),
    weekday: weekdaySchema,
    startMin: z.number().int().min(0).max(1440),
    endMin: z.number().int().min(0).max(1440),
    status: z.enum(["AVAILABLE", "UNAVAILABLE"]).default("AVAILABLE"),
    reason: z.string().max(200).default(""),
  })
  .refine((a) => a.endMin > a.startMin, {
    message: "endMin must be greater than startMin",
    path: ["endMin"],
  });

export type FacultyAvailabilityInput = z.infer<
  typeof facultyAvailabilityInputSchema
>;

export const facultyQualificationInputSchema = z.object({
  facultyCode: z.string().min(2).max(30),
  subjectCode: z.string().min(2).max(30),
  source: z.enum(["DECLARED", "HISTORY", "DEAN"]).default("DECLARED"),
});

export type FacultyQualificationInput = z.infer<
  typeof facultyQualificationInputSchema
>;

export const facultyPreferenceInputSchema = z.object({
  facultyCode: z.string().min(2).max(30),
  termCode: z.string().min(2).max(40),
  type: z.enum([
    "PREFERRED_DAY",
    "AVOID_DAY",
    "PREFERRED_TIME_WINDOW",
    "PREFERRED_ROOM",
  ]),
  value: z.string().min(1).max(200),
  weight: z.number().min(0).max(10).default(1),
  source: z.enum(["SURVEY", "LEARNED", "DEAN"]).default("SURVEY"),
});

export type FacultyPreferenceInput = z.infer<
  typeof facultyPreferenceInputSchema
>;

