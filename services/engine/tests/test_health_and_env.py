"""Tests for engine health endpoint, token auth, env validation, and logger sanitization."""

import json
import logging

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from engine.config import EngineSettings, get_settings
from engine.errors import EngineError
from engine.logger import StructuredJsonFormatter
from engine.main import create_app

TEST_TOKEN = "test-engine-secret-token-1234567890"


@pytest.fixture(autouse=True)
def _clear_settings_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("SOLVER_TIME_LIMIT_SECONDS", "90")
    monkeypatch.setenv("SOLVER_WORKERS", "2")
    get_settings.cache_clear()


def test_healthz_succeeds_with_valid_header_token() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/healthz", headers={"X-Engine-Token": TEST_TOKEN})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "ordiq-engine"
    assert body["solver_time_limit_seconds"] == 90
    assert body["solver_workers"] == 2
    assert "HC-01" in body["supported_hard_constraints"]
    assert "SC-01" in body["supported_soft_constraints"]


def test_healthz_succeeds_with_bearer_token() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get(
            "/healthz",
            headers={"Authorization": f"Bearer {TEST_TOKEN}"},
        )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_healthz_rejects_missing_token_with_standard_error_envelope() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 401
    assert response.json() == {
        "error": {
            "code": "ENGINE_UNAUTHORIZED",
            "message": "Missing engine authentication token.",
            "details": {},
        }
    }


def test_healthz_rejects_invalid_token() -> None:
    app = create_app()
    with TestClient(app) as client:
        response = client.get(
            "/healthz",
            headers={"X-Engine-Token": "wrong-token-value-12345"},
        )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ENGINE_UNAUTHORIZED"


def test_boot_fails_when_engine_token_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENGINE_TOKEN", raising=False)
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        EngineSettings(_env_file=None)


def test_boot_fails_when_engine_token_is_too_short(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENGINE_TOKEN", "short")
    get_settings.cache_clear()
    with pytest.raises(ValidationError):
        EngineSettings(_env_file=None)


def test_structured_logger_redacts_sensitive_fields() -> None:
    formatter = StructuredJsonFormatter()
    record = logging.LogRecord(
        name="ordiq.engine",
        level=logging.INFO,
        pathname=__file__,
        lineno=10,
        msg="test_event",
        args=(),
        exc_info=None,
    )
    record.context = {
        "engine_token": "secret-token-value",
        "faculty_name": "Prof. Santos",
        "safe_code": "FAC-001",
    }
    output = json.loads(formatter.format(record))
    assert output["event"] == "test_event"
    assert output["context"]["engine_token"] == "[REDACTED]"
    assert output["context"]["faculty_name"] == "[REDACTED]"
    assert output["context"]["safe_code"] == "FAC-001"


def test_engine_error_handler_returns_structured_envelope() -> None:
    app = create_app()

    @app.get("/boom")
    async def boom() -> None:
        raise EngineError(
            code="SCHEDULE_NOT_FOUND",
            message="Schedule was not found.",
            status_code=404,
            details={"scheduleId": "123"},
        )

    with TestClient(app) as client:
        response = client.get("/boom")
    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "SCHEDULE_NOT_FOUND",
            "message": "Schedule was not found.",
            "details": {"scheduleId": "123"},
        }
    }
