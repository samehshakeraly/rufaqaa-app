"""Coverage for the new payments / reports / cancel tools.

All scenarios mock the HTTP layer with respx, so no live backend is needed.
"""

from __future__ import annotations

import httpx
import respx

from rufaqaa_mcp.client import RufaqaaClient

BASE = "http://api.test/api/v1"


def _client() -> RufaqaaClient:
    return RufaqaaClient(base_url=BASE, email="u@e.test", password="x" * 10)


def _mock_login() -> None:
    respx.post(f"{BASE}/auth/login").mock(
        return_value=httpx.Response(
            200, json={"access_token": "t", "refresh_token": "r"}
        )
    )


@respx.mock
async def test_cancel_sponsorship_passes_reason() -> None:
    _mock_login()
    route = respx.post(f"{BASE}/sponsorships/sp-1/cancel").mock(
        return_value=httpx.Response(200, json={"id": "sp-1", "status": "cancelled"})
    )
    c = _client()
    try:
        out = await c.cancel_sponsorship("sp-1", reason="moved abroad")
        assert out["status"] == "cancelled"
        body = route.calls.last.request.content.decode()
        assert '"reason":"moved abroad"' in body
    finally:
        await c.aclose()


@respx.mock
async def test_record_payment_serialises_optional_sponsorship() -> None:
    _mock_login()
    route = respx.post(f"{BASE}/payments").mock(
        return_value=httpx.Response(201, json={"id": "pay-1", "code": "PAY-X"})
    )
    c = _client()
    try:
        out = await c.record_payment(
            donor_id="d-1",
            amount="25.00",
            currency="KWD",
            payment_method="cash",
            sponsorship_id="sp-1",
        )
        assert out["code"] == "PAY-X"
        body = route.calls.last.request.content.decode()
        assert '"sponsorship_id":"sp-1"' in body
        assert '"payment_method":"cash"' in body
    finally:
        await c.aclose()


@respx.mock
async def test_record_payment_omits_sponsorship_when_none() -> None:
    _mock_login()
    route = respx.post(f"{BASE}/payments").mock(
        return_value=httpx.Response(201, json={"id": "pay-2"})
    )
    c = _client()
    try:
        await c.record_payment(
            donor_id="d-1",
            amount="10.00",
            currency="KWD",
            payment_method="cash",
        )
        body = route.calls.last.request.content.decode()
        assert "sponsorship_id" not in body
    finally:
        await c.aclose()


@respx.mock
async def test_list_reports_filters() -> None:
    _mock_login()
    route = respx.get(f"{BASE}/reports").mock(
        return_value=httpx.Response(
            200, json={"items": [], "total": 0, "limit": 20, "offset": 0}
        )
    )
    c = _client()
    try:
        await c.list_reports(orphan_id="o-1", status="published_to_donor")
        url = str(route.calls.last.request.url)
        assert "orphan_id=o-1" in url
        assert "status=published_to_donor" in url
    finally:
        await c.aclose()


@respx.mock
async def test_transition_report_posts_to_action_path() -> None:
    _mock_login()
    route = respx.post(f"{BASE}/reports/rep-1/publish").mock(
        return_value=httpx.Response(
            200, json={"id": "rep-1", "status": "published_to_donor"}
        )
    )
    c = _client()
    try:
        out = await c.transition_report("rep-1", "publish")
        assert out["status"] == "published_to_donor"
        assert route.called
    finally:
        await c.aclose()
