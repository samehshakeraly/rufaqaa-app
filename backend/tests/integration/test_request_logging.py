"""The request-id middleware should always emit X-Request-ID, and echo
the caller's value when one is supplied."""

from httpx import AsyncClient


async def test_request_id_generated_when_missing(api: AsyncClient) -> None:
    r = await api.get("/api/v1/health")
    assert r.status_code == 200
    rid = r.headers.get("X-Request-ID")
    assert rid and len(rid) >= 16


async def test_request_id_echoed_when_supplied(api: AsyncClient) -> None:
    rid = "test-rid-abcdef"
    r = await api.get("/api/v1/health", headers={"X-Request-ID": rid})
    assert r.status_code == 200
    assert r.headers["X-Request-ID"] == rid
