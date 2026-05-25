"""structlog configuration and request-id propagation.

Every request gets a request_id (read from the X-Request-ID header if
the caller supplied one, else generated). Loggers grab it from a context
var, so any log line within a request — from middleware, handler, or
worker callback — carries the same id.
"""

from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import settings

_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def _inject_request_id(_logger, _name, event_dict):
    rid = _request_id_var.get()
    if rid:
        event_dict["request_id"] = rid
    return event_dict


def configure_logging() -> None:
    level = getattr(logging, settings.LOG_LEVEL, logging.INFO)
    logging.basicConfig(level=level, format="%(message)s")

    renderer = (
        structlog.processors.JSONRenderer()
        if settings.LOG_FORMAT == "json"
        else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _inject_request_id,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


_log = structlog.get_logger("rufaqaa.http")


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Logs one structured line per request with timing and status."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint):
        rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        token = _request_id_var.set(rid)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - started) * 1000
            _log.error(
                "request_failed",
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration_ms, 2),
            )
            _request_id_var.reset(token)
            raise

        duration_ms = (time.perf_counter() - started) * 1000
        # The dev stack proxies through Vite; keep the log compact.
        _log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration_ms, 2),
        )
        response.headers["X-Request-ID"] = rid
        _request_id_var.reset(token)
        return response
