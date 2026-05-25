"""Human-readable resource codes (ORF-XXXXX, DON-XXXXX, …).

The canonical schema reserves a `code VARCHAR(20) UNIQUE` column on every
top-level entity. We generate them with a short random suffix; the unique
constraint catches collisions and the caller retries.
"""

import secrets
import string

_ALPHABET = string.ascii_uppercase + string.digits


def generate_code(prefix: str, length: int = 6) -> str:
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(length))
    return f"{prefix}-{suffix}"
