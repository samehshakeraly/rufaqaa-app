"""Both rate-limiter backends honour the same contract."""

from __future__ import annotations

import pytest

from app.core.ratelimit import InMemoryLimiter


async def test_in_memory_allows_up_to_capacity_then_blocks() -> None:
    lim = InMemoryLimiter()
    for i in range(3):
        allowed, remaining = await lim.hit("k", 3, 60.0)
        assert allowed is True
        assert remaining == 2 - i

    allowed, _ = await lim.hit("k", 3, 60.0)
    assert allowed is False


async def test_in_memory_keys_are_isolated() -> None:
    lim = InMemoryLimiter()
    for _ in range(2):
        assert (await lim.hit("a", 2, 60.0))[0] is True
    assert (await lim.hit("a", 2, 60.0))[0] is False
    # Different key starts fresh
    assert (await lim.hit("b", 2, 60.0))[0] is True


async def test_redis_limiter_fails_open_on_connection_error() -> None:
    # Build against an unreachable host; the limiter should swallow the
    # error and let the request through (capacity returned).
    pytest.importorskip("redis")
    from app.core.ratelimit import RedisLimiter

    lim = RedisLimiter("redis://127.0.0.1:1/0")
    allowed, remaining = await lim.hit("k", 10, 60.0)
    assert allowed is True
    assert remaining == 10
