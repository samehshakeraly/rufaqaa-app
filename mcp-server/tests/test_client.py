"""HTTP client tests against a mocked Rufaqaa REST API (respx).

These tests do not require a running backend — respx intercepts httpx
requests at the transport layer.
"""

from __future__ import annotations

import httpx
import respx

from rufaqaa_mcp.client import RufaqaaClient

BASE = "http://api.test/api/v1"


def _client() -> RufaqaaClient:
    return RufaqaaClient(base_url=BASE, email="u@e.test", password="x" * 10)


@respx.mock
async def test_logs_in_lazily_on_first_call() -> None:
    login = respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(
            200, json={"access_token": "tok", "refresh_token": "r", "token_type": "bearer"}
        )
    )
    orphans = respx.get(f"{BASE}/orphans").mock(
        return_value=httpx.Response(
            200, json={"items": [], "total": 0, "limit": 20, "offset": 0}
        )
    )
    c = _client()
    try:
        page = await c.list_orphans()
        assert page == {"items": [], "total": 0, "limit": 20, "offset": 0}
        assert login.called
        assert orphans.calls.last.request.headers.get("authorization") == "Bearer tok"
    finally:
        await c.aclose()


@respx.mock
async def test_retries_after_401() -> None:
    respx.post(f"{BASE}/auth/login").mock(
        side_effect=[
            httpx.Response(200, json={"access_token": "stale", "refresh_token": "r"}),
            httpx.Response(200, json={"access_token": "fresh", "refresh_token": "r"}),
        ]
    )
    orphans_route = respx.get(f"{BASE}/orphans").mock(
        side_effect=[
            httpx.Response(401, json={"detail": "Invalid"}),
            httpx.Response(
                200, json={"items": [{"id": "x"}], "total": 1, "limit": 20, "offset": 0}
            ),
        ]
    )
    c = _client()
    try:
        page = await c.list_orphans()
        assert page["total"] == 1
        assert orphans_route.call_count == 2
        last_auth = orphans_route.calls.last.request.headers.get("authorization")
        assert last_auth == "Bearer fresh"
    finally:
        await c.aclose()


@respx.mock
async def test_create_sponsorship_sends_payload() -> None:
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(200, json={"access_token": "t", "refresh_token": "r"})
    )
    route = respx.post(f"{BASE}/sponsorships").mock(
        return_value=httpx.Response(201, json={"id": "sp-1", "code": "KAF-XXXXXX"})
    )
    c = _client()
    try:
        out = await c.create_sponsorship(
            donor_id="d-1",
            orphan_id="o-1",
            monthly_amount="25.00",
            currency="KWD",
            start_date="2026-06-01",
        )
        assert out == {"id": "sp-1", "code": "KAF-XXXXXX"}
        body = route.calls.last.request.content.decode()
        assert '"monthly_amount":"25.00"' in body
        assert '"payment_frequency":"monthly"' in body
    finally:
        await c.aclose()
