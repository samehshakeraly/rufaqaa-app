"""Presigned-URL host rewrite — pure, no network.

boto3 signs presigned GET URLs against the internal S3_ENDPOINT (e.g.
http://minio:9000), which a browser can't reach. `_swap_presigned_host`
rewrites just that origin for the public one; the path + query (including
X-Amz-Signature) must stay byte-for-byte intact so the signature keeps
verifying under path-style MinIO.
"""

from __future__ import annotations

from app.services.storage import _swap_presigned_host

_INTERNAL = "http://minio:9000"
_PUBLIC = "http://localhost:9000"
_QUERY = "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=deadbeefcafe"
_SIGNED = f"{_INTERNAL}/rufaqaa-private/orphans/abc/xyz.jpg?{_QUERY}"


def test_swaps_only_origin_and_keeps_signature() -> None:
    out = _swap_presigned_host(_SIGNED, _INTERNAL, _PUBLIC)
    assert out == f"{_PUBLIC}/rufaqaa-private/orphans/abc/xyz.jpg?{_QUERY}"
    # Path + query (and therefore X-Amz-Signature) are untouched.
    assert out.split("?", 1)[1] == _QUERY
    assert "X-Amz-Signature=deadbeefcafe" in out


def test_empty_public_endpoint_is_noop() -> None:
    assert _swap_presigned_host(_SIGNED, _INTERNAL, "") == _SIGNED


def test_non_matching_prefix_is_unchanged() -> None:
    other = f"http://example.com/bucket/key.jpg?{_QUERY}"
    assert _swap_presigned_host(other, _INTERNAL, _PUBLIC) == other


def test_trailing_slashes_are_normalised() -> None:
    out = _swap_presigned_host(_SIGNED, _INTERNAL + "/", _PUBLIC + "/")
    assert out == f"{_PUBLIC}/rufaqaa-private/orphans/abc/xyz.jpg?{_QUERY}"
