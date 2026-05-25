"""Thin async HTTP client around the Rufaqaa REST API.

Re-authenticates automatically on 401 once per call, so a stale access
token (after the JWT TTL elapses) doesn't surface to MCP callers.
"""

from typing import Any

import httpx

from rufaqaa_mcp.config import settings


class RufaqaaClient:
    def __init__(
        self,
        base_url: str | None = None,
        email: str | None = None,
        password: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self._base_url = (base_url or settings.api_url).rstrip("/")
        self._email = email or settings.api_email
        self._password = password or settings.api_password
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout or settings.http_timeout_seconds,
        )
        self._access_token: str | None = None

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _login(self) -> str:
        r = await self._http.post(
            "/auth/login",
            json={"email": self._email, "password": self._password},
        )
        r.raise_for_status()
        token = str(r.json()["access_token"])
        self._access_token = token
        return token

    def _auth_headers(self) -> dict[str, str]:
        if self._access_token is None:
            return {}
        return {"Authorization": f"Bearer {self._access_token}"}

    async def _request(
        self, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        if self._access_token is None:
            await self._login()
        headers = {**self._auth_headers(), **kwargs.pop("headers", {})}
        r = await self._http.request(method, path, headers=headers, **kwargs)
        if r.status_code == 401:
            await self._login()
            headers = {**self._auth_headers(), **kwargs.pop("headers", {})}
            r = await self._http.request(method, path, headers=headers, **kwargs)
        return r

    async def list_orphans(
        self,
        limit: int = 20,
        offset: int = 0,
        case_status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if case_status:
            params["case_status"] = case_status
        r = await self._request("GET", "/orphans", params=params)
        r.raise_for_status()
        return r.json()

    async def get_orphan(self, orphan_id: str) -> dict[str, Any]:
        r = await self._request("GET", f"/orphans/{orphan_id}")
        r.raise_for_status()
        return r.json()

    async def list_donors(self, limit: int = 20, offset: int = 0) -> dict[str, Any]:
        r = await self._request("GET", "/donors", params={"limit": limit, "offset": offset})
        r.raise_for_status()
        return r.json()

    async def list_sponsorships(
        self,
        limit: int = 20,
        offset: int = 0,
        donor_id: str | None = None,
        orphan_id: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if donor_id:
            params["donor_id"] = donor_id
        if orphan_id:
            params["orphan_id"] = orphan_id
        if status:
            params["status"] = status
        r = await self._request("GET", "/sponsorships", params=params)
        r.raise_for_status()
        return r.json()

    async def create_sponsorship(
        self,
        donor_id: str,
        orphan_id: str,
        monthly_amount: str,
        currency: str,
        start_date: str,
        payment_frequency: str = "monthly",
    ) -> dict[str, Any]:
        payload = {
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": monthly_amount,
            "currency": currency,
            "start_date": start_date,
            "payment_frequency": payment_frequency,
        }
        r = await self._request("POST", "/sponsorships", json=payload)
        r.raise_for_status()
        return r.json()

    async def cancel_sponsorship(
        self, sponsorship_id: str, reason: str | None = None
    ) -> dict[str, Any]:
        r = await self._request(
            "POST",
            f"/sponsorships/{sponsorship_id}/cancel",
            json={"reason": reason},
        )
        r.raise_for_status()
        return r.json()

    async def list_payments(
        self,
        limit: int = 20,
        offset: int = 0,
        donor_id: str | None = None,
        sponsorship_id: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if donor_id:
            params["donor_id"] = donor_id
        if sponsorship_id:
            params["sponsorship_id"] = sponsorship_id
        if status:
            params["status"] = status
        r = await self._request("GET", "/payments", params=params)
        r.raise_for_status()
        return r.json()

    async def record_payment(
        self,
        donor_id: str,
        amount: str,
        currency: str,
        payment_method: str,
        sponsorship_id: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "donor_id": donor_id,
            "amount": amount,
            "currency": currency,
            "payment_method": payment_method,
        }
        if sponsorship_id:
            payload["sponsorship_id"] = sponsorship_id
        r = await self._request("POST", "/payments", json=payload)
        r.raise_for_status()
        return r.json()

    async def list_reports(
        self,
        limit: int = 20,
        offset: int = 0,
        orphan_id: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if orphan_id:
            params["orphan_id"] = orphan_id
        if status:
            params["status"] = status
        r = await self._request("GET", "/reports", params=params)
        r.raise_for_status()
        return r.json()

    async def transition_report(self, report_id: str, action: str) -> dict[str, Any]:
        r = await self._request("POST", f"/reports/{report_id}/{action}", json={})
        r.raise_for_status()
        return r.json()
