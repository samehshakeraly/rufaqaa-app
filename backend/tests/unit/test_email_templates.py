"""Bilingual email template rendering."""

from __future__ import annotations

import pytest

from app.services.email_templates import list_templates, render


def test_user_invite_renders_both_locales() -> None:
    vars = {
        "first_name": "Sameh",
        "inviter_name": "Admin",
        "org_name": "Test Org",
        "accept_url": "https://x/accept?token=abc",
        "expires_days": 7,
    }
    en_subj, en_body = render("user_invite", "en", **vars)
    assert "Sameh" in en_body
    assert "Test Org" in en_subj
    assert "https://x/accept?token=abc" in en_body

    ar_subj, ar_body = render("user_invite", "ar", **vars)
    assert "Sameh" in ar_body
    assert "Test Org" in ar_subj
    # The Arabic body contains an Arabic word
    assert "مرحباً" in ar_body


def test_password_reset_contains_link_and_ttl() -> None:
    _, body = render(
        "password_reset",
        "en",
        reset_url="https://x/reset?token=tok",
        expires_minutes=30,
    )
    assert "https://x/reset?token=tok" in body
    assert "30 minutes" in body


def test_daily_digest_includes_counters() -> None:
    _, body = render(
        "daily_digest",
        "ar",
        org_name="منظمة",
        date="2026-05-27",
        new_payments_count=3,
        new_payments_total="125.00",
        new_sponsorships_count=1,
        overdue_sponsorships_count=0,
    )
    assert "منظمة" in body
    assert "125.00" in body
    assert "3" in body


def test_unknown_template_raises() -> None:
    with pytest.raises(KeyError):
        render("does_not_exist", "en")


def test_unknown_locale_falls_back_to_english() -> None:
    # Pass a locale the registry doesn't have; should not raise
    subject, body = render(
        "password_reset",
        "fr",  # type: ignore[arg-type]
        reset_url="https://x/reset",
        expires_minutes=15,
    )
    # English template is the fallback
    assert "Reset your Rufaqaa password" == subject
    assert "Hello" in body


def test_list_templates_contains_known_names() -> None:
    names = list_templates()
    assert "user_invite" in names
    assert "password_reset" in names
    assert "daily_digest" in names
