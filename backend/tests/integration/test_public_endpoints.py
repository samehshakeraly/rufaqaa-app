"""Public, no-auth-required read endpoints.

These tests guard against accidental PII leaks — every assertion below
locks the response shape to the curated card, so a future refactor
that includes `family_name`, `date_of_birth`, or `address_details`
breaks CI.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient


async def _make_available_orphan(
    api: AsyncClient,
    headers: dict[str, str],
    extra: dict[str, object] | None = None,
) -> str:
    """Create an orphan and bump it to case_status='available' so it
    shows up on the public listing. ``extra`` is merged into the create
    payload so a test can seed profile fields (donor-safe and sensitive
    alike) and assert how the public projection filters them."""
    partner_id = (await api.get("/api/v1/partners", headers=headers)).json()["items"][0]["id"]
    suffix = uuid.uuid4().hex[:4]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"Pub{suffix}",
            "family_name": "Sensitive-Last-Name",
            "father_name": "Sensitive-Father",
            "date_of_birth": "2017-06-15",
            "gender": "F",
            "nationality": "KW",
            "partner_organization_id": partner_id,
            **(extra or {}),
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    code = r.json()["code"]

    # Drive the case status to 'available' (or 'approved') via SQL —
    # there's no admin transition endpoint exposed today.
    from sqlalchemy import text

    from app.core.database import make_session

    async with make_session() as db:
        await db.execute(
            text("UPDATE orphans SET case_status='available' WHERE code=:c"),
            {"c": code},
        )
        await db.commit()
    return code


async def test_public_orphans_returns_only_curated_fields(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    code = await _make_available_orphan(api, auth_headers)
    r = await api.get("/api/v1/public/orphans?limit=50")
    assert r.status_code == 200, r.text
    body = r.json()
    item = next(it for it in body["items"] if it["code"] == code)

    # Allowed
    allowed = {
        "code",
        "first_name",
        "age_years",
        "gender",
        "country",
        "case_status",
        "partner_organization_name",
    }
    assert set(item.keys()) == allowed

    # Belt-and-suspenders: never leak sensitive fields
    for forbidden in (
        "family_name",
        "father_name",
        "middle_name",
        "date_of_birth",
        "address",
        "address_details",
        "guardian",
        "family_id",
        "organization_id",
        "is_sponsored",
        "current_balance",
        "donor_history",
        "documents",
        "deleted_at",
    ):
        assert forbidden not in item, f"{forbidden} leaked in public response"


async def test_public_orphan_detail_exposes_donor_safe_profile(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """The detail view surfaces the humanizing, donor-safe profile slice
    (aspiration, education stage, Qur'an progress + is_hafiz, tags) while
    keeping sensitive profile data internal — even when every field is
    populated on the underlying row."""
    code = await _make_available_orphan(
        api,
        auth_headers,
        extra={
            # Donor-safe — should surface
            "aspiration": "To become a doctor",
            "education_stage": "secondary",
            "quran_juz_memorized": 30,
            "tags": ["football", "drawing"],
            # Sensitive — must stay internal
            "school_name": "Secret School",
            "academic_level": "Grade 9",
            "health_status": "good",
            "health_coverage": "government",
            "chronic_conditions": "none",
            "challenges": "Private hardship details",
            "quran_note": "Internal memorization note",
        },
    )
    r = await api.get(f"/api/v1/public/orphans/{code}")
    assert r.status_code == 200, r.text
    body = r.json()

    # Exact donor-safe shape — card fields + curated profile slice.
    assert set(body.keys()) == {
        "code",
        "first_name",
        "age_years",
        "gender",
        "country",
        "case_status",
        "partner_organization_name",
        "short_description",
        "aspiration",
        "education_stage",
        "quran_juz_memorized",
        "is_hafiz",
        "tags",
    }

    # Donor-safe values are returned as stored.
    assert body["code"] == code
    assert body["aspiration"] == "To become a doctor"
    assert body["education_stage"] == "secondary"
    assert body["quran_juz_memorized"] == 30
    assert body["is_hafiz"] is True
    assert body["tags"] == ["football", "drawing"]

    # Sensitive profile + identity fields are NEVER present in the public schema.
    for forbidden in (
        "school_name",
        "academic_level",
        "health_status",
        "health_coverage",
        "chronic_conditions",
        "challenges",
        "quran_note",
        "family_name",
        "father_name",
        "middle_name",
        "date_of_birth",
        "family_id",
        "organization_id",
    ):
        assert forbidden not in body, f"{forbidden} leaked in public detail response"


async def test_public_orphan_detail_is_hafiz_false_when_partial(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """is_hafiz is derived from quran_juz_memorized == 30; a partial
    memorizer surfaces the count but is not flagged a hafiz."""
    code = await _make_available_orphan(api, auth_headers, extra={"quran_juz_memorized": 5})
    r = await api.get(f"/api/v1/public/orphans/{code}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["quran_juz_memorized"] == 5
    assert body["is_hafiz"] is False


async def test_public_orphan_detail_hides_pending_review(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A freshly-created orphan defaults to 'pending_review' — it must
    NOT show up on the public endpoints."""
    partner_id = (await api.get("/api/v1/partners", headers=auth_headers)).json()["items"][0]["id"]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"Hide{uuid.uuid4().hex[:4]}",
            "family_name": "x",
            "date_of_birth": "2018-01-01",
            "gender": "M",
            "nationality": "KW",
            "father_name": "Test Father",
            "partner_organization_id": partner_id,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    code = r.json()["code"]

    r = await api.get(f"/api/v1/public/orphans/{code}")
    assert r.status_code == 404


async def test_public_orphans_filters_by_country(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    await _make_available_orphan(api, auth_headers)
    r = await api.get("/api/v1/public/orphans?country=KW&limit=50")
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert it["country"] == "KW"

    r = await api.get("/api/v1/public/orphans?country=ZZ")
    assert r.status_code == 200
    assert all(it["country"] != "KW" for it in r.json()["items"])


async def test_public_stats_returns_numbers_only(api: AsyncClient) -> None:
    r = await api.get("/api/v1/public/stats")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {
        "orphans_available",
        "orphans_sponsored",
        "donors_total",
        "countries_served",
    }
    for v in body.values():
        assert isinstance(v, int)
        assert v >= 0


async def test_public_endpoints_require_no_auth(api: AsyncClient) -> None:
    """No Authorization header anywhere on these paths."""
    for path in (
        "/api/v1/public/orphans",
        "/api/v1/public/orphans?limit=5",
        "/api/v1/public/stats",
    ):
        r = await api.get(path)
        assert r.status_code in (200, 404), f"{path} → {r.status_code}: {r.text}"
