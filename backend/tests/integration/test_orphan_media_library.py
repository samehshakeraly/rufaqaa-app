"""Orphan media-library tests (PR-4) — donor-safe categorized media.

Covers the sensitive core: a piece of media reaches a donor ONLY when it is
approved, donor-facing, and (for the consent-gated categories) consented — every
gate enforced server-side in the composed donor profile. Also exercises the
staff upload/list/patch surface and migration 0024 reversibility.

Donor-exposure scenarios insert media rows directly (no S3 needed): the donor
endpoint only presigns ``file_url`` (a purely local boto3 signing op), so an
``s3://`` reference resolves to a URL without a live bucket. The two upload
validation cases (415/413) fail BEFORE any S3 call, so they need no bucket
either.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

_BACKEND_DIR = Path(__file__).resolve().parents[2]

# The EXACT donor-safe slice of one media item. Anything outside this set —
# especially the storage key, consent document, moderation internals, uploader
# or org — is a leak.
_MEDIA_ITEM_FIELDS = {
    "id",
    "title",
    "caption",
    "display_date",
    "url",
    "thumbnail_url",
    "duration_seconds",
    "width",
    "height",
}
_MEDIA_FORBIDDEN = {
    "file_url",
    "organization_id",
    "orphan_id",
    "consent_document_id",
    "moderation_status",
    "moderation_notes",
    "has_guardian_consent",
    "uploaded_by",
    "moderated_by",
    "visibility",
    "report_id",
    "category",
}


# ── shared setup helpers ───────────────────────────────────────────────────────


async def _partner_id(api: AsyncClient, headers: dict[str, str]) -> str:
    row = (await api.get("/api/v1/partners?limit=1", headers=headers)).json()
    return str(row["items"][0]["id"])


async def _my_org_id(api: AsyncClient, headers: dict[str, str]) -> str:
    me = (await api.get("/api/v1/auth/me", headers=headers)).json()
    return str(me["organization_id"])


async def _make_orphan(api: AsyncClient, admin_headers: dict[str, str], partner_id: str) -> str:
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"media-{suffix}",
            "family_name": "Secret",
            "date_of_birth": "2015-03-01",
            "gender": "F",
            "nationality": "KW",
            "father_name": f"father-{suffix}",
            "partner_organization_id": partner_id,
            "aspiration": "doctor",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _signup_donor(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, dict[str, str]]:
    suffix = uuid.uuid4().hex[:8]
    email = f"d-{suffix}@example.com"
    password = "longenoughpw1"

    r = await api.post(
        "/api/v1/donors",
        json={"full_name": f"Test Donor {suffix}", "email": email},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    donor_id = str(r.json()["id"])

    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": "Test", "last_name": "Donor", "role": "donor"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    invite_token = r.json()["invite_token"]
    user_id = str(r.json()["user"]["id"])

    r = await api.post(
        "/api/v1/users/accept-invite",
        json={"token": invite_token, "password": password},
    )
    assert r.status_code == 200, r.text

    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async with make_session() as db:
        await db.execute(
            text("UPDATE donors SET user_id = :uid WHERE id = :did"),
            {"uid": user_id, "did": donor_id},
        )
        await db.commit()
    return donor_id, headers


async def _activate_sponsorship(
    api: AsyncClient, admin_headers: dict[str, str], donor_id: str, orphan_id: str
) -> None:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "10.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    sp_id = str(r.json()["id"])
    await api.post(f"/api/v1/sponsorships/{sp_id}/activate", headers=admin_headers)


async def _insert_media(
    orphan_id: str,
    org_id: str,
    *,
    category: str,
    moderation_status: str,
    visibility: str,
    has_guardian_consent: bool = False,
    media_type: str = "photo",
    duration_seconds: int | None = None,
) -> str:
    """Drop one media row straight into the table — no S3 needed."""
    media_id = uuid.uuid4()
    async with make_session() as db:
        await db.execute(
            text("SELECT set_config('app.current_org_id', :v, true)"),
            {"v": org_id},
        )
        await db.execute(
            text(
                """
                INSERT INTO media
                    (id, organization_id, orphan_id, media_type, category,
                     title, description, file_url, file_size_bytes, duration_seconds,
                     moderation_status, visibility, has_guardian_consent, created_at)
                VALUES
                    (:id, :org, :orphan, :mtype, :cat,
                     :title, :descr, :url, :size, :dur,
                     :mstatus, :vis, :consent, :now)
                """
            ),
            {
                "id": str(media_id),
                "org": org_id,
                "orphan": orphan_id,
                "mtype": media_type,
                "cat": category,
                "title": f"{category} title",
                "descr": f"{category} caption",
                "url": f"s3://rufaqaa-private/orphans/{orphan_id}/{category}/{media_id.hex}.bin",
                "size": 1234,
                "dur": duration_seconds,
                "mstatus": moderation_status,
                "vis": visibility,
                "consent": has_guardian_consent,
                "now": datetime.now(UTC),
            },
        )
        await db.commit()
    return str(media_id)


async def _profile(api: AsyncClient, donor_headers: dict[str, str], orphan_id: str) -> dict:
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=donor_headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


async def _sponsored(
    api: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, str, dict[str, str]]:
    """(orphan_id, org_id, donor_headers) with an active sponsorship."""
    partner_id = await _partner_id(api, admin_headers)
    org_id = await _my_org_id(api, admin_headers)
    donor_id, donor_headers = await _signup_donor(api, admin_headers)
    orphan_id = await _make_orphan(api, admin_headers, partner_id)
    await _activate_sponsorship(api, admin_headers, donor_id, orphan_id)
    return orphan_id, org_id, donor_headers


# ── donor exposure ─────────────────────────────────────────────────────────────


async def test_donor_sees_approved_donor_only_grouped(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="donor_only"
    )
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="public"
    )
    await _insert_media(
        orphan_id,
        org_id,
        category="certificate",
        moderation_status="approved",
        visibility="donor_only",
    )

    media = (await _profile(api, donor_headers, orphan_id))["media"]
    assert media is not None
    assert len(media["drawings"]) == 2
    assert len(media["certificates"]) == 1
    assert media["album"] == []
    assert media["recitations"] == []

    item = media["drawings"][0]
    assert set(item.keys()) == _MEDIA_ITEM_FIELDS
    for forbidden in _MEDIA_FORBIDDEN:
        assert forbidden not in item, f"forbidden field '{forbidden}' leaked"
    assert item["url"].startswith("http")
    assert item["caption"] == "drawing caption"
    assert item["display_date"]


async def test_non_donor_facing_items_are_omitted(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """private / archived / pending / rejected all drop out; only the
    approved+donor-facing drawing survives."""
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="donor_only"
    )
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="private"
    )
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="archived"
    )
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="pending", visibility="donor_only"
    )
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="rejected", visibility="donor_only"
    )

    media = (await _profile(api, donor_headers, orphan_id))["media"]
    assert media is not None
    assert len(media["drawings"]) == 1


async def test_consent_gate_album(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    """An album photo is consent-gated: omitted without consent, surfaced with
    it (toggled through the staff PATCH endpoint)."""
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    media_id = await _insert_media(
        orphan_id,
        org_id,
        category="album",
        moderation_status="approved",
        visibility="donor_only",
        has_guardian_consent=False,
    )
    assert (await _profile(api, donor_headers, orphan_id))["media"] is None

    r = await api.patch(
        f"/api/v1/media/{media_id}",
        json={"has_guardian_consent": True},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    media = (await _profile(api, donor_headers, orphan_id))["media"]
    assert media is not None
    assert len(media["album"]) == 1


async def test_consent_gate_recitation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    no_consent = await _insert_media(
        orphan_id,
        org_id,
        category="recitation",
        media_type="audio",
        moderation_status="approved",
        visibility="donor_only",
        has_guardian_consent=False,
        duration_seconds=42,
    )
    assert (await _profile(api, donor_headers, orphan_id))["media"] is None

    await _insert_media(
        orphan_id,
        org_id,
        category="recitation",
        media_type="audio",
        moderation_status="approved",
        visibility="donor_only",
        has_guardian_consent=True,
        duration_seconds=42,
    )
    media = (await _profile(api, donor_headers, orphan_id))["media"]
    assert media is not None
    assert len(media["recitations"]) == 1
    assert media["recitations"][0]["duration_seconds"] == 42
    # the un-consented one never appears
    assert all(item["id"] != no_consent for item in media["recitations"])


async def test_portrait_never_surfaced_in_block(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """``portrait`` is the identity photo — even approved+donor_only+consented it
    is never one of the four donor-library groups, so the block stays None."""
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    await _insert_media(
        orphan_id,
        org_id,
        category="portrait",
        moderation_status="approved",
        visibility="donor_only",
        has_guardian_consent=True,
    )
    assert (await _profile(api, donor_headers, orphan_id))["media"] is None


async def test_media_element_hidden_drops_block(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id, org_id, donor_headers = await _sponsored(api, auth_headers)
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="donor_only"
    )
    # baseline: block present, dream present
    body = await _profile(api, donor_headers, orphan_id)
    assert body["media"] is not None
    assert body["dream"] is not None

    r = await api.put(
        f"/api/v1/orphans/{orphan_id}/profile-visibility",
        json={"visibility": {"media": False}},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    body = await _profile(api, donor_headers, orphan_id)
    assert body["media"] is None
    # other blocks unaffected
    assert body["dream"] is not None


async def test_nonsponsor_donor_cannot_see_media(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A donor who does not sponsor this orphan 404s — no media, no existence
    leak — even though donor-facing media exists."""
    orphan_id, org_id, _ = await _sponsored(api, auth_headers)
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="approved", visibility="donor_only"
    )
    _, outsider_headers = await _signup_donor(api, auth_headers)
    r = await api.get(f"/api/v1/me/sponsorships/{orphan_id}/profile", headers=outsider_headers)
    assert r.status_code == 404


# ── staff surface ──────────────────────────────────────────────────────────────


async def _other_org_admin(api: AsyncClient) -> dict[str, str]:
    suffix = uuid.uuid4().hex[:6]
    email = f"otherorg-{suffix}@example.com"
    password = "otherorgpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OML-{suffix}",
            name_ar=f"منظمة-{suffix}",
            name_en=f"Org {suffix}",
            org_type="standalone",
            country_code="KW",
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)
        db.add(
            User(
                organization_id=org.id,
                email=email,
                password_hash=hash_password(password),
                first_name="Other",
                last_name="Admin",
                role="org_admin",
                status="active",
            )
        )
        await db.commit()
    login = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_list_media_org_scoped_and_filtered(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    partner_id = await _partner_id(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="pending", visibility="private"
    )
    await _insert_media(
        orphan_id, org_id, category="certificate", moderation_status="approved", visibility="public"
    )

    r = await api.get(f"/api/v1/media/orphans/{orphan_id}/media", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = r.json()
    # manager view includes the private/pending item
    assert len(rows) == 2
    assert all(row["url"].startswith("http") for row in rows)
    assert "file_url" not in rows[0]

    r = await api.get(
        f"/api/v1/media/orphans/{orphan_id}/media?category=drawing", headers=auth_headers
    )
    assert r.status_code == 200, r.text
    drawing_rows = r.json()
    assert len(drawing_rows) == 1
    assert drawing_rows[0]["category"] == "drawing"


async def test_different_org_staff_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    media_id = await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="pending", visibility="private"
    )
    other = await _other_org_admin(api)

    # list / patch on this org's orphan + media all 404 from another org.
    r = await api.get(f"/api/v1/media/orphans/{orphan_id}/media", headers=other)
    assert r.status_code == 404
    r = await api.patch(f"/api/v1/media/{media_id}", json={"title": "x"}, headers=other)
    assert r.status_code == 404


async def test_upload_rejects_bad_mime_415(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    r = await api.post(
        f"/api/v1/media/orphans/{orphan_id}/media",
        data={"category": "drawing"},
        files={"file": ("note.txt", b"hello", "text/plain")},
        headers=auth_headers,
    )
    assert r.status_code == 415, r.text


async def test_upload_rejects_oversize_413(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    too_big = b"\0" * (10 * 1024 * 1024 + 1)
    r = await api.post(
        f"/api/v1/media/orphans/{orphan_id}/media",
        data={"category": "drawing"},
        files={"file": ("big.jpg", too_big, "image/jpeg")},
        headers=auth_headers,
    )
    assert r.status_code == 413, r.text


async def test_patch_invalid_visibility_422(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    partner_id = await _partner_id(api, auth_headers)
    org_id = await _my_org_id(api, auth_headers)
    orphan_id = await _make_orphan(api, auth_headers, partner_id)
    media_id = await _insert_media(
        orphan_id, org_id, category="drawing", moderation_status="pending", visibility="private"
    )
    r = await api.patch(
        f"/api/v1/media/{media_id}",
        json={"visibility": "totally_bogus"},
        headers=auth_headers,
    )
    assert r.status_code == 422, r.text


# ── migration 0024 reversibility ───────────────────────────────────────────────


def _alembic_config() -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "migrations"))
    return cfg


async def _media_column_exists(column: str) -> bool:
    async with make_session() as db:
        row = (
            await db.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'media' AND column_name = :c"
                ),
                {"c": column},
            )
        ).first()
    return row is not None


async def test_migration_0024_upgrade_then_downgrade(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """0024 is fully reversible: downgrade drops both columns, upgrade restores
    them. Always restores the shared DB to head in ``finally``."""
    assert await _media_column_exists("category")
    assert await _media_column_exists("display_date")

    cfg = _alembic_config()
    try:
        command.downgrade(cfg, "0023")
        assert not await _media_column_exists("category")
        assert not await _media_column_exists("display_date")

        command.upgrade(cfg, "0024")
        assert await _media_column_exists("category")
        assert await _media_column_exists("display_date")
    finally:
        command.upgrade(cfg, "head")
