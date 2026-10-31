"""Structured JSON logger for the ORDIQ engine.

Follows Engineering Standards (Section 4):
- Structured JSON output
- Never logs personal data, message content, or tokens
"""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

REDACTED_KEYS = frozenset(
    {
        "token",
        "engine_token",
        "x-engine-token",
        "authorization",
        "password",
        "secret",
        "api_key",
        "name",
        "faculty_name",
        "content",
        "message",
    }
)


def _sanitize_mapping(data: dict[str, Any]) -> dict[str, Any]:
    sanitized: dict[str, Any] = {}
    for key, value in data.items():
        if key.lower() in REDACTED_KEYS:
            sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = _sanitize_mapping(value)
        else:
            sanitized[key] = value
    return sanitized


class StructuredJsonFormatter(logging.Formatter):
    """Formats log records as single-line JSON objects."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "service": "ordiq-engine",
            "logger": record.name,
            "event": record.getMessage(),
        }
        extra_context = getattr(record, "context", None)
        if isinstance(extra_context, dict):
            payload["context"] = _sanitize_mapping(extra_context)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logger(level: str = "INFO") -> logging.Logger:
    """Configure and return the root application logger."""
    logger = logging.getLogger("ordiq.engine")
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


logger = configure_logger()

