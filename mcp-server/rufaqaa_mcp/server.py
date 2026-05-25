"""Rufaqaa MCP Server entry point.

Registers a small set of tools that wrap the Rufaqaa REST API and exposes
them over stdio so Claude Desktop (or any MCP-compatible client) can use
them.
"""

from __future__ import annotations

import asyncio
from typing import Any

from mcp.server.fastmcp import FastMCP

from rufaqaa_mcp.client import RufaqaaClient

mcp = FastMCP("rufaqaa")
_client: RufaqaaClient | None = None


def _get_client() -> RufaqaaClient:
    global _client
    if _client is None:
        _client = RufaqaaClient()
    return _client


@mcp.tool()
async def list_orphans(
    limit: int = 20,
    offset: int = 0,
    case_status: str | None = None,
) -> dict[str, Any]:
    """List orphans visible to the configured Rufaqaa user.

    Args:
        limit: page size (1–100, default 20)
        offset: pagination offset
        case_status: filter by case status (pending_review, available,
            sponsored, …)
    """
    return await _get_client().list_orphans(
        limit=limit, offset=offset, case_status=case_status
    )


@mcp.tool()
async def get_orphan(orphan_id: str) -> dict[str, Any]:
    """Fetch a single orphan by UUID."""
    return await _get_client().get_orphan(orphan_id)


@mcp.tool()
async def list_donors(limit: int = 20, offset: int = 0) -> dict[str, Any]:
    """List donors visible to the configured Rufaqaa user."""
    return await _get_client().list_donors(limit=limit, offset=offset)


@mcp.tool()
async def list_sponsorships(
    limit: int = 20,
    offset: int = 0,
    donor_id: str | None = None,
    orphan_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """List sponsorships, optionally filtered by donor, orphan, or status."""
    return await _get_client().list_sponsorships(
        limit=limit,
        offset=offset,
        donor_id=donor_id,
        orphan_id=orphan_id,
        status=status,
    )


@mcp.tool()
async def create_sponsorship(
    donor_id: str,
    orphan_id: str,
    monthly_amount: str,
    currency: str,
    start_date: str,
    payment_frequency: str = "monthly",
) -> dict[str, Any]:
    """Create a new sponsorship.

    Args:
        donor_id: UUID of the donor
        orphan_id: UUID of the orphan
        monthly_amount: decimal as string (e.g. "25.00")
        currency: ISO 4217 code (KWD, USD, …)
        start_date: ISO date (YYYY-MM-DD)
        payment_frequency: monthly / quarterly / semi_annual / annual / one_time
    """
    return await _get_client().create_sponsorship(
        donor_id=donor_id,
        orphan_id=orphan_id,
        monthly_amount=monthly_amount,
        currency=currency,
        start_date=start_date,
        payment_frequency=payment_frequency,
    )


@mcp.tool()
async def cancel_sponsorship(
    sponsorship_id: str, reason: str | None = None
) -> dict[str, Any]:
    """Cancel an active sponsorship. The reason is recorded for audit."""
    return await _get_client().cancel_sponsorship(sponsorship_id, reason=reason)


@mcp.tool()
async def list_payments(
    limit: int = 20,
    offset: int = 0,
    donor_id: str | None = None,
    sponsorship_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """List recorded payments. Filter by donor, sponsorship, or status."""
    return await _get_client().list_payments(
        limit=limit,
        offset=offset,
        donor_id=donor_id,
        sponsorship_id=sponsorship_id,
        status=status,
    )


@mcp.tool()
async def record_payment(
    donor_id: str,
    amount: str,
    currency: str,
    payment_method: str,
    sponsorship_id: str | None = None,
) -> dict[str, Any]:
    """Record an offline (cash/cheque/bank-transfer) payment from a donor.

    Args:
        donor_id: UUID of the donor
        amount: decimal as string (e.g. "25.00")
        currency: ISO 4217 code (KWD, USD, …)
        payment_method: cash / bank_transfer / knet / credit_card / cheque / other
        sponsorship_id: optional UUID — when set, the sponsorship totals are
            bumped automatically
    """
    return await _get_client().record_payment(
        donor_id=donor_id,
        amount=amount,
        currency=currency,
        payment_method=payment_method,
        sponsorship_id=sponsorship_id,
    )


@mcp.tool()
async def list_reports(
    limit: int = 20,
    offset: int = 0,
    orphan_id: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """List orphan periodic reports.

    Status values: draft, pending_partner_approval, partner_approved,
    pending_org_approval, org_approved, published_to_donor, rejected.
    """
    return await _get_client().list_reports(
        limit=limit, offset=offset, orphan_id=orphan_id, status=status
    )


@mcp.tool()
async def transition_report(report_id: str, action: str) -> dict[str, Any]:
    """Advance a report through its approval workflow.

    Args:
        report_id: UUID of the report
        action: one of submit / approve-partner / approve-org / publish / reject
    """
    allowed = {"submit", "approve-partner", "approve-org", "publish", "reject"}
    if action not in allowed:
        raise ValueError(f"action must be one of {sorted(allowed)}")
    return await _get_client().transition_report(report_id, action)


def main() -> None:
    """Run the server over stdio (for Claude Desktop)."""
    try:
        mcp.run()
    finally:
        if _client is not None:
            asyncio.run(_client.aclose())


if __name__ == "__main__":
    main()
