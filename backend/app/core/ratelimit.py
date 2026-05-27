"""Per-IP / per-user rate limiting.

Two backends:

  - InMemoryLimiter: per-process token bucket; fine for a single worker
    and the default in tests / dev.
  - RedisLimiter:    sliding-window counter implemented on a Redis sorted
    set via a Lua script (atomic). Shared across all workers, recommended
    for any production deployment with > 1 backend process.

Pick the backend via `RATE_LIMIT_BACKEND=memory|redis`.

/health is exempt so liveness probes never trip the limiter.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from typing import Protocol

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import settings


class Limiter(Protocol):
    async def hit(self, key: str, capacity: int, window: float) -> tuple[bool, int]: ...


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


class RedisLimiter:
    """Sliding-window counter backed by a sorted-set per key.

    Each request adds a timestamped entry and trims anything outside the
    window. The whole hit is one Lua script so reads/writes are atomic
    — no race between workers."""

    _SCRIPT = """
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local capacity = tonumber(ARGV[3])
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
    local count = redis.call('ZCARD', key)
    if count >= capacity then
      return {0, 0}
    end
    redis.call('ZADD', key, now, now)
    redis.call('EXPIRE', key, math.ceil(window))
    return {1, capacity - count - 1}
    """

    def __init__(self, url: str) -> None:
        # Import lazily so test environments without a Redis dep don't
        # have to install it just to import the module.
        import redis.asyncio as aioredis

        self._redis = aioredis.from_url(url, decode_responses=True)
        self._script = self._redis.register_script(self._SCRIPT)

    async def hit(self, key: str, capacity: int, window: float) -> tuple[bool, int]:
        now_ms = int(time.time() * 1000)
        window_ms = int(window * 1000)
        try:
            result = await self._script(
                keys=[f"rl:{key}"],
                args=[now_ms, window_ms, capacity],
            )
        except Exception:
            # Fail-open: if Redis is down, prefer letting the request
            # through over locking everyone out. The structured logger
            # already captures the underlying error.
            return True, capacity
        allowed, remaining = int(result[0]), int(result[1])
        return bool(allowed), remaining


def _build_limiter() -> Limiter:
    if settings.RATE_LIMIT_BACKEND == "redis":
        return RedisLimiter(settings.REDIS_URL)
    return InMemoryLimiter()


_limiter: Limiter = _build_limiter()


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
