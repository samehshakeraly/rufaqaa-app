"""Unhandled 500s must still carry CORS headers.

Starlette's built-in ServerErrorMiddleware sits OUTSIDE every user
middleware (CORS included), so without ``CatchAllExceptionMiddleware`` a
genuinely unhandled exception comes back as a bare 500 with no
``Access-Control-Allow-Origin`` header — the browser then reports it as a
CORS error and masks the real server-side fault. These tests pin the
behaviour: the catch-all converts the exception into a JSON 500 *inside*
CORS, so the CORS layer decorates the error response on the way out.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from httpx import ASGITransport, AsyncClient

from app.core.errors import CatchAllExceptionMiddleware
from app.core.logging import RequestLogMiddleware


def _build_app() -> FastAPI:
    """Mirror the middleware stack/ordering from ``app.main``."""
    app = FastAPI()

    # Same order as main.py: RequestLog, then CatchAll, then CORS (added
    # last so CORS stays outermost and decorates the catch-all's 500).
    app.add_middleware(RequestLogMiddleware)
    app.add_middleware(CatchAllExceptionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/boom")
    async def _boom() -> None:
        raise RuntimeError("kaboom")

    @app.get("/ok")
    async def _ok() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_unhandled_500_carries_cors_headers(client: AsyncClient) -> None:
    r = await client.get("/boom", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500
    # The whole point: the error response is decorated by CORS.
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert r.json() == {"detail": "Internal Server Error"}


async def test_success_still_works(client: AsyncClient) -> None:
    r = await client.get("/ok", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert r.json() == {"ok": True}
