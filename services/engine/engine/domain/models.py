"""Domain models and shared enums for the ORDIQ engine."""

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class Weekday(StrEnum):
    """Teaching days of the week (D-05)."""

    MONDAY = "MONDAY"
    TUESDAY = "TUESDAY"
    WEDNESDAY = "WEDNESDAY"
    THURSDAY = "THURSDAY"
    FRIDAY = "FRIDAY"
    SATURDAY = "SATURDAY"


WEEKDAY_ORDER: list[Weekday] = [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
    Weekday.SATURDAY,
]


class EmploymentType(StrEnum):
    """Faculty employment classifications from the manuscript."""

    FULL_TIME_PERMANENT = "FULL_TIME_PERMANENT"
    FULL_TIME_NON_PERMANENT = "FULL_TIME_NON_PERMANENT"
    PART_TIME = "PART_TIME"
    VISITING = "VISITING"


class RoomType(StrEnum):
    """Room classifications."""

    LECTURE = "LECTURE"
    LAB = "LAB"


class ComponentType(StrEnum):
    """Course offering component types."""

    LECTURE = "LECTURE"
    LAB = "LAB"


class ConstraintHardness(StrEnum):
    """Constraint hardness levels."""

    HARD = "HARD"
    SOFT = "SOFT"


class HardConstraintCode(StrEnum):
    """Catalogue codes for mandatory constraints (Section 6)."""

    HC_01 = "HC-01"
    HC_02 = "HC-02"
    HC_03 = "HC-03"
    HC_04 = "HC-04"
    HC_05 = "HC-05"
    HC_06 = "HC-06"
    HC_07 = "HC-07"
    HC_08 = "HC-08"
    HC_09 = "HC-09"
    HC_10 = "HC-10"
    HC_11 = "HC-11"
    HC_12 = "HC-12"
    HC_13 = "HC-13"
    HC_14 = "HC-14"
    HC_15 = "HC-15"


NEVER_WAIVABLE_CODES: set[HardConstraintCode] = {
    HardConstraintCode.HC_01,
    HardConstraintCode.HC_02,
    HardConstraintCode.HC_03,
}


class SoftConstraintCode(StrEnum):
    """Catalogue codes for soft preference objectives (Section 6)."""

    SC_01 = "SC-01"
    SC_02 = "SC-02"
    SC_03 = "SC-03"
    SC_04 = "SC-04"
    SC_05 = "SC-05"
    SC_06 = "SC-06"
    SC_07 = "SC-07"
    SC_08 = "SC-08"
    SC_09 = "SC-09"
    SC_10 = "SC-10"
    SC_11 = "SC-11"
    SC_12 = "SC-12"
    SC_13 = "SC-13"
    SC_14 = "SC-14"
    SC_15 = "SC-15"
    SC_16 = "SC-16"


class DirectiveType(StrEnum):
    """Closed set of chat-driven directive types (D-16)."""

    FACULTY_NOT_ON_DAY = "FACULTY_NOT_ON_DAY"
    FACULTY_TIME_WINDOW = "FACULTY_TIME_WINDOW"
    SECTION_TIME_WINDOW = "SECTION_TIME_WINDOW"
    AVOID_ROOM = "AVOID_ROOM"
    REQUIRE_ROOM = "REQUIRE_ROOM"
    PIN_MEETING = "PIN_MEETING"
    ASSIGN_FACULTY = "ASSIGN_FACULTY"
    SET_WEIGHT = "SET_WEIGHT"


class UnscheduledReasonCode(StrEnum):
    """Reason codes for meetings left unscheduled (2C Diagnostics)."""

    NO_QUALIFIED_FACULTY = "NO_QUALIFIED_FACULTY"
    NO_ROOM_CAPACITY = "NO_ROOM_CAPACITY"
    FACULTY_LOAD_FULL = "FACULTY_LOAD_FULL"
    NO_COMMON_SLOT = "NO_COMMON_SLOT"


class ErrorDetail(BaseModel):
    """Structured error body."""

    code: str = Field(..., description="Stable machine-readable error code.")
    message: str = Field(..., description="Human-readable error summary.")
    details: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional structured diagnostic details.",
    )


class ErrorEnvelope(BaseModel):
    """Standard error wrapper across web and engine APIs."""

    error: ErrorDetail


class HealthResponse(BaseModel):
    """Liveness and solver configuration payload returned by GET /healthz."""

    status: Literal["ok"] = "ok"
    service: Literal["ordiq-engine"] = "ordiq-engine"
    version: str = Field(..., description="Engine semantic version.")
    solver_time_limit_seconds: int = Field(
        ...,
        description="Configured CP-SAT time limit per candidate solve.",
    )
    solver_workers: int = Field(
        ...,
        description="Configured parallel worker count for CP-SAT.",
    )
    supported_hard_constraints: list[HardConstraintCode] = Field(
        default_factory=lambda: list(HardConstraintCode),
    )
    supported_soft_constraints: list[SoftConstraintCode] = Field(
        default_factory=lambda: list(SoftConstraintCode),
    )
    supported_directives: list[DirectiveType] = Field(
        default_factory=lambda: list(DirectiveType),
    )


# --- Problem Snapshot Models (Phase 2A) ---


class TermConfig(BaseModel):
    """Term slot grid and operating window configuration."""

    code: str
    slot_step_minutes: int = 30
    day_start_min: int = 450  # 07:30
    day_end_min: int = 1230  # 20:30
    allowed_weekdays: list[Weekday] = Field(default_factory=lambda: list(WEEKDAY_ORDER))
    official_breaks: list[tuple[int, int]] = Field(default_factory=list)


class FacultyModel(BaseModel):
    """Faculty member in problem snapshot."""

    code: str
    name: str = ""
    program_code: str | None = None
    employment_type: EmploymentType = EmploymentType.FULL_TIME_PERMANENT
    specialization: str = ""
    max_load_units: float = 21.0
    max_load_hours: float = 24.0
    status: str = "ACTIVE"


class SubjectModel(BaseModel):
    """Course subject in problem snapshot."""

    code: str
    name: str = ""
    program_code: str | None = None
    year_level: int = 1
    category: str = "MAJOR"
    units: float = 3.0
    contact_hours: float = 3.0
    lecture_hours: float = 3.0
    lab_hours: float = 0.0


class SectionModel(BaseModel):
    """Student section in problem snapshot (section-level counts only, D-21)."""

    code: str
    program_code: str
    year_level: int = 1
    student_count: int


class RoomModel(BaseModel):
    """Room or laboratory in problem snapshot."""

    code: str
    name: str = ""
    type: RoomType = RoomType.LECTURE
    capacity: int
    status: str = "ACTIVE"


class OfferingModel(BaseModel):
    """Course offering requiring meetings in the term."""

    code: str
    section_code: str
    subject_code: str
    component: ComponentType = ComponentType.LECTURE
    meetings_per_week: int = 2
    minutes_per_meeting: int = 90
    meeting_pattern: str = "ANY"  # "MWF", "TTH", "SINGLE", "ANY"
    required_room_type: RoomType = RoomType.LECTURE
    preassigned_faculty_code: str | None = None
    combined_class_group: str | None = None
    units_override: float | None = None


class AvailabilityWindow(BaseModel):
    """Faculty or room availability window."""

    entity_code: str
    weekday: Weekday
    start_min: int
    end_min: int
    status: Literal["AVAILABLE", "UNAVAILABLE", "PREFERRED"] = "AVAILABLE"


class QualificationModel(BaseModel):
    """Faculty qualification for a subject."""

    faculty_code: str
    subject_code: str


class FixedBlockModel(BaseModel):
    """Locked section block outside college control (PATHFIT, GenEd, D-23)."""

    section_code: str
    weekday: Weekday
    start_min: int
    end_min: int
    label: str = "Fixed Block"


class CalendarRestrictionModel(BaseModel):
    """Calendar or room maintenance restriction (HC-14)."""

    room_code: str | None = None
    weekday: Weekday
    start_min: int
    end_min: int
    reason: str = "Maintenance"


class DirectiveModel(BaseModel):
    """Dean directive or constraint record (HC-12 / D-16)."""

    id: str = "DIR-1"
    type: DirectiveType
    hardness: ConstraintHardness = ConstraintHardness.HARD
    approved: bool = True
    faculty_code: str | None = None
    section_code: str | None = None
    room_code: str | None = None
    offering_code: str | None = None
    weekday: Weekday | None = None
    start_min: int | None = None
    end_min: int | None = None
    weight: float = 10.0


class FacultyPreferenceModel(BaseModel):
    """Faculty preference record (SC-01, SC-04)."""

    faculty_code: str
    type: str  # "PREFERRED_DAY", "PREFERRED_TIME", "PREFERRED_ROOM", "AVOID_DAY"
    value: str
    weight: float = 5.0
    approved: bool = True


class SoftWeightsConfig(BaseModel):
    """Configured weights for soft constraints SC-01 to SC-16."""

    weights: dict[SoftConstraintCode, float] = Field(
        default_factory=lambda: {
            SoftConstraintCode.SC_01: 10.0,
            SoftConstraintCode.SC_02: 8.0,
            SoftConstraintCode.SC_03: 8.0,
            SoftConstraintCode.SC_04: 5.0,
            SoftConstraintCode.SC_05: 6.0,
            SoftConstraintCode.SC_06: 12.0,
            SoftConstraintCode.SC_07: 8.0,
            SoftConstraintCode.SC_08: 6.0,
            SoftConstraintCode.SC_09: 10.0,
            SoftConstraintCode.SC_10: 7.0,
            SoftConstraintCode.SC_11: 8.0,
            SoftConstraintCode.SC_12: 6.0,
            SoftConstraintCode.SC_13: 5.0,
            SoftConstraintCode.SC_14: 6.0,
            SoftConstraintCode.SC_15: 4.0,
            SoftConstraintCode.SC_16: 7.0,
        }
    )


class ScheduledMeetingEntry(BaseModel):
    """A single scheduled class meeting in a candidate or existing schedule."""

    id: str = ""
    offering_code: str
    meeting_index: int = 0
    faculty_code: str
    room_code: str
    weekday: Weekday
    start_min: int
    end_min: int
    pinned: bool = False


class ExceptionWaiverModel(BaseModel):
    """Documented waiver for a waivable constraint (D-18)."""

    code: HardConstraintCode
    offering_code: str | None = None
    faculty_code: str | None = None
    room_code: str | None = None
    section_code: str | None = None
    reason: str
    approved_by: str = "dean"


class Problem(BaseModel):
    """Complete stateless problem snapshot sent to the engine."""

    term: TermConfig
    faculty: list[FacultyModel] = Field(default_factory=list)
    subjects: list[SubjectModel] = Field(default_factory=list)
    sections: list[SectionModel] = Field(default_factory=list)
    rooms: list[RoomModel] = Field(default_factory=list)
    offerings: list[OfferingModel] = Field(default_factory=list)
    faculty_availability: list[AvailabilityWindow] = Field(default_factory=list)
    room_availability: list[AvailabilityWindow] = Field(default_factory=list)
    qualifications: list[QualificationModel] = Field(default_factory=list)
    fixed_blocks: list[FixedBlockModel] = Field(default_factory=list)
    calendar_restrictions: list[CalendarRestrictionModel] = Field(default_factory=list)
    directives: list[DirectiveModel] = Field(default_factory=list)
    faculty_preferences: list[FacultyPreferenceModel] = Field(default_factory=list)
    soft_weights: SoftWeightsConfig = Field(default_factory=SoftWeightsConfig)
    ml_fit_scores: dict[str, float] = Field(
        default_factory=dict,
        description="Optional key 'facultyCode:subjectCode' -> [0, 1] fit score (SC-07).",
    )
    prior_entries: list[ScheduledMeetingEntry] = Field(
        default_factory=list,
        description="Optional baseline entries for regeneration (SC-06) or pinned entries.",
    )
    waivers: list[ExceptionWaiverModel] = Field(
        default_factory=list,
        description="Documented exceptions for waivable rules (D-18).",
    )


class Violation(BaseModel):
    """A single hard constraint violation detected by the independent validator."""

    code: HardConstraintCode
    message: str
    waivable: bool
    waived: bool = False
    waiver_reason: str | None = None
    entry_ids: list[str] = Field(default_factory=list)
    offering_codes: list[str] = Field(default_factory=list)
    faculty_codes: list[str] = Field(default_factory=list)
    room_codes: list[str] = Field(default_factory=list)
    section_codes: list[str] = Field(default_factory=list)
    weekday: Weekday | None = None
    start_min: int | None = None
    end_min: int | None = None


class UnmetPreference(BaseModel):
    """A soft preference or goal that incurred a penalty."""

    code: SoftConstraintCode
    description: str
    penalty: float
    faculty_code: str | None = None
    section_code: str | None = None
    offering_code: str | None = None


class QualityReport(BaseModel):
    """Detailed soft-constraint quality report for a schedule."""

    total_penalty: float
    quality_score: float = Field(
        ...,
        description="Normalized 0..100 quality score (higher is better).",
    )
    penalties_by_code: dict[SoftConstraintCode, float] = Field(default_factory=dict)
    unmet_preferences: list[UnmetPreference] = Field(default_factory=list)


class ValidationRequest(BaseModel):
    """Payload for POST /v1/validate."""

    problem: Problem
    entries: list[ScheduledMeetingEntry]


class ValidationResponse(BaseModel):
    """Response from POST /v1/validate."""

    valid: bool
    hard_violation_count: int
    waived_violation_count: int = 0
    violations: list[Violation]
    quality: QualityReport


class UnscheduledMeetingResult(BaseModel):
    """Diagnostic record for a meeting the solver left unscheduled (D-07, 2C)."""

    offering_code: str
    meeting_index: int
    reason_code: UnscheduledReasonCode
    reason_detail: str


class Solution(BaseModel):
    """Solver output containing scheduled entries, unscheduled diagnostics, and solver telemetry."""

    status: Literal["PROVEN_OPTIMAL", "BEST_FOUND", "INFEASIBLE", "CANCELLED"]
    profile_name: str = "BALANCED"
    entries: list[ScheduledMeetingEntry] = Field(default_factory=list)
    unscheduled: list[UnscheduledMeetingResult] = Field(default_factory=list)
    objective_value: float = 0.0
    best_bound: float = 0.0
    optimality_gap_pct: float = 0.0
    solve_time_ms: int = 0
    validation: ValidationResponse | None = None


class SolveRequest(BaseModel):
    """Payload for POST /v1/solve."""

    problem: Problem
    profile_name: str = "BALANCED"
    time_limit_seconds: int | None = None


class SolveJobResponse(BaseModel):
    """Response from POST /v1/solve and GET /v1/solve/{jobId}."""

    job_id: str
    status: Literal["QUEUED", "RUNNING", "DONE", "CANCELLED", "FAILED"]
    progress_pct: int = 0
    solution: Solution | None = None
    error: str | None = None


class AlternativeSlot(BaseModel):
    """A single feasible alternative slot and room ranked by quality impact."""

    weekday: Weekday
    start_min: int
    end_min: int
    room_code: str
    faculty_code: str
    quality_delta: float
    resulting_quality_score: float


class AlternativesRequest(BaseModel):
    """Payload for POST /v1/alternatives."""

    problem: Problem
    current_entries: list[ScheduledMeetingEntry]
    offering_code: str
    meeting_index: int = 0
    max_results: int = 5


class AlternativesResponse(BaseModel):
    """Response from POST /v1/alternatives."""

    offering_code: str
    meeting_index: int
    alternatives: list[AlternativeSlot]


# --- Machine Learning Models (Phase 5) ---


class HistoricalAssignmentSample(BaseModel):
    """Training sample linking a faculty member and subject with outcome weight."""

    faculty_code: str
    subject_code: str
    faculty_specialization: str = ""
    faculty_program_code: str = ""
    subject_name: str = ""
    subject_description: str = ""
    subject_program_code: str = ""
    subject_category: str = "MAJOR"
    qualified: bool = True
    preference_weight: float = 0.0
    historical_count: int = 1
    accepted_by_dean: bool = True


class MLTrainRequest(BaseModel):
    """Payload for POST /v1/ml/train."""

    samples: list[HistoricalAssignmentSample]


class MLModelMetrics(BaseModel):
    """Evaluation metrics for the trained faculty-subject fit model."""

    sample_count: int
    top1_accuracy: float
    top3_accuracy: float
    baseline_top1_accuracy: float
    feature_names: list[str]


class MLTrainResponse(BaseModel):
    """Response from POST /v1/ml/train storing parameters as JSON (D-11)."""

    model_kind: str = "logistic_regression_tfidf_v1"
    parameters: dict[str, Any]
    metrics: MLModelMetrics


class FacultySubjectPair(BaseModel):
    """Candidate pair to score in POST /v1/ml/recommend."""

    faculty_code: str
    subject_code: str
    faculty_specialization: str = ""
    faculty_program_code: str = ""
    subject_name: str = ""
    subject_description: str = ""
    subject_program_code: str = ""
    subject_category: str = "MAJOR"
    qualified: bool = True
    preference_weight: float = 0.0
    historical_count: int = 0


class FacultyRecommendationItem(BaseModel):
    """Ranked recommendation with score and top contributing factors."""

    faculty_code: str
    subject_code: str
    fit_score: float
    rank: int
    factors: list[str]


class MLRecommendRequest(BaseModel):
    """Payload for POST /v1/ml/recommend."""

    parameters: dict[str, Any] | None = None
    pairs: list[FacultySubjectPair]


class MLRecommendResponse(BaseModel):
    """Response from POST /v1/ml/recommend."""

    recommendations: list[FacultyRecommendationItem]
