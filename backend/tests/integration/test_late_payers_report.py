"""GET /reports/late-payers — the المتأخرون في السداد export.

Covers: selection correctness at the lateness boundary (months_overdue
0 vs 1, cancelled excluded), valid PDF/XLSX bytes with a dated
Content-Disposition, org isolation (a second org's export never carries
the first org's rows), the finance/admin role gate, and a PII assertion —
the orphan appears only by code, never by name.
"""

from __future__ import annotations

import io
import uuid

from httpx import AsyncClient, Response
from openpyxl import load_workbook
from sqlalchemy import text

from app.core.database import make_session
from app.core.security import hash_password
from app.models.organization import Organization
from app.models.user import User

_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


async def _seed_partner_id() -> str:
    async with make_session() as db:
        row = (
            await db.execute(
                text("SELECT id::text FROM partner_organizations WHERE code = 'DEV-PTN' LIMIT 1")
            )
        ).first()
        assert row is not None
        return row[0]


async def _make_donor(api: AsyncClient, h: dict[str, str], name: str = "كافل") -> dict:
    email = f"lp-{uuid.uuid4().hex[:8]}@example.com"
    r = await api.post("/api/v1/donors", json={"full_name": name, "email": email}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def _make_orphan(api: AsyncClient, h: dict[str, str]) -> dict:
    partner_id = await _seed_partner_id()
    unique = uuid.uuid4().hex[:6]
    r = await api.post(
        "/api/v1/orphans",
        json={
            "first_name": f"يتيم-{unique}",
            "family_name": f"عائلة-{unique}",
            "date_of_birth": "2017-08-10",
            "gender": "M",
            "partner_organization_id": partner_id,
            "father_name": f"أب-{unique}",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _make_sponsorship(
    api: AsyncClient, h: dict[str, str], donor_id: str, orphan_id: str
) -> dict:
    r = await api.post(
        "/api/v1/sponsorships",
        json={
            "donor_id": donor_id,
            "orphan_id": orphan_id,
            "monthly_amount": "20.00",
            "currency": "KWD",
            "start_date": "2026-01-01",
        },
        headers=h,
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_overdue(sponsorship_id: str, months: int, status: str = "active") -> None:
    async with make_session() as db:
        await db.execute(
            text("UPDATE sponsorships SET months_overdue = :m, status = :s WHERE id = :id"),
            {"m": months, "s": status, "id": sponsorship_id},
        )
        await db.commit()


async def _login_as(api: AsyncClient, admin_headers: dict[str, str], role: str) -> dict[str, str]:
    """Invite + accept + login a user with `role` in the admin's org."""
    email = f"{role[:3]}-{uuid.uuid4().hex[:8]}@example.com"
    password = "longenoughpw1"
    r = await api.post(
        "/api/v1/users/invite",
        json={"email": email, "first_name": role.title(), "last_name": "User", "role": role},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    token = r.json()["invite_token"]
    r = await api.post("/api/v1/users/accept-invite", json={"token": token, "password": password})
    assert r.status_code == 200, r.text
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _new_org_token(api: AsyncClient, role: str = "finance") -> dict[str, str]:
    """Create a fresh organization + active user with `role`, return headers."""
    suffix = uuid.uuid4().hex[:8]
    email = f"{role[:3]}-{suffix}@other.example.com"
    password = "otherpw123456"
    async with make_session() as db:
        org = Organization(
            code=f"OTH-{suffix[:6].upper()}",
            name_ar="منظمة أخرى",
            name_en="Other Org",
            org_type="standalone",
            deployment_mode="self_hosted",
            country_code="KW",
        )
        db.add(org)
        await db.flush()
        db.add(
            User(
                organization_id=org.id,
                email=email,
                password_hash=hash_password(password),
                first_name="Other",
                last_name="Finance",
                role=role,
                status="active",
            )
        )
        await db.commit()
    r = await api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _xlsx_cells(response: Response) -> list[str]:
    """Every non-empty cell of the workbook, stringified."""
    wb = load_workbook(io.BytesIO(response.content), read_only=True)
    cells: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells.extend(str(v) for v in row if v is not None)
    return cells


async def _late_setup(api: AsyncClient, h: dict[str, str], months: int = 2) -> tuple[dict, dict]:
    """Donor + orphan + a sponsorship set `months` behind. Returns (sponsorship, orphan)."""
    donor = await _make_donor(api, h)
    orphan = await _make_orphan(api, h)
    sp = await _make_sponsorship(api, h, donor["id"], orphan["id"])
    await _set_overdue(sp["id"], months=months)
    return sp, orphan


# ── Export bytes ────────────────────────────────────────────────────────


async def test_pdf_export_returns_pdf_bytes(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    await _late_setup(api, auth_headers)

    r = await api.get("/api/v1/reports/late-payers?format=pdf", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content.startswith(b"%PDF")
    disposition = r.headers["content-disposition"]
    assert "late-payers-report-" in disposition
    assert ".pdf" in disposition


async def test_xlsx_export_returns_zip_bytes_with_row(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    sp, _orphan = await _late_setup(api, auth_headers, months=3)

    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith(_XLSX_MIME)
    assert r.content.startswith(b"PK")  # XLSX is a ZIP container
    assert ".xlsx" in r.headers["content-disposition"]

    cells = _xlsx_cells(r)
    assert sp["code"] in cells
    # 3 months × 20.00 KWD outstanding for this row.
    numeric: set[float] = set()
    for c in cells:
        try:
            numeric.add(float(c))
        except ValueError:
            pass
    assert 60.0 in numeric


async def test_default_format_is_pdf(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/reports/late-payers", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


async def test_unknown_format_rejected(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    r = await api.get("/api/v1/reports/late-payers?format=csv", headers=auth_headers)
    assert r.status_code == 422, r.text


# ── Selection boundary ──────────────────────────────────────────────────


async def test_boundary_one_month_in_zero_months_out(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor = await _make_donor(api, auth_headers)
    orphan_a = await _make_orphan(api, auth_headers)
    orphan_b = await _make_orphan(api, auth_headers)
    late = await _make_sponsorship(api, auth_headers, donor["id"], orphan_a["id"])
    current = await _make_sponsorship(api, auth_headers, donor["id"], orphan_b["id"])
    await _set_overdue(late["id"], months=1)  # exactly at the boundary
    await _set_overdue(current["id"], months=0)

    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=auth_headers)
    assert r.status_code == 200, r.text
    cells = _xlsx_cells(r)
    assert late["code"] in cells
    assert current["code"] not in cells


async def test_cancelled_sponsorship_never_late(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor = await _make_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor["id"], orphan["id"])
    await _set_overdue(sp["id"], months=5, status="cancelled")

    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert sp["code"] not in _xlsx_cells(r)


async def test_worker_parked_overdue_status_included(
    api: AsyncClient, auth_headers: dict[str, str]
) -> None:
    donor = await _make_donor(api, auth_headers)
    orphan = await _make_orphan(api, auth_headers)
    sp = await _make_sponsorship(api, auth_headers, donor["id"], orphan["id"])
    # The daily worker moves late rows to status='overdue' — they must stay visible.
    await _set_overdue(sp["id"], months=2, status="overdue")

    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert sp["code"] in _xlsx_cells(r)


# ── Org isolation ───────────────────────────────────────────────────────


async def test_org_isolation(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    sp, _orphan = await _late_setup(api, auth_headers, months=4)

    other = await _new_org_token(api, role="finance")
    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=other)
    assert r.status_code == 200, r.text
    assert sp["code"] not in _xlsx_cells(r)


# ── Role gate ───────────────────────────────────────────────────────────


async def test_finance_role_allowed(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    finance = await _login_as(api, auth_headers, "finance")
    r = await api.get("/api/v1/reports/late-payers", headers=finance)
    assert r.status_code == 200, r.text


async def test_non_finance_roles_forbidden(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    for role in ("partner_staff", "partner_manager", "marketing_manager"):
        headers = await _login_as(api, auth_headers, role)
        r = await api.get("/api/v1/reports/late-payers", headers=headers)
        assert r.status_code == 403, f"{role}: {r.status_code} {r.text}"


async def test_unauthenticated_rejected(api: AsyncClient) -> None:
    r = await api.get("/api/v1/reports/late-payers")
    assert r.status_code in (401, 403), r.text


# ── Privacy: no orphan PII ──────────────────────────────────────────────


async def test_no_orphan_pii_in_output(api: AsyncClient, auth_headers: dict[str, str]) -> None:
    sp, orphan = await _late_setup(api, auth_headers, months=2)

    r = await api.get("/api/v1/reports/late-payers?format=xlsx", headers=auth_headers)
    assert r.status_code == 200, r.text
    cells = _xlsx_cells(r)

    # The sponsorship + orphan appear only by their non-identifying codes...
    assert sp["code"] in cells
    assert orphan["code"] in cells
    # ...and no orphan-identifying field leaks into any cell.
    blob = " ".join(cells)
    for pii in (
        orphan["first_name"],
        orphan["family_name"],
        orphan.get("father_name") or "أب-",
        orphan["id"],
        orphan.get("date_of_birth") or "2017-08-10",
    ):
        assert str(pii) not in blob, f"orphan PII {pii!r} leaked into the export"
