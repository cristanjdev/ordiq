"""FastAPI route definitions for the ORDIQ engine."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from engine import __version__
from engine.api.deps import verify_engine_token
from engine.config import EngineSettings, get_settings
from engine.domain.models import (
    AlternativesRequest,
    AlternativesResponse,
    ErrorEnvelope,
    HealthResponse,
    MLRecommendRequest,
    MLRecommendResponse,
    MLTrainRequest,
    MLTrainResponse,
    SolveJobResponse,
    SolveRequest,
    ValidationRequest,
    ValidationResponse,
)
from engine.errors import EngineError
from engine.ml.recommender import recommend_faculty, train_fit_model
from engine.solver.cpsat_solver import find_alternative_slots, job_store
from engine.validator.validator import validate_schedule

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


@router.post(
    "/v1/validate",
    operation_id="validateSchedule",
    response_model=ValidationResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Independently validate any schedule and compute quality score",
)
async def post_validate(req: ValidationRequest) -> ValidationResponse:
    """Validate all 15 hard constraints and score 16 soft constraints."""
    return validate_schedule(req.problem, req.entries)


@router.post(
    "/v1/solve",
    operation_id="startSolveJob",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=SolveJobResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Start a CP-SAT solve job and return a job ID",
)
async def post_solve(req: SolveRequest) -> SolveJobResponse:
    """Run a CP-SAT solve for the provided problem snapshot and weight profile."""
    return job_store.create_and_run(
        problem=req.problem,
        profile_name=req.profile_name,
        time_limit_seconds=req.time_limit_seconds,
    )


@router.get(
    "/v1/solve/{job_id}",
    operation_id="getSolveJob",
    response_model=SolveJobResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
        404: {"model": ErrorEnvelope, "description": "Solve job not found"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Get solve job status, progress, and solution",
)
async def get_solve_job(job_id: str) -> SolveJobResponse:
    """Retrieve a solve job from the in-memory registry."""
    res = job_store.get(job_id)
    if res is None:
        raise EngineError(
            code="SOLVE_JOB_NOT_FOUND",
            message=f"Solve job '{job_id}' was not found.",
            status_code=404,
        )
    return res


@router.post(
    "/v1/solve/{job_id}/cancel",
    operation_id="cancelSolveJob",
    response_model=SolveJobResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
        404: {"model": ErrorEnvelope, "description": "Solve job not found"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Cancel a solve job",
)
async def cancel_solve_job(job_id: str) -> SolveJobResponse:
    """Mark a solve job as cancelled."""
    res = job_store.cancel(job_id)
    if res is None:
        raise EngineError(
            code="SOLVE_JOB_NOT_FOUND",
            message=f"Solve job '{job_id}' was not found.",
            status_code=404,
        )
    return res


@router.post(
    "/v1/alternatives",
    operation_id="findAlternatives",
    response_model=AlternativesResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Find feasible alternative slots and rooms ranked by quality impact",
)
async def post_alternatives(req: AlternativesRequest) -> AlternativesResponse:
    """Evaluate feasible non-conflicting slots for a meeting."""
    return find_alternative_slots(req)


@router.post(
    "/v1/ml/train",
    operation_id="trainMlModel",
    response_model=MLTrainResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Train faculty-subject fit model and return JSON parameters and metrics",
)
async def post_ml_train(req: MLTrainRequest) -> MLTrainResponse:
    """Train regularized logistic regression / similarity model."""
    return train_fit_model(req)


@router.post(
    "/v1/ml/recommend",
    operation_id="recommendFaculty",
    response_model=MLRecommendResponse,
    responses={
        401: {"model": ErrorEnvelope, "description": "Missing or invalid engine token"},
    },
    dependencies=[Depends(verify_engine_token)],
    summary="Rank faculty per subject with fit score and plain-language factors",
)
async def post_ml_recommend(req: MLRecommendRequest) -> MLRecommendResponse:
    """Return ranked faculty recommendations per subject."""
    return recommend_faculty(req)
