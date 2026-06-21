import uuid

from httpx import AsyncClient

from app.core.crypto import decrypt_field
from app.core.database import make_session
from app.models.family import Guardian


async def test_family_with_guardians_full_roundtrip(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/families",
        json={
            "family_name": f"عائلة-{suffix}",
            "country_code": "KW",
            "city": "Kuwait City",
            "housing_status": "rented",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    family = r.json()
    fid = family["id"]
    assert family["code"].startswith("FAM-")

    r = await api.get(f"/api/v1/families/{fid}", headers=auth_headers)
    assert r.status_code == 200

    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={
            "full_name": "أم اليتيم",
            "relation": "mother",
            "phone": "+96599887766",
            "literacy_level": "medium",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    guardian = r.json()
    assert guardian["family_id"] == fid

    r = await api.get(f"/api/v1/families/{fid}/guardians", headers=auth_headers)
    assert r.status_code == 200
    page = r.json()
    assert page["total"] >= 1
    assert any(g["id"] == guardian["id"] for g in page["items"])


async def test_guardian_create_404_for_unknown_family(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    bogus = str(uuid.uuid4())
    r = await api.post(
        f"/api/v1/families/{bogus}/guardians",
        json={"full_name": "x", "relation": "mother"},
        headers=auth_headers,
    )
    assert r.status_code == 404


async def test_guardian_national_id_encrypted_at_rest_decrypted_on_read(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """national_id is encrypted at rest (national_id_encrypted holds the token;
    the plaintext column was dropped in 0020) yet the staff create and list reads
    return the decrypted value — never the ciphertext."""
    suffix = uuid.uuid4().hex[:6]
    national_id = "29900112233445"
    r = await api.post(
        "/api/v1/families",
        json={"family_name": f"عائلة-{suffix}", "country_code": "EG"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]

    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={"full_name": "ولي الأمر", "relation": "father", "national_id": national_id},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    # Decrypt-on-read: the create response carries the plaintext id back.
    assert created["national_id"] == national_id
    guardian_id = created["id"]

    # At rest: only the ciphertext is stored (no plaintext column exists), and it
    # is present and decryptable back to the submitted id.
    async with make_session() as db:
        guardian = await db.get(Guardian, uuid.UUID(guardian_id))
        assert guardian is not None
        assert guardian.national_id_encrypted is not None
        assert decrypt_field(guardian.national_id_encrypted) == national_id

    # The list read decrypts on read too.
    r = await api.get(f"/api/v1/families/{fid}/guardians", headers=auth_headers)
    assert r.status_code == 200
    listed = next(g for g in r.json()["items"] if g["id"] == guardian_id)
    assert listed["national_id"] == national_id


async def test_guardian_create_without_national_id_returns_null(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Omitting national_id leaves national_id_encrypted NULL and the read
    returns null — no ciphertext is fabricated for an absent id."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/families",
        json={"family_name": f"عائلة-{suffix}", "country_code": "KW"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]

    r = await api.post(
        f"/api/v1/families/{fid}/guardians",
        json={"full_name": "بدون هوية", "relation": "mother"},
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["national_id"] is None
    async with make_session() as db:
        guardian = await db.get(Guardian, uuid.UUID(created["id"]))
        assert guardian is not None
        assert guardian.national_id_encrypted is None
