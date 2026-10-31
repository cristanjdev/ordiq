/**
 * AUTO-GENERATED FROM packages/contracts/openapi.json — DO NOT EDIT MANUALLY.
 * Run `pnpm contracts:generate` to regenerate.
 */

export interface components {
  schemas: {
    /** A single feasible alternative slot and room ranked by quality impact. */
    "AlternativeSlot": {
      "end_min": number;
      "faculty_code": string;
      "quality_delta": number;
      "resulting_quality_score": number;
      "room_code": string;
      "start_min": number;
      "weekday": components["schemas"]["Weekday"];
    };
    /** Payload for POST /v1/alternatives. */
    "AlternativesRequest": {
      "current_entries": Array<components["schemas"]["ScheduledMeetingEntry"]>;
      "max_results": number;
      "meeting_index": number;
      "offering_code": string;
      "problem": components["schemas"]["Problem"];
    };
    /** Response from POST /v1/alternatives. */
    "AlternativesResponse": {
      "alternatives": Array<components["schemas"]["AlternativeSlot"]>;
      "meeting_index": number;
      "offering_code": string;
    };
    /** Faculty or room availability window. */
    "AvailabilityWindow": {
      "end_min": number;
      "entity_code": string;
      "start_min": number;
      "status": "AVAILABLE" | "UNAVAILABLE" | "PREFERRED";
      "weekday": components["schemas"]["Weekday"];
    };
    /** Calendar or room maintenance restriction (HC-14). */
    "CalendarRestrictionModel": {
      "end_min": number;
      "reason": string;
      "room_code"?: string | null;
      "start_min": number;
      "weekday": components["schemas"]["Weekday"];
    };
    /** Course offering component types. */
    "ComponentType": "LECTURE" | "LAB";
    /** Constraint hardness levels. */
    "ConstraintHardness": "HARD" | "SOFT";
    /** Dean directive or constraint record (HC-12 / D-16). */
    "DirectiveModel": {
      "approved": boolean;
      "end_min"?: number | null;
      "faculty_code"?: string | null;
      "hardness": components["schemas"]["ConstraintHardness"];
      "id": string;
      "offering_code"?: string | null;
      "room_code"?: string | null;
      "section_code"?: string | null;
      "start_min"?: number | null;
      "type": components["schemas"]["DirectiveType"];
      "weekday"?: components["schemas"]["Weekday"] | null;
      "weight": number;
    };
    /** Closed set of chat-driven directive types (D-16). */
    "DirectiveType": "FACULTY_NOT_ON_DAY" | "FACULTY_TIME_WINDOW" | "SECTION_TIME_WINDOW" | "AVOID_ROOM" | "REQUIRE_ROOM" | "PIN_MEETING" | "ASSIGN_FACULTY" | "SET_WEIGHT";
    /** Faculty employment classifications from the manuscript. */
    "EmploymentType": "FULL_TIME_PERMANENT" | "FULL_TIME_NON_PERMANENT" | "PART_TIME" | "VISITING";
    /** Structured error body. */
    "ErrorDetail": {
      "code": string;
      "details"?: Record<string, unknown>;
      "message": string;
    };
    /** Standard error wrapper across web and engine APIs. */
    "ErrorEnvelope": {
      "error": components["schemas"]["ErrorDetail"];
    };
    /** Documented waiver for a waivable constraint (D-18). */
    "ExceptionWaiverModel": {
      "approved_by": string;
      "code": components["schemas"]["HardConstraintCode"];
      "faculty_code"?: string | null;
      "offering_code"?: string | null;
      "reason": string;
      "room_code"?: string | null;
      "section_code"?: string | null;
    };
    /** Faculty member in problem snapshot. */
    "FacultyModel": {
      "code": string;
      "employment_type": components["schemas"]["EmploymentType"];
      "max_load_hours": number;
      "max_load_units": number;
      "name": string;
      "program_code"?: string | null;
      "specialization": string;
      "status": string;
    };
    /** Faculty preference record (SC-01, SC-04). */
    "FacultyPreferenceModel": {
      "approved": boolean;
      "faculty_code": string;
      "type": string;
      "value": string;
      "weight": number;
    };
    /** Ranked recommendation with score and top contributing factors. */
    "FacultyRecommendationItem": {
      "factors": Array<string>;
      "faculty_code": string;
      "fit_score": number;
      "rank": number;
      "subject_code": string;
    };
    /** Candidate pair to score in POST /v1/ml/recommend. */
    "FacultySubjectPair": {
      "faculty_code": string;
      "faculty_program_code": string;
      "faculty_specialization": string;
      "historical_count": number;
      "preference_weight": number;
      "qualified": boolean;
      "subject_category": string;
      "subject_code": string;
      "subject_description": string;
      "subject_name": string;
      "subject_program_code": string;
    };
    /** Locked section block outside college control (PATHFIT, GenEd, D-23). */
    "FixedBlockModel": {
      "end_min": number;
      "label": string;
      "section_code": string;
      "start_min": number;
      "weekday": components["schemas"]["Weekday"];
    };
    "HTTPValidationError": {
      "detail"?: Array<components["schemas"]["ValidationError"]>;
    };
    /** Catalogue codes for mandatory constraints (Section 6). */
    "HardConstraintCode": "HC-01" | "HC-02" | "HC-03" | "HC-04" | "HC-05" | "HC-06" | "HC-07" | "HC-08" | "HC-09" | "HC-10" | "HC-11" | "HC-12" | "HC-13" | "HC-14" | "HC-15";
    /** Liveness and solver configuration payload returned by GET /healthz. */
    "HealthResponse": {
      "service": "ordiq-engine";
      "solver_time_limit_seconds": number;
      "solver_workers": number;
      "status": "ok";
      "supported_directives"?: Array<components["schemas"]["DirectiveType"]>;
      "supported_hard_constraints"?: Array<components["schemas"]["HardConstraintCode"]>;
      "supported_soft_constraints"?: Array<components["schemas"]["SoftConstraintCode"]>;
      "version": string;
    };
    /** Training sample linking a faculty member and subject with outcome weight. */
    "HistoricalAssignmentSample": {
      "accepted_by_dean": boolean;
      "faculty_code": string;
      "faculty_program_code": string;
      "faculty_specialization": string;
      "historical_count": number;
      "preference_weight": number;
      "qualified": boolean;
      "subject_category": string;
      "subject_code": string;
      "subject_description": string;
      "subject_name": string;
      "subject_program_code": string;
    };
    /** Evaluation metrics for the trained faculty-subject fit model. */
    "MLModelMetrics": {
      "baseline_top1_accuracy": number;
      "feature_names": Array<string>;
      "sample_count": number;
      "top1_accuracy": number;
      "top3_accuracy": number;
    };
    /** Payload for POST /v1/ml/recommend. */
    "MLRecommendRequest": {
      "pairs": Array<components["schemas"]["FacultySubjectPair"]>;
      "parameters"?: Record<string, unknown> | null;
    };
    /** Response from POST /v1/ml/recommend. */
    "MLRecommendResponse": {
      "recommendations": Array<components["schemas"]["FacultyRecommendationItem"]>;
    };
    /** Payload for POST /v1/ml/train. */
    "MLTrainRequest": {
      "samples": Array<components["schemas"]["HistoricalAssignmentSample"]>;
    };
    /** Response from POST /v1/ml/train storing parameters as JSON (D-11). */
    "MLTrainResponse": {
      "metrics": components["schemas"]["MLModelMetrics"];
      "model_kind": string;
      "parameters": Record<string, unknown>;
    };
    /** Course offering requiring meetings in the term. */
    "OfferingModel": {
      "code": string;
      "combined_class_group"?: string | null;
      "component": components["schemas"]["ComponentType"];
      "meeting_pattern": string;
      "meetings_per_week": number;
      "minutes_per_meeting": number;
      "preassigned_faculty_code"?: string | null;
      "required_room_type": components["schemas"]["RoomType"];
      "section_code": string;
      "subject_code": string;
      "units_override"?: number | null;
    };
    /** Complete stateless problem snapshot sent to the engine. */
    "Problem": {
      "calendar_restrictions"?: Array<components["schemas"]["CalendarRestrictionModel"]>;
      "directives"?: Array<components["schemas"]["DirectiveModel"]>;
      "faculty"?: Array<components["schemas"]["FacultyModel"]>;
      "faculty_availability"?: Array<components["schemas"]["AvailabilityWindow"]>;
      "faculty_preferences"?: Array<components["schemas"]["FacultyPreferenceModel"]>;
      "fixed_blocks"?: Array<components["schemas"]["FixedBlockModel"]>;
      "ml_fit_scores"?: Record<string, unknown>;
      "offerings"?: Array<components["schemas"]["OfferingModel"]>;
      "prior_entries"?: Array<components["schemas"]["ScheduledMeetingEntry"]>;
      "qualifications"?: Array<components["schemas"]["QualificationModel"]>;
      "room_availability"?: Array<components["schemas"]["AvailabilityWindow"]>;
      "rooms"?: Array<components["schemas"]["RoomModel"]>;
      "sections"?: Array<components["schemas"]["SectionModel"]>;
      "soft_weights"?: components["schemas"]["SoftWeightsConfig"];
      "subjects"?: Array<components["schemas"]["SubjectModel"]>;
      "term": components["schemas"]["TermConfig"];
      "waivers"?: Array<components["schemas"]["ExceptionWaiverModel"]>;
    };
    /** Faculty qualification for a subject. */
    "QualificationModel": {
      "faculty_code": string;
      "subject_code": string;
    };
    /** Detailed soft-constraint quality report for a schedule. */
    "QualityReport": {
      "penalties_by_code"?: Record<string, unknown>;
      "quality_score": number;
      "total_penalty": number;
      "unmet_preferences"?: Array<components["schemas"]["UnmetPreference"]>;
    };
    /** Room or laboratory in problem snapshot. */
    "RoomModel": {
      "capacity": number;
      "code": string;
      "name": string;
      "status": string;
      "type": components["schemas"]["RoomType"];
    };
    /** Room classifications. */
    "RoomType": "LECTURE" | "LAB";
    /** A single scheduled class meeting in a candidate or existing schedule. */
    "ScheduledMeetingEntry": {
      "end_min": number;
      "faculty_code": string;
      "id": string;
      "meeting_index": number;
      "offering_code": string;
      "pinned": boolean;
      "room_code": string;
      "start_min": number;
      "weekday": components["schemas"]["Weekday"];
    };
    /** Student section in problem snapshot (section-level counts only, D-21). */
    "SectionModel": {
      "code": string;
      "program_code": string;
      "student_count": number;
      "year_level": number;
    };
    /** Catalogue codes for soft preference objectives (Section 6). */
    "SoftConstraintCode": "SC-01" | "SC-02" | "SC-03" | "SC-04" | "SC-05" | "SC-06" | "SC-07" | "SC-08" | "SC-09" | "SC-10" | "SC-11" | "SC-12" | "SC-13" | "SC-14" | "SC-15" | "SC-16";
    /** Configured weights for soft constraints SC-01 to SC-16. */
    "SoftWeightsConfig": {
      "weights"?: Record<string, unknown>;
    };
    /** Solver output containing scheduled entries, unscheduled diagnostics, and solver telemetry. */
    "Solution": {
      "best_bound": number;
      "entries"?: Array<components["schemas"]["ScheduledMeetingEntry"]>;
      "objective_value": number;
      "optimality_gap_pct": number;
      "profile_name": string;
      "solve_time_ms": number;
      "status": "PROVEN_OPTIMAL" | "BEST_FOUND" | "INFEASIBLE" | "CANCELLED";
      "unscheduled"?: Array<components["schemas"]["UnscheduledMeetingResult"]>;
      "validation"?: components["schemas"]["ValidationResponse"] | null;
    };
    /** Response from POST /v1/solve and GET /v1/solve/{jobId}. */
    "SolveJobResponse": {
      "error"?: string | null;
      "job_id": string;
      "progress_pct": number;
      "solution"?: components["schemas"]["Solution"] | null;
      "status": "QUEUED" | "RUNNING" | "DONE" | "CANCELLED" | "FAILED";
    };
    /** Payload for POST /v1/solve. */
    "SolveRequest": {
      "problem": components["schemas"]["Problem"];
      "profile_name": string;
      "time_limit_seconds"?: number | null;
    };
    /** Course subject in problem snapshot. */
    "SubjectModel": {
      "category": string;
      "code": string;
      "contact_hours": number;
      "lab_hours": number;
      "lecture_hours": number;
      "name": string;
      "program_code"?: string | null;
      "units": number;
      "year_level": number;
    };
    /** Term slot grid and operating window configuration. */
    "TermConfig": {
      "allowed_weekdays"?: Array<components["schemas"]["Weekday"]>;
      "code": string;
      "day_end_min": number;
      "day_start_min": number;
      "official_breaks"?: Array<Array<unknown>>;
      "slot_step_minutes": number;
    };
    /** A soft preference or goal that incurred a penalty. */
    "UnmetPreference": {
      "code": components["schemas"]["SoftConstraintCode"];
      "description": string;
      "faculty_code"?: string | null;
      "offering_code"?: string | null;
      "penalty": number;
      "section_code"?: string | null;
    };
    /** Diagnostic record for a meeting the solver left unscheduled (D-07, 2C). */
    "UnscheduledMeetingResult": {
      "meeting_index": number;
      "offering_code": string;
      "reason_code": components["schemas"]["UnscheduledReasonCode"];
      "reason_detail": string;
    };
    /** Reason codes for meetings left unscheduled (2C Diagnostics). */
    "UnscheduledReasonCode": "NO_QUALIFIED_FACULTY" | "NO_ROOM_CAPACITY" | "FACULTY_LOAD_FULL" | "NO_COMMON_SLOT";
    "ValidationError": {
      "ctx"?: Record<string, unknown>;
      "input"?: unknown;
      "loc": Array<string | number>;
      "msg": string;
      "type": string;
    };
    /** Payload for POST /v1/validate. */
    "ValidationRequest": {
      "entries": Array<components["schemas"]["ScheduledMeetingEntry"]>;
      "problem": components["schemas"]["Problem"];
    };
    /** Response from POST /v1/validate. */
    "ValidationResponse": {
      "hard_violation_count": number;
      "quality": components["schemas"]["QualityReport"];
      "valid": boolean;
      "violations": Array<components["schemas"]["Violation"]>;
      "waived_violation_count": number;
    };
    /** A single hard constraint violation detected by the independent validator. */
    "Violation": {
      "code": components["schemas"]["HardConstraintCode"];
      "end_min"?: number | null;
      "entry_ids"?: Array<string>;
      "faculty_codes"?: Array<string>;
      "message": string;
      "offering_codes"?: Array<string>;
      "room_codes"?: Array<string>;
      "section_codes"?: Array<string>;
      "start_min"?: number | null;
      "waivable": boolean;
      "waived": boolean;
      "waiver_reason"?: string | null;
      "weekday"?: components["schemas"]["Weekday"] | null;
    };
    /** Teaching days of the week (D-05). */
    "Weekday": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
  };
}

export interface paths {
  "/healthz": {
    "get": {
      responses: {
        200: components["schemas"]["HealthResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/alternatives": {
    "post": {
      responses: {
        200: components["schemas"]["AlternativesResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/ml/recommend": {
    "post": {
      responses: {
        200: components["schemas"]["MLRecommendResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/ml/train": {
    "post": {
      responses: {
        200: components["schemas"]["MLTrainResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/solve": {
    "post": {
      responses: {
        202: components["schemas"]["SolveJobResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/solve/{job_id}": {
    "get": {
      responses: {
        200: components["schemas"]["SolveJobResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        404: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/solve/{job_id}/cancel": {
    "post": {
      responses: {
        200: components["schemas"]["SolveJobResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        404: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/v1/validate": {
    "post": {
      responses: {
        200: components["schemas"]["ValidationResponse"];
        401: components["schemas"]["ErrorEnvelope"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
}
