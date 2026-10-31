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
