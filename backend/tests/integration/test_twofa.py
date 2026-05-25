"""TOTP enrollment, verification, and disabling."""

from __future__ import annotations

import pyotp
from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.database import make_session
from app.models.user import User
from app.scripts.seed import SEED_ADMIN_EMAIL


async def _reset_admin_2fa() -> None:
    async with make_session() as db:
        await db.execute(
            update(User)
            .where(User.email == SEED_ADMIN_EMAIL)
            .values(two_factor_enabled=False, two_factor_secret=None, backup_codes=None)
        )
        await db.commit()


async def test_2fa_enroll_then_verify_flow(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    await _reset_admin_2fa()

    r = await api.post("/api/v1/auth/2fa/enroll", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    secret = body["secret"]
    assert body["otpauth_uri"].startswith("otpauth://totp/Rufaqaa:")

    code = pyotp.TOTP(secret).now()
    r = await api.post(
        "/api/v1/auth/2fa/verify",
        json={"code": code},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    backup = r.json()["backup_codes"]
    assert isinstance(backup, list) and len(backup) == 10

    # second enroll attempt is blocked while 2fa is on
    r = await api.post("/api/v1/auth/2fa/enroll", headers=auth_headers)
    assert r.status_code == 409

    # disable requires a valid current code
    bad = await api.post("/api/v1/auth/2fa/disable", json={"code": "000000"}, headers=auth_headers)
    assert bad.status_code == 400

    good = pyotp.TOTP(secret).now()
    ok = await api.post("/api/v1/auth/2fa/disable", json={"code": good}, headers=auth_headers)
    assert ok.status_code == 204

    # state is wiped
    async with make_session() as db:
        u = await db.scalar(select(User).where(User.email == SEED_ADMIN_EMAIL))
        assert u is not None
        assert u.two_factor_enabled is False
        assert u.two_factor_secret is None
        assert u.backup_codes is None


async def test_verify_without_enroll_fails(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    await _reset_admin_2fa()
    r = await api.post("/api/v1/auth/2fa/verify", json={"code": "123456"}, headers=auth_headers)
    assert r.status_code == 400
