from pydantic import BaseModel, Field


class TwoFAEnrollResponse(BaseModel):
    """Returned by /auth/2fa/enroll.

    The shared secret is base32-encoded and the otpauth_uri is suitable
    for rendering as a QR code in the client (e.g. Google Authenticator,
    Authy, 1Password).
    """

    secret: str
    otpauth_uri: str


class TwoFAVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8, pattern=r"^\d+$")
