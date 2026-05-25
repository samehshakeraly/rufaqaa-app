"""Two-factor authentication endpoints.

Flow:
  POST /auth/2fa/enroll       — generates a fresh secret, stores it
                                pending (two_factor_secret set,
                                two_factor_enabled still False), returns
                                the otpauth URI so the client can show
                                a QR code.
  POST /auth/2fa/verify       — caller submits a 6-digit TOTP code; on
                                success two_factor_enabled flips to True
                                AND we generate fresh backup codes.
  POST /auth/2fa/disable      — requires a valid current TOTP code;
                                clears the secret and backup codes.
"""

from __future__ import annotations

import secrets
from typing import Annotated

import pyotp
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.deps import DbSession, get_current_user
from app.models.user import User
from app.schemas.twofa import TwoFAEnrollResponse, TwoFAVerifyRequest

router = APIRouter()


def _generate_backup_codes(count: int = 10) -> list[str]:
    # 8-char base32 codes, easy for users to type
    return [secrets.token_hex(4) for _ in range(count)]


@router.post("/enroll", response_model=TwoFAEnrollResponse)
async def enroll_2fa(
    db: DbSession,
    user: Annotated[User, Depends(get_current_user)],
) -> TwoFAEnrollResponse:
    if user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="2FA is already enabled — disable it first",
        )
    secret = pyotp.random_base32()
    user.two_factor_secret = secret
    await db.commit()

    issuer = "Rufaqaa"
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=issuer)
    return TwoFAEnrollResponse(secret=secret, otpauth_uri=uri)


class BackupCodesResponse(BaseModel):
    backup_codes: list[str]


@router.post("/verify", response_model=BackupCodesResponse)
async def verify_2fa(
    payload: TwoFAVerifyRequest,
    db: DbSession,
    user: Annotated[User, Depends(get_current_user)],
) -> BackupCodesResponse:
    if not user.two_factor_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /auth/2fa/enroll first",
        )
    if not pyotp.TOTP(user.two_factor_secret).verify(payload.code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )
    backup_codes = _generate_backup_codes()
    user.two_factor_enabled = True
    user.backup_codes = backup_codes
    await db.commit()
    return BackupCodesResponse(backup_codes=backup_codes)


@router.post("/disable", status_code=status.HTTP_204_NO_CONTENT)
async def disable_2fa(
    payload: TwoFAVerifyRequest,
    db: DbSession,
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    if not user.two_factor_enabled or not user.two_factor_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled",
        )
    if not pyotp.TOTP(user.two_factor_secret).verify(payload.code, valid_window=1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )
    user.two_factor_enabled = False
    user.two_factor_secret = None
    user.backup_codes = None
    await db.commit()
