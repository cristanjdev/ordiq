"""FastAPI application entrypoint for the ORDIQ engine."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from engine import __version__
from engine.api.routes import router
from engine.config import get_settings
from engine.errors import register_exception_handlers
from engine.logger import configure_logger, logger


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Validate environment configuration at boot before accepting requests."""
    settings = get_settings()
    configure_logger(settings.log_level)
    logger.info(
        "engine_starting",
        extra={
            "context": {
                "version": __version__,
                "solver_time_limit_seconds": settings.solver_time_limit_seconds,
                "solver_workers": settings.solver_workers,
            }
        },
    )
    yield
    logger.info("engine_stopping")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="ORDIQ Scheduling & ML Engine",
        description=(
            "Stateless optimization (CP-SAT), independent constraint validation, "
            "and machine learning service for ORDIQ."
        ),
        version=__version__,
        lifespan=lifespan,
    )
    register_exception_handlers(app)
    app.include_router(router)
    return app


app = create_app()

