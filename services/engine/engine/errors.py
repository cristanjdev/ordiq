"""Shared API error format and FastAPI exception handlers.

Follows Section 4 convention:
{ "error": { "code": "SCHEDULE_NOT_FOUND", "message": "...", "details": {} } }
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from engine.domain.models import ErrorDetail, ErrorEnvelope
from engine.logger import logger


class EngineError(Exception):
    """Domain or API error with structured code, message, and HTTP status."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details: dict[str, Any] = details or {}


def build_error_response(
    code: str,
    message: str,
    status_code: int,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    """Build a JSONResponse conforming to ErrorEnvelope."""
    envelope = ErrorEnvelope(
        error=ErrorDetail(
            code=code,
            message=message,
            details=details or {},
        )
    )
    return JSONResponse(status_code=status_code, content=envelope.model_dump())


def register_exception_handlers(app: FastAPI) -> None:
    """Attach standard error handlers to the FastAPI instance."""

    @app.exception_handler(EngineError)
    async def handle_engine_error(_request: Request, exc: EngineError) -> JSONResponse:
        logger.warning(
            "engine_error",
            extra={"context": {"code": exc.code, "status_code": exc.status_code}},
        )
        return build_error_response(
            code=exc.code,
            message=exc.message,
            status_code=exc.status_code,
            details=exc.details,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        logger.warning(
            "request_validation_error",
            extra={"context": {"error_count": len(exc.errors())}},
        )
        return build_error_response(
            code="VALIDATION_ERROR",
            message="Request payload failed schema validation.",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details={"issues": exc.errors()},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled_engine_exception", exc_info=exc)
        return build_error_response(
            code="INTERNAL_SERVER_ERROR",
            message="An unexpected error occurred in the scheduling engine.",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            details={},
        )

