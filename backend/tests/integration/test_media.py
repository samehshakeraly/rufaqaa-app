"""Media upload tests.

Requires a running MinIO (or any S3-compatible) endpoint. The fixture
checks reachability and skips when the bucket service isn't up — that
keeps local pytest runs functional even without docker-compose.
"""

from __future__ import annotations

import socket
import uuid
from urllib.parse import urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.config import settings
from app.core.database import make_session


def _s3_reachable() -> bool:
    parsed = urlparse(settings.S3_ENDPOINT)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


s3_required = pytest.mark.skipif(
    not _s3_reachable(), reason=f"S3 endpoint {settings.S3_ENDPOINT} not reachable"
)


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> str:
    partner_id = await _seed_partner_id()
    suffix = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"وسائط-{suffix}",
            "family_name": "صورة",
            "date_of_birth": "2015-02-14",
            "gender": "F",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{suffix}",
        },
        headers=h,
    )
    assert r.status_code == 201
    return r.json()["id"]


# Tiny valid JPEG payload (the MIME check looks at the declared content
# type only — the bytes themselves don't need to be a real image).
_TINY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"


@s3_required
async def test_orphan_photo_upload_roundtrip(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    orphan_id = await _make_orphan(api, auth_headers)

    files = {"file": ("test.jpg", _TINY_JPEG, "image/jpeg")}
    r = await api.post(
        f"/api/v1/media/orphans/{orphan_id}/photo",
        files=files,
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["media_type"] == "photo"
    assert body["file_url"].startswith("s3://")
    assert body["file_size_bytes"] == len(_TINY_JPEG)
    media_id = body["id"]

    r = await api.get(f"/api/v1/media/{media_id}/url", headers=auth_headers)
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("http")


async def test_rejects_non_image_upload(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    orphan_id = await _make_orphan(api, auth_headers)
    files = {"file": ("notes.txt", b"hello", "text/plain")}
    r = await api.post(
        f"/api/v1/media/orphans/{orphan_id}/photo",
        files=files,
        headers=auth_headers,
    )
    assert r.status_code == 415
