import type { components, paths } from "./openapi.gen";

export type { components, paths };

export type EngineHealthResponse = components["schemas"]["HealthResponse"];
export type ApiErrorDetail = components["schemas"]["ErrorDetail"];
export type ApiErrorEnvelope = components["schemas"]["ErrorEnvelope"];
export type HardConstraintCode = components["schemas"]["HardConstraintCode"];
export type SoftConstraintCode = components["schemas"]["SoftConstraintCode"];
export type DirectiveType = components["schemas"]["DirectiveType"];
export type EngineProblem = components["schemas"]["Problem"];
export type EngineSolution = components["schemas"]["Solution"];
export type EngineViolation = components["schemas"]["Violation"];
export type EngineQualityReport = components["schemas"]["QualityReport"];
export type EngineValidationRequest = components["schemas"]["ValidationRequest"];
export type EngineValidationResponse = components["schemas"]["ValidationResponse"];
export type EngineSolveRequest = components["schemas"]["SolveRequest"];
export type EngineSolveJobResponse = components["schemas"]["SolveJobResponse"];
export type EngineAlternativesRequest = components["schemas"]["AlternativesRequest"];
export type EngineAlternativesResponse = components["schemas"]["AlternativesResponse"];
export type EngineAlternativeSlot = components["schemas"]["AlternativeSlot"];
export type EngineScheduledMeetingEntry = components["schemas"]["ScheduledMeetingEntry"];
export type EngineUnscheduledMeetingResult = components["schemas"]["UnscheduledMeetingResult"];
export type EngineUnscheduledReasonCode = components["schemas"]["UnscheduledReasonCode"];
export type EngineMLTrainRequest = components["schemas"]["MLTrainRequest"];
export type EngineMLTrainResponse = components["schemas"]["MLTrainResponse"];
export type EngineMLRecommendRequest = components["schemas"]["MLRecommendRequest"];
export type EngineMLRecommendResponse = components["schemas"]["MLRecommendResponse"];

export const HARD_CONSTRAINT_CODES: readonly HardConstraintCode[] = [
  "HC-01",
  "HC-02",
  "HC-03",
  "HC-04",
  "HC-05",
  "HC-06",
  "HC-07",
  "HC-08",
  "HC-09",
  "HC-10",
  "HC-11",
  "HC-12",
  "HC-13",
  "HC-14",
  "HC-15",
] as const;

export const NON_WAIVABLE_HARD_CONSTRAINTS: readonly HardConstraintCode[] = [
  "HC-01",
  "HC-02",
  "HC-03",
] as const;

export const SOFT_CONSTRAINT_CODES: readonly SoftConstraintCode[] = [
  "SC-01",
  "SC-02",
  "SC-03",
  "SC-04",
  "SC-05",
  "SC-06",
  "SC-07",
  "SC-08",
  "SC-09",
  "SC-10",
  "SC-11",
  "SC-12",
  "SC-13",
  "SC-14",
  "SC-15",
  "SC-16",
] as const;

export const DIRECTIVE_TYPES: readonly DirectiveType[] = [
  "FACULTY_NOT_ON_DAY",
  "FACULTY_TIME_WINDOW",
  "SECTION_TIME_WINDOW",
  "AVOID_ROOM",
  "REQUIRE_ROOM",
  "PIN_MEETING",
  "ASSIGN_FACULTY",
  "SET_WEIGHT",
] as const;

export const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const EMPLOYMENT_TYPES = [
  "FULL_TIME_PERMANENT",
  "FULL_TIME_NON_PERMANENT",
  "PART_TIME",
  "VISITING",
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const ROOM_TYPES = ["LECTURE", "LAB"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const SCHEDULE_STATUSES = ["CANDIDATE", "ACCEPTED", "ARCHIVED"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];
