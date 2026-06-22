"""Orphan profile fields + tags round-trip on create + read (migration 0008).

Asserts the optional education/Qur'an/health/tags fields persist through the
shared create path and surface on the read model, and that the computed
``is_hafiz`` flag flips on only when all 30 juz' are memorised.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def test_profile_fields_round_trip_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]

    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"ملف-{suffix}",
            "family_name": "كامل",
            "date_of_birth": "2014-03-01",
            "gender": "F",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
            "education_stage": "primary",
            "academic_level": "good",
            "school_name": "Al-Noor School",
            "quran_juz_memorized": 5,
            "quran_note": "Memorising Surah Al-Baqarah",
            "health_status": "good",
            "health_coverage": "government",
            "chronic_conditions": None,
            "aspiration": "To become a doctor",
            "challenges": "Needs glasses",
            "tags": ["top_student", "needs_glasses"],
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["education_stage"] == "primary"
    assert body["academic_level"] == "good"
    assert body["school_name"] == "Al-Noor School"
    assert body["quran_juz_memorized"] == 5
    assert body["quran_note"] == "Memorising Surah Al-Baqarah"
    assert body["health_status"] == "good"
    assert body["health_coverage"] == "government"
    assert body["aspiration"] == "To become a doctor"
    assert body["challenges"] == "Needs glasses"
    assert body["tags"] == ["top_student", "needs_glasses"]
    # Computed, not stored: 5 juz' is not a hafiz.
    assert body["is_hafiz"] is False

    # Re-read independently to confirm the values were persisted, not echoed.
    got = await api.get(f"/api/v1/orphans/{body['id']}", headers=auth_headers)
    assert got.status_code == 200, got.text
    read = got.json()
    assert read["education_stage"] == "primary"
    assert read["quran_juz_memorized"] == 5
    assert read["tags"] == ["top_student", "needs_glasses"]
    assert read["is_hafiz"] is False


async def test_tags_default_empty_and_is_hafiz_when_full_quran(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]

    # No profile fields supplied: tags defaults to [], is_hafiz is False.
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"افتراضي-{suffix}",
            "family_name": "فارغ",
            "date_of_birth": "2016-06-01",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["tags"] == []
    assert body["quran_juz_memorized"] is None
    assert body["is_hafiz"] is False

    # A child who has memorised all 30 juz' IS a hafiz.
    suffix2 = uuid.uuid4().hex[:6]
    r2 = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"حافظ-{suffix2}",
            "family_name": "كامل",
            "date_of_birth": "2010-01-01",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix2}",
            "quran_juz_memorized": 30,
        },
        headers=auth_headers,
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["is_hafiz"] is True


async def _create_orphan(
    api: AsyncClient, auth_headers: dict[str, str], partner_id: str, **extra: object
) -> int:
    """POST a minimal-but-unique orphan with ``extra`` merged in; return the
    HTTP status (so callers can assert 201 accepted / 422 rejected)."""
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"قيم-{suffix}",
            "family_name": "مدى",
            "date_of_birth": "2015-02-02",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
            **extra,
        },
        headers=auth_headers,
    )
    return r.status_code


async def test_education_stage_coded_set_enforced_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """education_stage accepts exactly the five coded values; anything else
    (including the now-removed 'university'/'not_enrolled') is a 422."""
    partner_id = await _seed_partner_id()
    for value in ("pre_kindergarten", "kindergarten", "primary", "preparatory", "secondary"):
        assert await _create_orphan(api, auth_headers, partner_id, education_stage=value) == 201, (
            value
        )
    for value in ("not_enrolled", "university", "vocational", "graduated", "phd", ""):
        assert await _create_orphan(api, auth_headers, partner_id, education_stage=value) == 422, (
            value
        )


async def test_academic_level_coded_set_enforced_on_create(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """academic_level is now a coded weak/good/excellent band; the old free
    text (e.g. 'Grade 4') is rejected with a 422."""
    partner_id = await _seed_partner_id()
    for value in ("weak", "good", "excellent"):
        assert await _create_orphan(api, auth_headers, partner_id, academic_level=value) == 201, (
            value
        )
    for value in ("Grade 4", "average", "GOOD", ""):
        assert await _create_orphan(api, auth_headers, partner_id, academic_level=value) == 422, (
            value
        )
