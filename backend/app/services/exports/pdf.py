"""HTML → PDF rendering for report exports.

Pure functions: template name + context in, bytes out. No DB access — data
fetching and tenant scoping belong to the caller.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

# base_url for WeasyPrint must be this package dir so relative URLs in
# templates (e.g. the @font-face ``../../assets/fonts/...`` sources in
# base.html) resolve against the app tree instead of the process CWD.
PACKAGE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = PACKAGE_DIR / "templates"

_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "xml"]),
)


def render_html(template_name: str, context: dict[str, Any]) -> str:
    """Render a template from this package's ``templates/`` dir to an HTML string."""
    return _env.get_template(template_name).render(**context)


def html_to_pdf(html: str) -> bytes:
    """Render an HTML string to PDF bytes with WeasyPrint."""
    pdf = HTML(string=html, base_url=str(PACKAGE_DIR)).write_pdf()
    return bytes(pdf)


def render_report_pdf(template_name: str, context: dict[str, Any]) -> bytes:
    """Render a report template with ``context`` and return the PDF as bytes."""
    return html_to_pdf(render_html(template_name, context))
