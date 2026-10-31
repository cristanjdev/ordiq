"""API authentication and dependency injection for the engine."""

import hmac
from typing import Annotated

from fastapi import Depends, Header, status

from engine.config import EngineSettings, get_settings
from engine.errors import EngineError


def verify_engine_token(
    settings: Annotated[EngineSettings, Depends(get_settings)],
    x_engine_token: Annotated[str | None, Header(alias="X-Engine-Token")] = None,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> None:
    """Verify the shared engine token via X-Engine-Token or Bearer header."""
    candidate = x_engine_token
    if not candidate and authorization and authorization.lower().startswith("bearer "):
        candidate = authorization[7:].strip()

    if not candidate:
        raise EngineError(
            code="ENGINE_UNAUTHORIZED",
            message="Missing engine authentication token.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

    if not hmac.compare_digest(candidate.encode("utf-8"), settings.engine_token.encode("utf-8")):
        raise EngineError(
            code="ENGINE_UNAUTHORIZED",
            message="Invalid engine authentication token.",
            status_code=status.HTTP_401_UNAUTHORIZED,
        )

