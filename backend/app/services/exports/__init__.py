"""Shared rendering layer for report exports (PDF + Excel).

This package is deliberately DB-free: functions take a template name plus a
context dict (PDF) or plain rows (Excel) and return bytes. Tenant scoping and
data fetching — including the explicit ``organization_id`` filter — are the
caller's responsibility and live in the report endpoints, not here.
"""

from app.services.exports.excel import build_report_xlsx
from app.services.exports.pdf import html_to_pdf, render_html, render_report_pdf

__all__ = [
    "build_report_xlsx",
    "html_to_pdf",
    "render_html",
    "render_report_pdf",
]
