/**
 * AUTO-GENERATED FROM packages/contracts/openapi.json — DO NOT EDIT MANUALLY.
 * Run `pnpm contracts:generate` to regenerate.
 */

export interface components {
  schemas: {
    /** Closed set of chat-driven directive types (D-16). */
    "DirectiveType": "FACULTY_NOT_ON_DAY" | "FACULTY_TIME_WINDOW" | "SECTION_TIME_WINDOW" | "AVOID_ROOM" | "REQUIRE_ROOM" | "PIN_MEETING" | "ASSIGN_FACULTY" | "SET_WEIGHT";
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
    /** Catalogue codes for soft preference objectives (Section 6). */
    "SoftConstraintCode": "SC-01" | "SC-02" | "SC-03" | "SC-04" | "SC-05" | "SC-06" | "SC-07" | "SC-08" | "SC-09" | "SC-10" | "SC-11" | "SC-12" | "SC-13" | "SC-14" | "SC-15" | "SC-16";
    "ValidationError": {
      "ctx"?: Record<string, unknown>;
      "input"?: unknown;
      "loc": Array<string | number>;
      "msg": string;
      "type": string;
    };
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
}
