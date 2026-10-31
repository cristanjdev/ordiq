"""Validated environment configuration for the ORDIQ engine.

Boot fails immediately if required variables (such as ENGINE_TOKEN) are missing or invalid.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class EngineSettings(BaseSettings):
    """Runtime settings loaded exclusively from environment variables."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    engine_token: str = Field(
        ...,
        alias="ENGINE_TOKEN",
        min_length=16,
        description="Shared secret token required on all requests from apps/web.",
    )
    solver_time_limit_seconds: int = Field(
        default=120,
        alias="SOLVER_TIME_LIMIT_SECONDS",
        ge=1,
        le=3600,
    )
    solver_workers: int = Field(
        default=4,
        alias="SOLVER_WORKERS",
        ge=1,
        le=64,
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
        alias="LOG_LEVEL",
    )

    @field_validator("engine_token")
    @classmethod
    def validate_non_blank_token(cls, value: str) -> str:
        stripped = value.strip()
        if len(stripped) < 16:
            msg = "ENGINE_TOKEN must be at least 16 non-whitespace characters."
            raise ValueError(msg)
        return stripped


@lru_cache(maxsize=1)
def get_settings() -> EngineSettings:
    """Load and cache validated settings. Raises ValidationError if invalid."""
    return EngineSettings()
