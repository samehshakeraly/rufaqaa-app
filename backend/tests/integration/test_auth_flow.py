from httpx import AsyncClient


async def test_login_and_me(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/auth/me", headers=auth_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "admin@dev.rufaqaa.app"
    assert body["role"] == "org_admin"


async def test_login_wrong_password(api: AsyncClient) -> None:
    r = await api.post(
        "/api/v1/auth/login",
        json={"email": "admin@dev.rufaqaa.app", "password": "wrong_password"},
    )
    assert r.status_code == 401


async def test_me_requires_token(api: AsyncClient) -> None:
    r = await api.get("/api/v1/auth/me")
    assert r.status_code == 401
