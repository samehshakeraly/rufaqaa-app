"""Bilingual email templates.

Plain-text templates keyed by (name, locale). Rendering is `str.format`
with named placeholders — no jinja2 dep. Each template is a small
dataclass with a `subject` and a `body`; callers pass keyword arguments
matching the placeholders.

Adding a template:
    1. Append to `TEMPLATES` below with both `ar` and `en` variants.
    2. Pass through `render(name, locale, **vars)` from the caller.
    3. Optionally add a unit test in tests/unit/test_email_templates.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Locale = Literal["ar", "en"]


@dataclass(frozen=True)
class TemplateVariant:
    subject: str
    body: str


_TEMPLATES: dict[str, dict[Locale, TemplateVariant]] = {
    "user_invite": {
        "en": TemplateVariant(
            subject="You've been invited to {org_name}",
            body=(
                "Hello {first_name},\n\n"
                "{inviter_name} has invited you to join {org_name} on Rufaqaa.\n\n"
                "Open the link below to set your password and finish creating "
                "your account:\n\n"
                "  {accept_url}\n\n"
                "This link expires in {expires_days} days.\n\n"
                "— The Rufaqaa team"
            ),
        ),
        "ar": TemplateVariant(
            subject="تمت دعوتك للانضمام إلى {org_name}",
            body=(
                "مرحباً {first_name}،\n\n"
                "قام {inviter_name} بدعوتك للانضمام إلى {org_name} على منصة رفقاء.\n\n"
                "افتح الرابط التالي لتعيين كلمة المرور وإكمال إنشاء حسابك:\n\n"
                "  {accept_url}\n\n"
                "هذا الرابط صالح لمدة {expires_days} أيام.\n\n"
                "— فريق رفقاء"
            ),
        ),
    },
    "password_reset": {
        "en": TemplateVariant(
            subject="Reset your Rufaqaa password",
            body=(
                "Hello,\n\n"
                "We received a request to reset the password for your Rufaqaa "
                "account. If this was you, open the link below to choose a new "
                "password:\n\n"
                "  {reset_url}\n\n"
                "The link expires in {expires_minutes} minutes. If you didn't "
                "request a reset, you can safely ignore this message — your "
                "password will not be changed."
            ),
        ),
        "ar": TemplateVariant(
            subject="إعادة تعيين كلمة المرور — رفقاء",
            body=(
                "مرحباً،\n\n"
                "وصلنا طلب لإعادة تعيين كلمة المرور لحسابك على رفقاء. إن كنت أنت "
                "صاحب الطلب، افتح الرابط التالي لاختيار كلمة مرور جديدة:\n\n"
                "  {reset_url}\n\n"
                "هذا الرابط صالح لمدة {expires_minutes} دقيقة. إن لم تطلب ذلك يمكنك "
                "تجاهل هذه الرسالة — لن تتغيّر كلمة المرور."
            ),
        ),
    },
    "donor_welcome": {
        "en": TemplateVariant(
            subject="Welcome to Rufaqaa, {first_name}",
            body=(
                "Hello {first_name},\n\n"
                "Thank you for joining Rufaqaa. Your account is ready —\n"
                "you can browse orphans and sponsor as soon as you verify\n"
                "your email address.\n\n"
                "If you didn't sign up, you can safely ignore this message.\n\n"
                "— The Rufaqaa team"
            ),
        ),
        "ar": TemplateVariant(
            subject="مرحباً بك في رفقاء، {first_name}",
            body=(
                "مرحباً {first_name}،\n\n"
                "شكراً لانضمامك إلى رفقاء. حسابك جاهز — يمكنك تصفّح الأيتام\n"
                "وكفالتهم فور تأكيد بريدك الإلكتروني.\n\n"
                "إن لم تكن أنت من سجّل، يمكنك تجاهل هذه الرسالة.\n\n"
                "— فريق رفقاء"
            ),
        ),
    },
    "donor_email_verification": {
        "en": TemplateVariant(
            subject="Verify your Rufaqaa email",
            body=(
                "Hello {first_name},\n\n"
                "Click the link below to verify your email address. It expires\n"
                "in {expires_hours} hours.\n\n"
                "  {verify_url}\n\n"
                "If you didn't request this, you can ignore the message.\n"
            ),
        ),
        "ar": TemplateVariant(
            subject="تأكيد بريدك الإلكتروني — رفقاء",
            body=(
                "مرحباً {first_name}،\n\n"
                "اضغط على الرابط التالي لتأكيد بريدك الإلكتروني. ينتهي صلاحيته\n"
                "خلال {expires_hours} ساعة.\n\n"
                "  {verify_url}\n\n"
                "إن لم تكن أنت من طلب ذلك، يمكنك تجاهل الرسالة.\n"
            ),
        ),
    },
    "donor_email_verified": {
        "en": TemplateVariant(
            subject="Your Rufaqaa email is verified",
            body=(
                "Hello {first_name},\n\n"
                "Your email is verified — you can now sponsor orphans directly\n"
                "from {app_base_url}.\n\n"
                "— The Rufaqaa team"
            ),
        ),
        "ar": TemplateVariant(
            subject="تم تأكيد بريدك في رفقاء",
            body=(
                "مرحباً {first_name}،\n\n"
                "تم تأكيد بريدك — يمكنك الآن كفالة الأيتام مباشرة من\n"
                "{app_base_url}.\n\n"
                "— فريق رفقاء"
            ),
        ),
    },
    "payment_succeeded": {
        "en": TemplateVariant(
            subject="Receipt for your donation — {payment_code}",
            body=(
                "Hello {donor_name},\n\n"
                "Thank you for your contribution of {amount} {currency}.\n\n"
                "  Receipt no.: {payment_code}\n"
                "  Date:        {completed_date}\n\n"
                "View or print the full receipt:\n  {receipt_url}\n\n"
                "— The Rufaqaa team"
            ),
        ),
        "ar": TemplateVariant(
            subject="إيصال تبرعك — {payment_code}",
            body=(
                "مرحباً {donor_name}،\n\n"
                "شكراً لتبرعك بمبلغ {amount} {currency}.\n\n"
                "  رقم الإيصال: {payment_code}\n"
                "  التاريخ:     {completed_date}\n\n"
                "عرض أو طباعة الإيصال الكامل:\n  {receipt_url}\n\n"
                "— فريق رفقاء"
            ),
        ),
    },
    "daily_digest": {
        "en": TemplateVariant(
            subject="{org_name} daily digest — {date}",
            body=(
                "Hello,\n\n"
                "Quick rundown of the last 24 hours for {org_name}:\n\n"
                "  • New completed payments: {new_payments_count} "
                "({new_payments_total})\n"
                "  • New sponsorships:        {new_sponsorships_count}\n"
                "  • Overdue sponsorships:    {overdue_sponsorships_count}\n\n"
                "— Rufaqaa"
            ),
        ),
        "ar": TemplateVariant(
            subject="ملخّص اليوم لـ {org_name} — {date}",
            body=(
                "مرحباً،\n\n"
                "ملخّص آخر 24 ساعة لـ {org_name}:\n\n"
                "  • مدفوعات مكتملة جديدة: {new_payments_count} "
                "({new_payments_total})\n"
                "  • كفالات جديدة:         {new_sponsorships_count}\n"
                "  • كفالات متأخّرة:        {overdue_sponsorships_count}\n\n"
                "— رفقاء"
            ),
        ),
    },
}


def render(name: str, locale: Locale = "ar", **vars: object) -> tuple[str, str]:
    """Return (subject, body) for the named template. Falls back to the
    English variant if a translation is missing for the requested locale.
    Raises KeyError on an unknown template name."""
    variants = _TEMPLATES[name]
    variant = variants.get(locale) or variants["en"]
    return variant.subject.format(**vars), variant.body.format(**vars)


def list_templates() -> list[str]:
    return sorted(_TEMPLATES.keys())
