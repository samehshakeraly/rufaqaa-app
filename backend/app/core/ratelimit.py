"""Per-IP / per-user rate limiting.

A tiny in-memory token bucket implementation. It's fine for a single
worker process; for multi-worker production deployments swap the
in-process counters for Redis (the abstraction below is structured to
make that mechanical).

The middleware is intentionally lenient on routes the client doesn't
control well: /health is exempt so liveness probes never trip the
limiter.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import settings

EXEMPT_PREFIXES = ("/api/v1/health", "/docs", "/redoc", "/openapi.json", "/")


@dataclass
class Bucket:
    """Sliding-window counter — keeps timestamps in a deque."""

    capacity: int
    window_seconds: float
    timestamps: deque[float]


class InMemoryLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, Bucket] = {}
        self._lock = asyncio.Lock()

    async def hit(self, key: str, capacity: int, window: float) -> tuple[bool, int]:
        """Returns (allowed, remaining)."""
        now = time.monotonic()
        async with self._lock:
            b = self._buckets.get(key)
            if b is None or b.capacity != capacity:
                b = Bucket(capacity=capacity, window_seconds=window, timestamps=deque())
                self._buckets[key] = b
            cutoff = now - window
            while b.timestamps and b.timestamps[0] < cutoff:
                b.timestamps.popleft()
            if len(b.timestamps) >= capacity:
                return False, 0
            b.timestamps.append(now)
            return True, capacity - len(b.timestamps)


_limiter = InMemoryLimiter()


def _client_key(request: Request) -> tuple[str, int]:
    """Identify the caller and return (key, per-minute limit)."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        # Authenticated requests get the higher allowance. We use the
        # token's first 24 chars as the identity (it's already unique per
        # session and avoids decoding the JWT in middleware).
        return f"u:{auth[7:31]}", settings.RATE_LIMIT_AUTHENTICATED
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}", settings.RATE_LIMIT_PUBLIC


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Enforces per-minute request caps. Exempts health + docs paths."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint):
        # Read the toggle each request so tests can flip it at runtime.
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        path = request.url.path
        if any(path.startswith(p) for p in EXEMPT_PREFIXES) and path != "/api/v1":
            # Plain "/" and the docs always go through.
            if path in ("/", *EXEMPT_PREFIXES[1:]) or path.startswith("/api/v1/health"):
                return await call_next(request)

        key, capacity = _client_key(request)
        allowed, remaining = await _limiter.hit(key, capacity, 60.0)
        if not allowed:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded"},
                headers={"Retry-After": "60"},
            )
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(capacity)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
