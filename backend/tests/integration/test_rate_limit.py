"""Rate-limit middleware behaviour.

The integration tests use a fresh, low-cap limiter so we don't have to
flood the test suite with hundreds of requests.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core import ratelimit as rl_module
from app.core.config import settings


@pytest.fixture
async def low_cap_limiter():
    """Replace the singleton limiter with a fresh one + tiny cap."""
    original_public = settings.RATE_LIMIT_PUBLIC
    original_auth = settings.RATE_LIMIT_AUTHENTICATED
    original_limiter = rl_module._limiter

    settings.RATE_LIMIT_PUBLIC = 3
    settings.RATE_LIMIT_AUTHENTICATED = 5
    rl_module._limiter = rl_module.InMemoryLimiter()
    yield
    rl_module._limiter = original_limiter
    settings.RATE_LIMIT_PUBLIC = original_public
    settings.RATE_LIMIT_AUTHENTICATED = original_auth


async def test_unauthenticated_calls_hit_429_after_cap(api: AsyncClient, low_cap_limiter) -> None:
    # cap = 3; the 4th unauthenticated call should be rejected
    for _ in range(3):
        r = await api.post(
            "/api/v1/auth/login",
            json={"email": "no-such-user@example.com", "password": "x" * 8},
        )
        assert r.status_code in (401, 200)
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": "no-such-user@example.com", "password": "x" * 8},
    )
    assert r.status_code == 429
    assert r.headers.get("Retry-After") == "60"


async def test_authenticated_cap_is_higher_and_headers_exposed(
    api: AsyncClient, auth_headers: dict[str, str], low_cap_limiter
) -> None:
    r = await api.get("/api/v1/orphans?limit=1", headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["X-RateLimit-Limit"] == "5"
    assert int(r.headers["X-RateLimit-Remaining"]) >= 0
