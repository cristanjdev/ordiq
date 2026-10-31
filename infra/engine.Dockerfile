FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.6.3 /uv /uvx /bin/

COPY services/engine/pyproject.toml services/engine/README.md ./
COPY services/engine/engine ./engine

RUN uv sync --no-dev

RUN useradd --create-home --shell /bin/bash ordiq && chown -R ordiq:ordiq /app
USER ordiq

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "engine.main:app", "--host", "0.0.0.0", "--port", "8000"]

