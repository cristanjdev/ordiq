"""FastAPI route definitions for the ORDIQ engine."""

from typing import Annotated

from fastapi import APIRouter, Depends

from engine import __version__
from engine.api.deps import verify_engine_token
from engine.config import EngineSettings, get_settings
from engine.domain.models import ErrorEnvelope, HealthResponse

router = APIRouter()


@router.get(
    "/healthz",
    operation_id="getEngineHealth",
    response_model=HealthResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Engine liveness and capability check",
)
async def get_healthz(
    settings: Annotated[EngineSettings, Depends(get_settings)],
) -> HealthResponse:
    """Return engine liveness status and active solver settings."""
    return HealthResponse(
        status="ok",
        service="ordiq-engine",
        version=__version__,
        solver_time_limit_seconds=settings.solver_time_limit_seconds,
        solver_workers=settings.solver_workers,
    )
