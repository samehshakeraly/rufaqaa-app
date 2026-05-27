"""SMTP email sender.

Defaults target the MailHog container in docker-compose so dev users
can inspect outgoing mail at http://localhost:8025 without needing a
real SMTP relay. When EMAIL_ENABLED is false (the default) the sender
logs the message instead of opening an SMTP connection — keeps tests
and offline dev usable.
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

import structlog

from app.core.config import settings
from app.services.email_templates import Locale, render

logger = structlog.get_logger(__name__)


def send_email(*, to: str, subject: str, body: str, html: str | None = None) -> bool:
    """Returns True if an SMTP send was attempted, False if disabled.

    The caller doesn't usually care — both paths are "the user was
    notified" semantically. The bool is here so the digest task can
    surface "logged-only" in its summary."""
    if not settings.EMAIL_ENABLED:
        logger.info(
            "email_skipped_disabled",
            to=to,
            subject=subject,
            body_preview=body[:200],
        )
        return False

    msg = EmailMessage()
    msg["From"] = f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>"
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
        if settings.SMTP_TLS:
            s.starttls()
        if settings.SMTP_USER:
            s.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        s.send_message(msg)
    return True


def send_templated(*, to: str, template: str, locale: Locale = "ar", **vars: object) -> bool:
    """Render the named bilingual template and send. Thin shim so
    callers don't reach into the template module directly."""
    subject, body = render(template, locale=locale, **vars)
    return send_email(to=to, subject=subject, body=body)
